// Envíos en moto (F-VTA-24, MSF-145, FR-003…FR-008). El esquema y las RPC viven en las migraciones
// 20270222200100_envios_moto.sql y 20270222200200_envios_moto_rpc.sql; acá se espejan solo para
// validar en el diálogo antes de viajar y para traducir los errores (la autoridad es la base).
// Contrato de las RPC: specs/20261024-130000-ventas-motos/contracts/ventas-motos.md
import { supabaseClient } from '../supabase'

// Mismos límites que los CHECK de dominio.envios_moto: mantener alineados.
export const MENSAJERO_MAXIMO = 100
// numeric(14,2): hasta 12 dígitos enteros.
export const IMPORTE_MAXIMO = 999_999_999_999.99

// Fila de `public.listar_envios_moto` (sin el total, que viaja en cada fila como `filas`).
export type EnvioMoto = {
  id: string
  comprobante_id: string
  comprobante_numero: string
  empresa_id: string
  empresa: string
  // `date` de la base (AAAA-MM-DD).
  fecha: string
  // El nombre del cliente puede venir vacío: la RLS de Clientes es más restrictiva que la de Ventas.
  cliente: string | null
  mensajero: string
  guia: string | null
  costo_envio: number
  abono: number
  enviado: boolean
  rendido: boolean
  rendido_en: string | null
  // Versión del bloqueo optimista: es el `p_actualizado_en` de la edición.
  actualizado_en: string
  // Permisos del llamador en la empresa del envío, resueltos por el servidor (rol y sección).
  puede_editar: boolean
  puede_rendir: boolean
}

export type PaginaEnviosMoto = {
  envios: EnvioMoto[]
  // N: envíos que cumplen el filtro por tienda.
  total: number
}

// Fila de `public.comprobantes_para_envio_moto`: una factura elegible para el selector.
export type ComprobanteParaEnvio = {
  id: string
  numero: string
  empresa_id: string
  empresa: string
  fecha: string
  cliente: string | null
}

export type FormularioEnvioMoto = {
  mensajero: string
  guia: string
  // Texto: admite coma decimal («3500,50»).
  costo_envio: string
  abono: string
  enviado: boolean
}

export type CampoEnvioMoto = 'comprobante' | 'mensajero' | 'costo_envio' | 'abono'
export type ErroresEnvioMoto = Partial<Record<CampoEnvioMoto, string>>

export const FORMULARIO_ENVIO_MOTO_VACIO: FormularioEnvioMoto = {
  mensajero: '', guia: '', costo_envio: '0', abono: '0', enviado: false,
}

type ErrorBase = { code?: string; message?: string } | null

// El detalle crudo de Postgres/PostgREST puede nombrar políticas, tablas o columnas: en la consola
// queda solo el código (mismo criterio que contrarreembolsos).
export function codigoDeError(error: unknown): string {
  return (error as ErrorBase)?.code ?? 'sin código'
}

export const MENSAJE_CONFLICTO =
  'Otra persona modificó este envío mientras lo editabas. Recargá para ver el estado actual.'

