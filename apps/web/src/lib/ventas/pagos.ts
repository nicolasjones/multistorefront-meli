// Pagos y conciliación (F-VTA-13, FR-023…FR-027). El esquema, los límites y las RPC viven en
// las migraciones 20261216100000_conciliar_pago.sql … 20261216100200_resumen_pagos.sql; acá se
// espejan para la pantalla Pagos: la autoridad es la base (ella filtra por empresa accesible,
// calcula el saldo y aplica el bloqueo optimista).
// Contrato de las RPC: specs/20261024-150000-ventas-cobros-y-conciliacion/contracts/ventas-cobros-y-conciliacion.md
import { supabaseClient } from '../supabase'

// Fila del listado: lo que devuelve `public.listar_pagos`.
export type Pago = {
  id: string
  fecha: string
  empresa_id: string
  empresa: string
  comprobante_id: string
  numero: string
  // El nombre del cliente puede venir vacío: el rol puede tener Ventas sin Clientes y la RLS de
  // Clientes no le muestra las filas (la base no filtra el pago por eso).
  cliente: string | null
  cuenta_cobro_id: string
  cuenta_cobro: string | null
  importe: number
  // «Aprobado por»: el nombre de quien aprobó (o null si no está aprobado).
  aprobado_por: string | null
  conciliado: boolean
  // Lo que le queda al cliente en el comprobante del pago (no el total de la factura).
  saldo: number
  // La versión que viaja al conciliar: si el pago cambió, la base lo rechaza (40001).
  actualizado_en: string
}

// Las tres tarjetas de la pantalla: lo que devuelve `public.resumen_pagos`.
export type ResumenPagos = {
  por_conciliar_importe: number
  por_conciliar_cantidad: number
  conciliado_importe: number
  conciliado_cantidad: number
  saldo_pendiente: number
}

// La tarjeta Cuentas de cobro: lo que devuelve `public.cuentas_cobro_mas_usadas`.
export type CuentaCobroMasUsada = {
  id: string
  nombre: string
  banco: string | null
  // `false` = marcada «No usar»: conserva su historial y no se ofrece al cargar un comprobante.
  activa: boolean
  usos: number
  total_cuentas: number
}

// Lo que devuelven `conciliar_pago` y `revertir_conciliacion_pago` (la fila del libro de cobros).
export type PagoConciliado = {
  id: string
  importe: number
  cuenta_cobro_id: string | null
  aprobado_por: string | null
  aprobado_por_nombre: string | null
  aprobado_en: string | null
  actualizado_en: string
}

// Filtros del listado (FR-023): la tienda, la cuenta de cobro y «Solo con saldo».
export type FiltrosPagos = {
  // Id de la tienda por la que filtrar; null = todas las accesibles.
  empresaId: string | null
  // Id de la cuenta de cobro; null = todas.
  cuentaCobroId: string | null
  soloConSaldo: boolean
  pagina: number
  tamano: number
}

// El listado con su total: `filas` viene en cada fila de la RPC (el «de N» de la paginación).
export type ListadoPagos = {
  pagos: Pago[]
  total: number
}

type FilaListado = Omit<Pago, 'importe' | 'saldo'> & {
  importe: number | string
  saldo: number | string
  filas: number | string
}

// `public.listar_pagos`: los pagos con cuenta de cobro de la empresa elegida (o de todas las
// accesibles), con filtros, paginación y el saldo del comprobante.
export async function listarPagos(filtros: FiltrosPagos): Promise<ListadoPagos> {
  const { data, error } = await supabaseClient.rpc('listar_pagos', {
    p_empresa_id: filtros.empresaId,
    p_cuenta_cobro_id: filtros.cuentaCobroId,
    p_solo_con_saldo: filtros.soloConSaldo,
    p_pagina: filtros.pagina,
    p_tamano: filtros.tamano,
  })
  if (error) throw error
  const filas = (data ?? []) as FilaListado[]
  return {
    pagos: filas.map(({ filas: _filas, ...fila }) => ({
      ...fila,
      importe: Number(fila.importe),
      saldo: Number(fila.saldo),
    })),
    total: filas.length > 0 ? Number(filas[0].filas) : 0,
  }
}

