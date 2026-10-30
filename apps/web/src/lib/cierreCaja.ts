// Cierre de caja diario (F-VTA-33, FR-021, FR-023, FR-024). El esquema y las RPC viven en las
// migraciones 20270115100000_cierres_caja.sql … 20270115100200_bloqueo_cobros_cerrados.sql; acá se
// espejan para la pantalla: la autoridad es la base (ella exige Administrador, filtra por empresa
// accesible y bloquea los cobros de un día cerrado).
// Contrato: specs/20261027-100000-ventas-mejoras/contracts/ventas-mejoras.md
import { hoyEnOrganizacion } from './periodosRanking'
import { supabaseClient } from './supabase'

export type DetalleCierre = {
  forma_pago_id: string
  forma_pago: string
  cuenta_cobro_id: string | null
  cuenta_cobro: string | null
  total: number
}

// Fila del listado: lo que devuelve `public.listar_cierres_caja`.
export type CierreCaja = {
  id: string
  empresa_id: string
  empresa: string
  fecha: string
  estado: 'abierta' | 'cerrada' | 'reabierta'
  total: number
  cerrado_por: string | null
  cerrado_en: string | null
  detalle: DetalleCierre[]
}

export type ListadoCierres = { cierres: CierreCaja[]; total: number }

type FilaListado = Omit<CierreCaja, 'total' | 'detalle'> & {
  total: number | string
  detalle: Array<Omit<DetalleCierre, 'total'> & { total: number | string }> | null
  filas: number | string
}

export const ETIQUETA_ESTADO: Record<CierreCaja['estado'], string> = {
  abierta: 'Abierta',
  cerrada: 'Cerrada',
  reabierta: 'Reabierta',
}

export async function listarCierresCaja(
  empresaId: string | null,
  pagina: number,
  tamano: number,
): Promise<ListadoCierres> {
  const { data, error } = await supabaseClient.rpc('listar_cierres_caja', {
    p_empresa_id: empresaId,
    p_pagina: pagina,
    p_tamano: tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    cierres: filas.map(({ filas: _filas, ...fila }) => ({
      ...fila,
      total: Number(fila.total),
      detalle: (fila.detalle ?? []).map((d) => ({ ...d, total: Number(d.total) })),
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

// `public.cerrar_caja`: idempotente (un segundo cierre del mismo día devuelve el existente).
export async function cerrarCaja(empresaId: string, fecha: string): Promise<void> {
  const { error } = await supabaseClient.rpc('cerrar_caja', { p_empresa_id: empresaId, p_fecha: fecha })
  if (error) throw error
}

// `public.reabrir_caja`: idempotente.
export async function reabrirCaja(cierreId: string): Promise<void> {
  const { error } = await supabaseClient.rpc('reabrir_caja', { p_cierre_id: cierreId })
  if (error) throw error
}

type ErrorBase = { code?: string; message?: string }

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas o columnas: al usuario va solo el
// texto en castellano. A la consola va solo el código.
export function mensajeDeErrorCierreCaja(error: unknown, porDefecto: string): string {
  const e = error as ErrorBase
  console.error(porDefecto, e?.code ?? 'sin código')
  if (e?.code === '42501') return 'Solo un administrador puede cerrar o reabrir la caja.'
  if (e?.code === 'P0002') return 'Ese cierre no existe o no pertenece a tu organización.'
  if (e?.code === '22023' && e?.message) return e.message
  return porDefecto
}

// Hoy en Buenos Aires (única zona en uso hoy), como `YYYY-MM-DD`. La base valida con `organizaciones.zona_horaria`
// (`private.hoy_caja`): si una organización usa otra zona, hay que leerla de ahí. Seguimiento, no bloquea.
export function fechaDeHoy(ahora: Date = new Date()): string {
  return hoyEnOrganizacion(ahora)
}