// Los errores de la RPC se traducen a castellano y nunca se muestra el detalle crudo de Postgres.
// Los mensajes `22023` de la base ya están en castellano y no nombran tablas ni columnas.
export function mensajeDeErrorEnvioMoto(error: unknown, porDefecto: string): string {
  console.error(porDefecto, codigoDeError(error))
  const e = error as ErrorBase
  if (e?.code === '40001') return MENSAJE_CONFLICTO
  if (e?.code === '42501') {
    return 'Tu rol no puede registrar ni editar envíos en moto en esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (e?.code === '55000') return 'El envío ya está rendido: es de solo lectura y no se puede modificar.'
  if (e?.code === '23505') return 'Ese comprobante ya tiene un envío en moto registrado.'
  if (e?.code === 'P0002') return 'Ese envío no existe o no pertenece a tu organización.'
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

export const esConflicto = (error: unknown): boolean => (error as ErrorBase)?.code === '40001'

// Mensajero sin espacios sobrantes (la base lo normaliza igual al escribir).
export function normalizarMensajero(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ')
}

// Clave para agrupar mensajeros: sin mayúsculas ni espacios sobrantes (decisión de producto 1).
export function claveMensajero(valor: string): string {
  return normalizarMensajero(valor).toLowerCase()
}

const FORMATO_IMPORTE = /^\d+(?:[.,]\d{1,2})?$/

// Importe del formulario → número, o `null` si no es un importe válido (de 0 en adelante, con hasta
// dos decimales y coma o punto como separador).
export function aImporte(texto: string): number | null {
  const limpio = texto.trim()
  if (!FORMATO_IMPORTE.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  return Number.isFinite(valor) && valor <= IMPORTE_MAXIMO ? valor : null
}

function errorDeImporte(texto: string, nombre: string): string | undefined {
  if (texto.trim() === '') return `Ingresá ${nombre} (0 si no hay).`
  if (aImporte(texto) === null) return `${nombre[0].toUpperCase()}${nombre.slice(1)} debe ser un importe de 0 en adelante, con hasta dos decimales.`
  return undefined
}

// Validación previa al envío (FR-004): mensajero obligatorio e importes de 0 en adelante. La base
// vuelve a validar todo (FR-003).
export function validarEnvioMoto(
  formulario: FormularioEnvioMoto,
  comprobante: { requerido: boolean; elegido: boolean },
): ErroresEnvioMoto {
  const errores: ErroresEnvioMoto = {}
  if (comprobante.requerido && !comprobante.elegido) errores.comprobante = 'Elegí la factura del envío.'
  const mensajero = normalizarMensajero(formulario.mensajero)
  if (mensajero === '') errores.mensajero = 'Escribí el nombre del mensajero.'
  else if (mensajero.length > MENSAJERO_MAXIMO) errores.mensajero = `El mensajero no puede superar los ${MENSAJERO_MAXIMO} caracteres.`
  const costo = errorDeImporte(formulario.costo_envio, 'el costo de envío')
  if (costo) errores.costo_envio = costo
  const abono = errorDeImporte(formulario.abono, 'lo que abona al recibir')
  if (abono) errores.abono = abono
  return errores
}

export function aFormulario(envio: EnvioMoto): FormularioEnvioMoto {
  return {
    mensajero: envio.mensajero,
    guia: envio.guia ?? '',
    costo_envio: String(envio.costo_envio).replace('.', ','),
    abono: String(envio.abono).replace('.', ','),
    enviado: envio.enviado,
  }
}

const aNumero = (valor: number | string | null | undefined): number => Number(valor ?? 0)

type FilaListado = Omit<EnvioMoto, 'costo_envio' | 'abono'> & {
  costo_envio: number | string
  abono: number | string
  filas: number | string
}

// Listado paginado (`public.listar_envios_moto`): el navegador nunca descarga la lista completa.
// Filtra por tienda; el total viene del servidor (`filas`). PostgREST entrega los `numeric` como
// número o como texto según el valor: se convierten a número.
export async function listarEnviosMoto({ empresaId, pagina, tamano }: {
  empresaId: string | null
  pagina: number
  tamano: number
}): Promise<PaginaEnviosMoto> {
  const { data, error } = await supabaseClient.rpc('listar_envios_moto', {
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    envios: filas.map(({ filas: _total, ...envio }) => ({
      ...envio,
      costo_envio: aNumero(envio.costo_envio),
      abono: aNumero(envio.abono),
      guia: envio.guia ?? null,
      rendido_en: envio.rendido_en ?? null,
      puede_editar: envio.puede_editar === true,
      puede_rendir: envio.puede_rendir === true,
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

// Facturas elegibles para el selector del diálogo (forma de envío moto, sin envío registrado).
export async function comprobantesParaEnvioMoto({ empresaId, busqueda }: {
  empresaId: string | null
  busqueda: string
}): Promise<ComprobanteParaEnvio[]> {
  const texto = busqueda.trim()
  const { data, error } = await supabaseClient.rpc('comprobantes_para_envio_moto', {
    p_empresa_id: empresaId,
    p_busqueda: texto === '' ? null : texto,
  })
  if (error) throw error
  return ((data ?? []) as ComprobanteParaEnvio[]).map((c) => ({ ...c, cliente: c.cliente ?? null }))
}

type DatosEnvio = {
  mensajero: string
  guia: string
  costo_envio: number
  abono: number
  enviado: boolean
}

// Del formulario ya validado a los argumentos de la RPC (sin espacios sobrantes; guía vacía = nula).
function aDatos(formulario: FormularioEnvioMoto): DatosEnvio {
  const costo = aImporte(formulario.costo_envio)
  const abono = aImporte(formulario.abono)
  if (costo === null || abono === null) throw new Error('Los importes del envío no son válidos.')
  return {
    mensajero: normalizarMensajero(formulario.mensajero),
    guia: formulario.guia.trim(),
    costo_envio: costo,
    abono,
    enviado: formulario.enviado,
  }
}

// `registrar_envio_moto` devuelve la fila de `dominio.envios_moto` (no el listado).
export async function registrarEnvioMoto(comprobanteId: string, formulario: FormularioEnvioMoto): Promise<{ id: string }> {
  if (comprobanteId.trim() === '') throw new Error('Falta elegir el comprobante del envío.')
  const datos = aDatos(formulario)
  const { data, error } = await supabaseClient.rpc('registrar_envio_moto', {
    p_comprobante_id: comprobanteId,
    p_mensajero: datos.mensajero,
    p_guia: datos.guia === '' ? null : datos.guia,
    p_costo_envio: datos.costo_envio,
    p_abono: datos.abono,
    p_enviado: datos.enviado,
  })
  if (error) throw error
  if (!data) throw new Error('La base no devolvió el envío registrado: no se puede confirmar el alta.')
  return data as { id: string }
}

// `actualizar_envio_moto`: bloqueo optimista con la versión leída en pantalla; nunca toca
// `rendido` ni `rendido_en`.
export async function actualizarEnvioMoto(envio: Pick<EnvioMoto, 'id' | 'actualizado_en'>, formulario: FormularioEnvioMoto): Promise<{ id: string }> {
  if (envio.id.trim() === '') throw new Error('El envío no tiene id: no se puede editar.')
  if (envio.actualizado_en.trim() === '') throw new Error('El envío no tiene versión leída: recargá la lista e intentá de nuevo.')
  const datos = aDatos(formulario)
  const { data, error } = await supabaseClient.rpc('actualizar_envio_moto', {
    p_id: envio.id,
    p_mensajero: datos.mensajero,
    p_guia: datos.guia === '' ? null : datos.guia,
    p_costo_envio: datos.costo_envio,
    p_abono: datos.abono,
    p_enviado: datos.enviado,
    p_actualizado_en: envio.actualizado_en,
  })
  if (error) throw error
  if (!data) throw new Error('La base no devolvió el envío actualizado: no se puede confirmar el cambio.')
  return data as { id: string }
}