// `public.resumen_pagos`: los totales de las tres tarjetas (Por conciliar, Conciliado y Saldo
// pendiente de clientes).
export async function resumenPagos(empresaId: string | null): Promise<ResumenPagos> {
  const { data, error } = await supabaseClient.rpc('resumen_pagos', { p_empresa_id: empresaId })
  if (error) throw error
  const fila = ((data ?? []) as Array<{
    por_conciliar_importe?: number | string
    por_conciliar_cantidad?: number | string
    conciliado_importe?: number | string
    conciliado_cantidad?: number | string
    saldo_pendiente?: number | string
  }>)[0]
  return {
    por_conciliar_importe: Number(fila?.por_conciliar_importe ?? 0),
    por_conciliar_cantidad: Number(fila?.por_conciliar_cantidad ?? 0),
    conciliado_importe: Number(fila?.conciliado_importe ?? 0),
    conciliado_cantidad: Number(fila?.conciliado_cantidad ?? 0),
    saldo_pendiente: Number(fila?.saldo_pendiente ?? 0),
  }
}

// `public.cuentas_cobro_mas_usadas`: las cuentas de la organización (o de la empresa elegida)
// ordenadas por usos, con el total de cuentas cargadas.
export async function cuentasCobroMasUsadas(
  empresaId: string | null,
  limite = 8,
): Promise<CuentaCobroMasUsada[]> {
  const { data, error } = await supabaseClient.rpc('cuentas_cobro_mas_usadas', {
    p_empresa_id: empresaId,
    p_limite: limite,
  })
  if (error) throw error
  const filas = (data ?? []) as Array<Omit<CuentaCobroMasUsada, 'usos' | 'total_cuentas'> & {
    usos: number | string
    total_cuentas: number | string
  }>
  return filas.map((fila) => ({
    ...fila,
    usos: Number(fila.usos),
    total_cuentas: Number(fila.total_cuentas),
  }))
}

// `public.conciliar_pago`: aprueba el pago contra el extracto del banco. La versión que se
// leyó viaja en `actualizadoEn` (bloqueo optimista: si el pago cambió, la base lo rechaza).
export async function conciliarPago(id: string, actualizadoEn: string): Promise<PagoConciliado> {
  const { data, error } = await supabaseClient.rpc('conciliar_pago', {
    p_id: id,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  return aPagoConciliado(data)
}

// `public.revertir_conciliacion_pago`: deshace la aprobación.
export async function revertirConciliacionPago(id: string, actualizadoEn: string): Promise<PagoConciliado> {
  const { data, error } = await supabaseClient.rpc('revertir_conciliacion_pago', {
    p_id: id,
    p_actualizado_en: actualizadoEn,
  })
  if (error) throw error
  return aPagoConciliado(data)
}

type FilaConciliada = {
  id: string
  importe: number | string
  cuenta_cobro_id: string | null
  aprobado_por: string | null
  aprobado_por_nombre: string | null
  aprobado_en: string | null
  actualizado_en: string
}

function aPagoConciliado(fila: unknown): PagoConciliado {
  const dato = fila as FilaConciliada
  return {
    id: dato.id,
    importe: Number(dato.importe),
    cuenta_cobro_id: dato.cuenta_cobro_id,
    aprobado_por: dato.aprobado_por,
    aprobado_por_nombre: dato.aprobado_por_nombre,
    aprobado_en: dato.aprobado_en,
    actualizado_en: dato.actualizado_en,
  }
}

type ErrorBase = { code?: string; message?: string } | null

// El mensaje crudo de Postgres/PostgREST puede nombrar políticas, restricciones o columnas: al
// usuario va solo el texto en castellano. A la consola va solo el código.
export function mensajeDeErrorPagos(error: unknown, porDefecto: string): string {
  const e = error as ErrorBase
  const code = e?.code
  console.error(porDefecto, code ?? 'sin código')
  if (code === '40001') {
    return 'El pago fue modificado por otra persona. Recargá la lista e intentá de nuevo.'
  }
  if (code === '42501') {
    return 'Tu rol no puede conciliar pagos en esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (code === 'P0002') return 'Ese pago no existe o no pertenece a tu organización.'
  // El mensaje de la base (22023) ya está en castellano y no nombra tablas ni columnas.
  if (code === '22023' && e?.message) return e.message
  return porDefecto
}
