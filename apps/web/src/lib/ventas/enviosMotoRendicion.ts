// Rendición de motos (F-VTA-25, MSF-145, FR-020…FR-023). Las RPC viven en la migración
// 20270222300100_rendir_envios_moto.sql; acá se espejan para calcular el total del diálogo y
// traducir los errores (la autoridad es la base, que devuelve los mismos totales al rendir).
// Contrato: specs/20261024-130000-ventas-motos/contracts/ventas-motos.md
import { supabaseClient } from '../supabase'
import { claveMensajero, codigoDeError, type EnvioMoto } from './enviosMoto'

// Lo que devuelve `public.rendir_envios_moto`.
export type ResultadoRendicion = {
  cantidad: number
  // Nulo si no quedó nada pendiente (todo estaba ya rendido).
  mensajero: string | null
  total_abono: number
  total_costo: number
  neto: number
}

// Lo que devuelve `public.resumen_motos_sin_rendir`: la tarjeta «Motos sin rendir».
export type ResumenMotos = { monto: number; entregas: number }

// Totales del diálogo de lote (FR-022). Se suman en centavos para no arrastrar errores de coma
// flotante. El total a rendir es el efectivo cobrado: el costo no se resta de él.
export type TotalesSeleccion = {
  cantidad: number
  efectivoCobrado: number
  costoEnvios: number
  totalARendir: number
  neto: number
}

const aCentavos = (valor: number) => Math.round(valor * 100)

export function totalesDeSeleccion(envios: ReadonlyArray<Pick<EnvioMoto, 'abono' | 'costo_envio'>>): TotalesSeleccion {
  const abono = envios.reduce((suma, e) => suma + aCentavos(e.abono), 0)
  const costo = envios.reduce((suma, e) => suma + aCentavos(e.costo_envio), 0)
  return {
    cantidad: envios.length,
    efectivoCobrado: abono / 100,
    costoEnvios: costo / 100,
    totalARendir: abono / 100,
    neto: (abono - costo) / 100,
  }
}

// Mensajeros distintos de la selección, sin mayúsculas ni espacios sobrantes; devuelve el nombre
// tal como se cargó la primera vez (para mostrarlo).
export function mensajerosDeSeleccion(envios: ReadonlyArray<Pick<EnvioMoto, 'mensajero'>>): string[] {
  const vistos = new Map<string, string>()
  for (const e of envios) {
    const clave = claveMensajero(e.mensajero)
    if (!vistos.has(clave)) vistos.set(clave, e.mensajero.trim())
  }
  return [...vistos.values()]
}

// Un envío se puede rendir si está enviado, sin rendir, y la persona puede rendir en su tienda.
export const esRendible = (e: Pick<EnvioMoto, 'enviado' | 'rendido' | 'puede_rendir'>): boolean =>
  e.puede_rendir && e.enviado && !e.rendido

type ErrorBase = { code?: string; message?: string } | null

export function mensajeDeErrorRendicion(error: unknown, porDefecto: string): string {
  console.error(porDefecto, codigoDeError(error))
  const e = error as ErrorBase
  if (e?.code === '42501') return 'Solo el Administrador puede rendir entregas. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '40001') return 'Otra persona modificó estos envíos mientras los rendías. Recargá para ver el estado actual.'
  // Los mensajes de validación de la base (mezcla de mensajeros, envío sin enviar, id ajeno) están en castellano.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

type Respuesta = Partial<Record<keyof ResultadoRendicion, number | string | null>>

// `rendir_envios_moto`: todo o nada e idempotente. Los ids ya rendidos se ignoran en el servidor.
export async function rendirEnviosMoto(ids: ReadonlyArray<string>): Promise<ResultadoRendicion> {
  if (ids.length === 0) throw new Error('No hay envíos para rendir.')
  const { data, error } = await supabaseClient.rpc('rendir_envios_moto', { p_ids: [...ids] })
  if (error) throw error
  if (!data) throw new Error('La base no devolvió el resultado de la rendición: no se puede confirmar.')
  const r = data as Respuesta
  return {
    cantidad: Number(r.cantidad ?? 0),
    mensajero: typeof r.mensajero === 'string' ? r.mensajero : null,
    total_abono: Number(r.total_abono ?? 0),
    total_costo: Number(r.total_costo ?? 0),
    neto: Number(r.neto ?? 0),
  }
}

// Tarjeta «Motos sin rendir»: suma del abono de lo no rendido con abono > 0 y su cantidad.
export async function resumenMotosSinRendir(empresaId: string | null): Promise<ResumenMotos> {
  const { data, error } = await supabaseClient.rpc('resumen_motos_sin_rendir', { p_empresa_id: empresaId })
  if (error) throw error
  const fila = ((data ?? []) as Array<{ monto?: number | string; entregas?: number | string }>)[0]
  return { monto: Number(fila?.monto ?? 0), entregas: Number(fila?.entregas ?? 0) }
}
