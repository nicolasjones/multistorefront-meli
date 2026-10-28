// Contrarreembolsos por transporte (F-VTA-14, FR-045 y FR-047). El esquema, los límites y las RPC
// viven en las migraciones 20270114120000_contrarreembolsos.sql …
// 20270114120200_listar_contrarreembolsos.sql; acá se espejan para que la pantalla no hable con la
// base en crudo (la autoridad es el servidor: la base vuelve a validar todo).
// Contrato de las RPC: specs/20261024-150000-ventas-cobros-y-conciliacion/contracts/ventas-cobros-y-conciliacion.md
import { supabaseClient } from '../supabase'

// Los dos estados del libro de contrarreembolsos (`dominio.contrarreembolsos.estado`).
export type EstadoContrarreembolso = 'pendiente' | 'cobrado'

export const ESTADOS_CONTRARREEMBOLSO: ReadonlyArray<EstadoContrarreembolso> = ['pendiente', 'cobrado']

// Fila del listado: lo que devuelve `public.listar_contrarreembolsos`.
export type Contrarreembolso = {
  id: string
  fecha: string
  empresa_id: string
  empresa: string
  comprobante_id: string
  numero: string
  // El nombre del cliente puede venir vacío: la RLS de Clientes es más restrictiva que la de
  // Ventas y un rol que no lee Clientes igual ve el contrarreembolso.
  cliente: string | null
  transporte_id: string
  transporte: string
  guia: string
  importe: number
  estado: EstadoContrarreembolso
  // Versión del bloqueo optimista: es el `p_actualizado_en` del «Marcar cobrado».
  actualizado_en: string
}

// Lo que devuelve `public.marcar_contrarreembolso_cobrado`: la FILA de `dominio.contrarreembolsos`
// (la RPC devuelve la tabla, no el listado). No trae los nombres de la tienda, la factura ni el
// transporte: esos salen de los `join` del listado, así que el tipo no los inventa.
export type ContrarreembolsoCobrado = {
  id: string
  organizacion_id: string
  empresa_id: string
  comprobante_id: string
  transporte_id: string
  guia: string
  importe: number
  estado: EstadoContrarreembolso
  // Quién lo cobró y cuándo: nulos mientras está pendiente.
  cobrado_por: string | null
  cobrado_por_nombre: string | null
  cobrado_en: string | null
  // El cobro del libro que dejó el transporte al rinde: nulo mientras está pendiente.
  cobro_id: string | null
  creado_en: string
  actualizado_en: string
}

// Lo que devuelve `public.resumen_contrarreembolsos`: las tarjetas de la pantalla.
export type ResumenContrarreembolsos = {
  pendiente_importe: number
  pendiente_cantidad: number
  cobrado_mes_importe: number
}

export type PaginaContrarreembolsos = {
  contrarreembolsos: Contrarreembolso[]
  // N: contrarreembolsos que cumplen el filtro (el «1–10 de N» de la pantalla).
  total: number
}

export type FiltroContrarreembolsos = {
  // Tienda: la empresa activa de la barra superior (Principio VIII). `null` = todas las accesibles.
  empresaId: string | null
  // `null` = los dos estados.
  estado: EstadoContrarreembolso | null
  pagina: number
  tamano: number
}

type ErrorBase = { code?: string; message?: string } | null

export const MENSAJE_CONFLICTO =
  'Otra persona modificó este contrarreembolso mientras lo cobraba. Recargá para ver el estado actual.'

// El detalle crudo de Postgres/PostgREST puede nombrar políticas, tablas o columnas: en la consola
// queda solo el código (mismo criterio que `mensajeDeError` de transportes).
export function codigoDeError(error: unknown): string {
  return (error as ErrorBase)?.code ?? 'sin código'
}

