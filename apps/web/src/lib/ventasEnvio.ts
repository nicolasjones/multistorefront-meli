// Envío y transporte del comprobante (F-VTA-16, MSF-166, épica MSF-135, FR-020…FR-023).
// La autoridad es la base: `public.guardar_envio_comprobante` valida que el transporte esté activo y se use en la
// tienda del comprobante, que la guía entre, el permiso (`despachar` o Ventas en `edicion` en esa empresa) y el
// bloqueo optimista; la RLS vigente de `dominio` resuelve el aislamiento por organización. Acá solo se arma la
// lista de transportes elegibles (Decisión abierta 8 de la spec), los rótulos del bloque y los envoltorios de
// lectura y de guardado.

import { supabaseClient } from './supabase'
import { listarFormasEnvio, type TipoFormaEnvio } from './ventas/formasEnvio'
import { listarTransportes, type Transporte, type TipoTransporte } from './ventas/transportes'

export type { TipoFormaEnvio }
export type { TipoTransporte }
export type { Transporte }

// Rótulo del selector de transporte según la forma de envío (FR-023; lo dice el prototipo):
// «Transporte / expreso», «Correo» o «Mensajería propia».
export const ROTULO_TRANSPORTE: Readonly<Record<TipoFormaEnvio, string>> = {
  retiro_local: 'Transporte',
  correo: 'Correo',
  expreso: 'Transporte / expreso',
  moto: 'Mensajería propia',
  terminal: 'Transporte / expreso',
}

// Sin transporte: el cliente retira en el local (FR-023; texto del prototipo).
export const TEXTO_RETIRO_EN_LOCAL = 'El cliente retira en el local. No hace falta transporte ni guía.'

// Tipo de transporte que corresponde a cada forma de envío (Decisión abierta 8): correo → transportes `correo`,
// expreso → `expreso`, moto → `moto_propia`. La forma `terminal` admite cualquiera de la empresa y
// `retiro_local` ninguno: por eso no aparecen en el mapa.
export const TIPO_TRANSPORTE_POR_ENVIO: Readonly<Partial<Record<TipoFormaEnvio, TipoTransporte>>> = {
  correo: 'correo',
  expreso: 'expreso',
  moto: 'moto_propia',
}

// La forma de envío que no lleva transporte (el cliente retira en el local).
export function esRetiroEnLocal(tipo: TipoFormaEnvio | null | undefined): boolean {
  return tipo === 'retiro_local'
}

// Rótulo del selector de transporte de la forma de envío; `null` si la forma no lleva transporte.
export function rotuloTransporte(tipo: TipoFormaEnvio | null | undefined): string | null {
  if (!tipo || esRetiroEnLocal(tipo)) return null
  return ROTULO_TRANSPORTE[tipo] ?? ROTULO_TRANSPORTE.expreso
}

// Un transporte se puede elegir si su tipo corresponde al de la forma de envío (o si la forma es `terminal`,
// que admite cualquiera de la empresa).
export function esTransporteElegible(tipo: TipoFormaEnvio, transporte: { tipo: TipoTransporte }): boolean {
  const tipoEsperado = TIPO_TRANSPORTE_POR_ENVIO[tipo]
  if (!tipoEsperado) return true
  return transporte.tipo === tipoEsperado
}

// Transportes que se pueden elegir para una forma de envío: los de la empresa que están activos y son del tipo
// que corresponde. Un transporte inactivo no se puede elegir (SC de US2).
export function transportesElegibles<T extends { tipo: TipoTransporte; activa: boolean }>(
  tipo: TipoFormaEnvio,
  transportes: readonly T[],
): T[] {
  if (esRetiroEnLocal(tipo)) return []
  return transportes.filter((transporte) => transporte.activa && esTransporteElegible(tipo, transporte))
}

// La RPC `listar_transportes` acepta hasta 200 filas por página: se piden de a tanto hasta cubrirlas todas.
const TAMANO_PAGINA_TRANSPORTES = 200
const MAX_PAGINAS_TRANSPORTES = 20

// Transportes de la empresa (los que se usan en esa tienda), activos e inactivos: el selector muestra los
// elegibles y, si la factura ya tiene uno que hoy no se puede elegir, el nombre del cargado.
export async function listarTransportesDeEmpresa(empresaId: string): Promise<Transporte[]> {
  const lista: Transporte[] = []
  let pagina = 1
  let total = 0
  do {
    const resultado = await listarTransportes({ empresaId, pagina, tamano: TAMANO_PAGINA_TRANSPORTES })
    lista.push(...resultado.transportes)
    total = resultado.total
    pagina += 1
  } while (lista.length < total && pagina <= MAX_PAGINAS_TRANSPORTES)
  return lista
}

