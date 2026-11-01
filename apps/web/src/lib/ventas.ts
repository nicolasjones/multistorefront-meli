import { supabaseClient } from './supabase'
import { hoyEnArgentina } from './reparaciones'
import { aLineas, type LineaComprobante } from './ventasLineas'

// Comprobantes de venta (F-VTA-05, MSF-159). El alta, la edición de la cabecera y la lectura pasan por RPC
// (`crear_comprobante`, `guardar_comprobante`, `obtener_comprobante`): la tabla no admite escritura directa y
// la autoridad de permisos es la base (la UI solo decide qué se ofrece). Contrato en docs/ventas-comprobantes.md.

export type TipoComprobante = 'factura' | 'presupuesto'
export type CanalVenta = 'mostrador' | 'tienda_online' | 'telefono_whatsapp'

// Mercado Libre queda para la Etapa 2: el prototipo lo muestra deshabilitado, no es un canal elegible.
export const CANALES_VENTA: ReadonlyArray<{ valor: CanalVenta; etiqueta: string }> = [
  { valor: 'mostrador', etiqueta: 'Mostrador' },
  { valor: 'tienda_online', etiqueta: 'Tienda online' },
  { valor: 'telefono_whatsapp', etiqueta: 'Teléfono/WhatsApp' },
]
export const AYUDA_CANAL_ML = 'Mercado Libre todavía no está disponible como canal.'

export const ETIQUETA_TIPO: Readonly<Record<TipoComprobante, string>> = { factura: 'Factura', presupuesto: 'Presupuesto' }

export type ClienteComprobante = {
  id: string
  nombre: string
  documento: string | null
  direccion: string | null
  tipo: 'minorista' | 'mayorista'
  es_consumidor_final: boolean
}

export type Comprobante = {
  id: string
  tipo: TipoComprobante
  numero: string
  estado: string
  empresa_id: string
  empresa: string
  cliente: ClienteComprobante
  canal: CanalVenta | null
  fecha: string
  valido_hasta: string | null
  operador_id: string | null
  operador: string
  forma_pago_id: string | null
  envio_id: string | null
  // F-SVC-13: de qué documento nació el comprobante (hoy solo una reparación de Service). Solo lectura.
  origen_tipo?: 'reparacion' | null
  origen_id?: string | null
  origen_numero?: string | null
  lineas: LineaComprobante[]
  total_sin_iva: number
  iva: number
  total_con_iva: number
  editable: boolean
  puede_editar: boolean
  // Solo con la acción `editar_precio` de Ventas (F-VTA-06, FR-016): la base lo vuelve a verificar al guardar.
  puede_editar_precio: boolean
  updated_at: string
}

export type ClienteElegidoComprobante = { id: string; nombre: string; contacto: string }

export type FormularioComprobante = {
  tipo: TipoComprobante
  empresa_id: string
  cliente: ClienteElegidoComprobante | null
  canal: CanalVenta | ''
  fecha: string
  valido_hasta: string
}

export type CampoComprobante = 'tipo' | 'empresa_id' | 'cliente_id' | 'canal' | 'fecha' | 'valido_hasta' | 'forma_pago_id' | 'envio_id'
export type ErroresComprobante = Partial<Record<CampoComprobante, string>>

const CAMPOS: readonly CampoComprobante[] = ['tipo', 'empresa_id', 'cliente_id', 'canal', 'fecha', 'valido_hasta', 'forma_pago_id', 'envio_id']

export function formularioVacio(tipo: TipoComprobante, empresaId: string): FormularioComprobante {
  return { tipo, empresa_id: empresaId, cliente: null, canal: 'mostrador', fecha: hoyEnArgentina(), valido_hasta: '' }
}

export function aFormulario(comprobante: Comprobante): FormularioComprobante {
  return {
    tipo: comprobante.tipo,
    empresa_id: comprobante.empresa_id,
    cliente: {
      id: comprobante.cliente.id,
      nombre: comprobante.cliente.nombre,
      contacto: '',
    },
    canal: comprobante.canal ?? '',
    fecha: comprobante.fecha,
    valido_hasta: comprobante.valido_hasta ?? '',
  }
}