// La RPC rechaza con estos códigos; al usuario va un texto en castellano y nunca el detalle crudo
// de Postgres (que puede nombrar tablas, columnas o políticas).
export function mensajeDeErrorContrarreembolso(error: unknown, porDefecto: string): string {
  console.error(porDefecto, codigoDeError(error))
  const e = error as ErrorBase
  if (e?.code === '40001') return MENSAJE_CONFLICTO
  if (e?.code === '42501') {
    return 'Tu rol no puede cobrar contrarreembolsos en esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (e?.code === '55000') return 'La factura está anulada: el contrarreembolso no se puede cobrar.'
  if (e?.code === 'P0002') return 'Ese contrarreembolso no existe o no pertenece a tu organización.'
  // Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

// El estado viaja como texto a la RPC: se acota a los dos valores del CHECK de la base para no
// mandar un estado inventado y comerse un error del servidor.
function estadoValido(estado: EstadoContrarreembolso | null): EstadoContrarreembolso | null {
  if (estado === null) return null
  return ESTADOS_CONTRARREEMBOLSO.includes(estado) ? estado : null
}

// Listado paginado (`public.listar_contrarreembolsos`): el navegador nunca descarga la lista
// completa. Filtra por tienda y por estado; el total viene del servidor (`filas`).
export async function listarContrarreembolsos({
  empresaId,
  estado,
  pagina,
  tamano,
}: FiltroContrarreembolsos): Promise<PaginaContrarreembolsos> {
  const { data, error } = await supabaseClient.rpc('listar_contrarreembolsos', {
    p_empresa_id: empresaId,
    p_estado: estadoValido(estado),
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as Array<
    Omit<Contrarreembolso, 'importe'> & { importe: number | string; filas: number | string }
  >
  return {
    contrarreembolsos: filas.map(({ filas: _total, ...contrarreembolso }) => ({
      ...contrarreembolso,
      importe: Number(contrarreembolso.importe),
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

// Totales de las tarjetas (`public.resumen_contrarreembolsos`): importe y cantidad pendientes, e
// importe cobrado en el mes en curso.
export async function resumenContrarreembolsos(empresaId: string | null): Promise<ResumenContrarreembolsos> {
  const { data, error } = await supabaseClient.rpc('resumen_contrarreembolsos', { p_empresa_id: empresaId })
  if (error) throw error
  const fila = ((data ?? []) as Array<{
    pendiente_importe?: number | string
    pendiente_cantidad?: number | string
    cobrado_mes_importe?: number | string
  }>)[0]
  return {
    pendiente_importe: Number(fila?.pendiente_importe ?? 0),
    pendiente_cantidad: Number(fila?.pendiente_cantidad ?? 0),
    cobrado_mes_importe: Number(fila?.cobrado_mes_importe ?? 0),
  }
}

// Permiso de la acción `cobrar_contrarreembolso` en una empresa (FR-041 y FR-047): la pantalla
// oculta el botón «Marcar cobrado» sin permiso. La autorización real la hace
// `public.marcar_contrarreembolso_cobrado`; esta lectura solo evita ofrecer lo que la base va a
// rechazar. Ante un error se responde «no»: sin permiso no se ofrece la acción.
export async function puedeCobrarContrarreembolso(empresaId: string): Promise<boolean> {
  if (empresaId.trim() === '') return false
  const { data, error } = await supabaseClient.rpc('puede_cobrar_contrarreembolso', { p_empresa_id: empresaId })
  if (error) throw error
  return data === true
}

// «Marcar cobrado» (`public.marcar_contrarreembolso_cobrado`): idempotente y con bloqueo
// optimista, así que la versión leída en pantalla viaja tal cual. La base es la que valida el
// permiso (`cobrar_contrarreembolso` de la empresa del contrarreembolso) y rechaza las facturas
// anuladas; el `importe` lo toma del propio contrarreembolso, no de la pantalla.
// Devuelve la fila de `dominio.contrarreembolsos` (no el listado): los nombres de la tienda, la
// factura y el transporte NO vienen aquí, y el tipo no los promete.
export async function marcarContrarreembolsoCobrado(
  id: string,
  actualizadoEn: string,
): Promise<ContrarreembolsoCobrado> {
  if (id.trim() === '') throw new Error('El contrarreembolso no tiene id: no se puede marcar como cobrado.')
  if (actualizadoEn.trim() === '') {
    throw new Error('El contrarreembolso no tiene versión leída: recargá la lista e intentá de nuevo.')
  }
  const { data, error } = await supabaseClient.rpc('marcar_contrarreembolso_cobrado', {
    p_id: id,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  // La RPC devuelve la fila de `dominio.contrarreembolsos`: si no llega fila, es un fallo de la
  // base, no un contrarreembolso cobrado en silencio.
  if (!data) throw new Error('La base no devolvió el contrarreembolso cobrado: no se puede confirmar el cobro.')
  const fila = data as ContrarreembolsoCobrado & { importe: number | string }
  return { ...fila, importe: Number(fila.importe) }
}