// Forma de envío elegida en el comprobante: de ella sale el rótulo del selector y si hace falta transporte.
export type FormaEnvioDelComprobante = {
  id: string
  nombre: string
  tipo: TipoFormaEnvio
  exige_transporte_guia: boolean
}

export async function obtenerFormaEnvioDeComprobante(
  empresaId: string,
  envioId: string | null,
): Promise<FormaEnvioDelComprobante | null> {
  if (!envioId) return null
  const formas = await listarFormasEnvio(empresaId)
  const forma = formas.find((candidata) => candidata.id === envioId)
  if (!forma) return null
  return {
    id: forma.id,
    nombre: forma.nombre,
    tipo: forma.tipo,
    exige_transporte_guia: forma.exige_transporte_guia,
  }
}

// Envío ya cargado de un comprobante. La RLS vigente de `dominio.comprobantes_venta` (organización y sección
// `ventas`) acota la lectura; `updated_at` es el bloqueo optimista que exige la RPC al guardar.
export type DatosEnvio = {
  transporte_id: string | null
  guia: string | null
  fecha_envio: string | null
  updated_at: string
}

export async function obtenerEnvioComprobante(comprobanteId: string): Promise<DatosEnvio | null> {
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('comprobantes_venta')
    .select('id, transporte_id, guia, fecha_envio, updated_at')
    .eq('id', comprobanteId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const fila = data as Partial<DatosEnvio>
  return {
    transporte_id: fila.transporte_id ?? null,
    guia: fila.guia ?? null,
    fecha_envio: fila.fecha_envio ?? null,
    updated_at: fila.updated_at ?? '',
  }
}

// Guarda el envío (FR-021). `actualizadoEn` es el `updated_at` leído al abrir (bloqueo optimista, `40001`).
export type GuardarEnvio = {
  id: string
  transporteId: string | null
  guia: string | null
  fechaEnvio: string | null
  actualizadoEn: string
}

export async function guardarEnvioComprobante(datos: GuardarEnvio): Promise<DatosEnvio> {
  const { data, error } = await supabaseClient.rpc('guardar_envio_comprobante', {
    p_id: datos.id,
    p_transporte_id: datos.transporteId,
    p_guia: datos.guia,
    p_fecha_envio: datos.fechaEnvio,
    p_actualizado_en: datos.actualizadoEn,
  })
  if (error) throw error
  const fila = (data ?? {}) as Partial<DatosEnvio>
  return {
    transporte_id: fila.transporte_id ?? null,
    guia: fila.guia ?? null,
    fecha_envio: fila.fecha_envio ?? null,
    updated_at: fila.updated_at ?? datos.actualizadoEn,
  }
}

// La guía es un texto corto: el número de seguimiento que da el transporte (mismo límite que el CHECK de la base).
export const LARGO_MAXIMO_GUIA = 100

export function validarGuia(guia: string): string | null {
  if (guia.trim().length > LARGO_MAXIMO_GUIA) {
    return `La guía no puede tener más de ${LARGO_MAXIMO_GUIA} caracteres.`
  }
  return null
}

export const MENSAJE_ERROR_ENVIO = 'No pudimos guardar el envío. No se guardó nada: probá de nuevo.'
export const MENSAJE_ERROR_CARGA_ENVIO = 'No pudimos cargar el envío de esta factura. Probá de nuevo.'
export const MENSAJE_CONFLICTO_ENVIO =
  'Otra persona modificó este comprobante mientras lo mirabas. Recargamos los datos: volvé a cargar el envío.'
export const MENSAJE_EXITO_ENVIO = 'Envío guardado.'
export const MENSAJE_SIN_PERMISO_ENVIO = 'Podés ver el envío, pero tu rol no puede cargarlo.'
export const MENSAJE_SIN_FORMA_ENVIO =
  'Esta factura todavía no tiene forma de envío: sin ella no se puede cargar el transporte ni la guía.'
export const ETIQUETA_GUARDAR_ENVIO = 'Guardar envío'

type ErrorDeBase = { code?: string; message?: string } | null

// Los mensajes que levanta la RPC llegan en castellano y se muestran tal cual; el resto se traduce por código.
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión',
  'Tu rol ',
  'Un presupuesto no registra',
  'Solo las facturas',
  'Esta factura',
  'La guía no puede',
  'Alguien modificó',
  'El transporte',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export function mensajeDeErrorEnvio(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_ENVIO, e?.code ?? 'sin código')
  if (e?.code === '40001') return MENSAJE_CONFLICTO_ENVIO
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023') && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_ENVIO
}