// Validación de pantalla (la base la repite: la autoridad es el servidor).
export function validarComprobante(formulario: FormularioComprobante, { esNuevo }: { esNuevo: boolean }): ErroresComprobante {
  const errores: ErroresComprobante = {}
  if (esNuevo && formulario.empresa_id === '') errores.empresa_id = 'Elegí la tienda.'
  if (formulario.cliente === null) errores.cliente_id = 'Elegí un cliente o Consumidor final.'
  if (formulario.canal === '') errores.canal = 'Elegí el canal de venta.'
  if (formulario.fecha === '') errores.fecha = 'Ingresá la fecha.'
  if (formulario.valido_hasta !== '') {
    if (formulario.tipo !== 'presupuesto') errores.valido_hasta = 'La validez solo aplica a presupuestos.'
    else if (formulario.fecha !== '' && formulario.valido_hasta < formulario.fecha) {
      errores.valido_hasta = 'La validez no puede ser anterior a la fecha.'
    }
  }
  return errores
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

export const MENSAJE_CERRADO = 'Este comprobante ya está cerrado: solo se puede consultar.'
export const MENSAJE_CONFLICTO_COMPROBANTE =
  'Otra persona modificó este comprobante mientras lo editabas. Recargá para ver sus cambios; no se guardó nada tuyo.'

export function esConflictoDeEdicion(error: unknown): boolean {
  return (error as ErrorDeBase)?.code === '40001'
}

export function esComprobanteInexistente(error: unknown): boolean {
  return (error as ErrorDeBase)?.code === 'P0002'
}

// Campo al que apunta un error de validación de la base (`hint`), con el mensaje en castellano que ella arma.
export function errorDeCampo(error: unknown): { campo: CampoComprobante; mensaje: string } | null {
  const e = error as ErrorDeBase
  if (e?.code !== '22023' || !e.hint || !e.message) return null
  const campo = CAMPOS.find((candidato) => candidato === e.hint)
  return campo ? { campo, mensaje: e.message } : null
}

export function mensajeDeErrorComprobante(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '40001') return MENSAJE_CONFLICTO_COMPROBANTE
  if (e?.code === '55000') return MENSAJE_CERRADO
  if (e?.code === 'P0002') return 'Ese comprobante no existe o no pertenece a tu organización.'
  // Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

function lanzarSiHayError(error: unknown): void {
  if (error) throw error
}

function aComprobante(dato: unknown): Comprobante {
  if (typeof dato !== 'object' || dato === null) throw new Error('La base no devolvió el comprobante')
  const bruto = dato as Record<string, unknown>
  const numero = (valor: unknown) => Number(valor ?? 0)
  return {
    ...(bruto as unknown as Comprobante),
    lineas: aLineas(bruto.lineas),
    puede_editar_precio: bruto.puede_editar_precio === true,
    total_sin_iva: numero(bruto.total_sin_iva),
    iva: numero(bruto.iva),
    total_con_iva: numero(bruto.total_con_iva),
  }
}

function vacioANulo(texto: string): string | null {
  const limpio = texto.trim()
  return limpio === '' ? null : limpio
}

// Datos de lectura del cliente recién elegido (antes de guardar): CUIT / DNI y dirección de entrega. La RLS de
// `clientes` acota a la organización; sin acceso a Clientes devuelve null y la pantalla muestra «—».
export async function obtenerClienteParaComprobante(id: string): Promise<ClienteComprobante | null> {
  const { data, error } = await supabaseClient
    .from('clientes')
    .select('id, nombre, documento, direccion, localidad, provincia, tipo, es_consumidor_final')
    .eq('id', id)
    .maybeSingle()
  lanzarSiHayError(error)
  if (!data) return null
  const fila = data as {
    id: string
    nombre: string
    documento: string | null
    direccion: string | null
    localidad: string | null
    provincia: string | null
    tipo: 'minorista' | 'mayorista'
    es_consumidor_final: boolean
  }
  const direccion = [fila.direccion, fila.localidad, fila.provincia].filter((parte) => parte && parte.trim() !== '').join(', ')
  return {
    id: fila.id,
    nombre: fila.nombre,
    documento: fila.documento,
    direccion: direccion === '' ? null : direccion,
    tipo: fila.tipo,
    es_consumidor_final: fila.es_consumidor_final,
  }
}

export async function obtenerComprobante(id: string): Promise<Comprobante> {
  const { data, error } = await supabaseClient.rpc('obtener_comprobante', { p_id: id })
  lanzarSiHayError(error)
  return aComprobante(data)
}

// `crear_comprobante` devuelve la fila creada. Se devuelve solo lo mínimo (id, tipo, número) y NO se relee acá:
// si una relectura fallara después de crear, la pantalla diría «No pudimos crear» y un reintento duplicaría el
// comprobante. La pantalla de `/:id` carga el documento completo y muestra su propio error de carga.
export async function crearComprobante(formulario: FormularioComprobante): Promise<{ id: string; tipo: TipoComprobante; numero: string }> {
  const { data, error } = await supabaseClient.rpc('crear_comprobante', {
    p_tipo: formulario.tipo,
    p_empresa_id: formulario.empresa_id,
    p_cliente_id: formulario.cliente?.id ?? null,
    p_canal: formulario.canal === '' ? null : formulario.canal,
    p_fecha: formulario.fecha,
    p_valido_hasta: formulario.tipo === 'presupuesto' ? vacioANulo(formulario.valido_hasta) : null,
    p_forma_pago_id: null,
    p_envio_id: null,
  })
  lanzarSiHayError(error)
  const creado = data as { id: string; tipo: TipoComprobante; numero: string }
  return { id: creado.id, tipo: creado.tipo, numero: creado.numero }
}

// Forma de pago y envío se conservan tal como están guardados: su elección es de MSF-139 (catálogos aún no
// disponibles en esta base) y esta pantalla todavía no los ofrece.
// Devuelve `null` si la RPC guardó pero la relectura falló: el cambio ya está en la base y reportarlo como
// «no pudimos guardar» llevaría a reintentar con el `updated_at` viejo (conflicto 40001 engañoso).
export async function guardarComprobante(comprobante: Comprobante, formulario: FormularioComprobante): Promise<Comprobante | null> {
  const { error } = await supabaseClient.rpc('guardar_comprobante', {
    p_id: comprobante.id,
    p_cliente_id: formulario.cliente?.id ?? null,
    p_canal: formulario.canal === '' ? null : formulario.canal,
    p_fecha: formulario.fecha,
    p_valido_hasta: comprobante.tipo === 'presupuesto' ? vacioANulo(formulario.valido_hasta) : null,
    p_forma_pago_id: comprobante.forma_pago_id,
    p_envio_id: comprobante.envio_id,
    p_actualizado_en: comprobante.updated_at,
  })
  lanzarSiHayError(error)
  try {
    return await obtenerComprobante(comprobante.id)
  } catch {
    return null
  }
}
