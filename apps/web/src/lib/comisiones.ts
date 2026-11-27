import { supabaseClient } from './supabase'
import { mensajeDeErrorBase } from './mensajeErrorBase'

// Comisiones de técnicos de Service (reglas, reparto entre técnicos, «Mis comisiones»). Todo pasa por RPC: las tablas no
// admiten escritura directa. La base manda: acá solo se arma el período, se valida el reparto para avisar antes de enviar y
// se traducen los errores. Decisiones y fórmulas: docs/service-comisiones.md.

export type FilaComision = {
  reparacion_id: string
  codigo: string
  empresa: string | null
  equipo: string | null
  entrega_real: string
  // Mano de obra al cliente sin IVA (nunca costos internos).
  base: number
  porcentaje_reparto: number
  // Nulo = ninguna regla de comisión rige para esa fecha de entrega (comisión 0).
  porcentaje_regla: number | null
  comision: number
}

export type DetalleComisiones = {
  desde: string
  hasta: string
  total: number
  reparaciones: number
  sin_regla: number
  truncado: boolean
  filas: FilaComision[]
}

export type TecnicoResumen = {
  tecnico_id: string | null
  nombre: string
  reparaciones: number
  base: number
  comision: number
  sin_regla: number
}

export type ResumenComisiones = {
  desde: string
  hasta: string
  total: number
  reparaciones: number
  sin_regla: number
  tecnicos: TecnicoResumen[]
}

export type EstadoRegla = 'vigente' | 'futura' | 'reemplazada'

export type ReglaComision = {
  id: string
  tecnico_id: string | null
  tecnico: string | null
  porcentaje: number
  vigente_desde: string
  estado: EstadoRegla
}

export type LineaReparto = { tecnico_id: string | null; nombre: string; porcentaje: number }

export type RepartoComision = {
  reparacion_id: string
  congelado: boolean
  anulada: boolean
  por_defecto: boolean
  puede_editar: boolean
  reparto: LineaReparto[]
}

export type LineaRepartoEnvio = { tecnico_id: string; porcentaje: number }

export const MAX_TECNICOS_REPARTO = 10

const numero = (valor: unknown): number => Number(valor ?? 0)

export function aDetalleComisiones(dato: unknown): DetalleComisiones {
  const bruto = (dato ?? {}) as Record<string, unknown>
  const filas = Array.isArray(bruto.filas) ? (bruto.filas as Record<string, unknown>[]) : []
  return {
    desde: String(bruto.desde ?? ''),
    hasta: String(bruto.hasta ?? ''),
    total: numero(bruto.total),
    reparaciones: numero(bruto.reparaciones),
    sin_regla: numero(bruto.sin_regla),
    truncado: bruto.truncado === true,
    filas: filas.map((fila) => ({
      ...(fila as unknown as FilaComision),
      base: numero(fila.base),
      porcentaje_reparto: numero(fila.porcentaje_reparto),
      porcentaje_regla: fila.porcentaje_regla === null || fila.porcentaje_regla === undefined ? null : numero(fila.porcentaje_regla),
      comision: numero(fila.comision),
    })),
  }
}

export function aResumenComisiones(dato: unknown): ResumenComisiones {
  const bruto = (dato ?? {}) as Record<string, unknown>
  const tecnicos = Array.isArray(bruto.tecnicos) ? (bruto.tecnicos as Record<string, unknown>[]) : []
  return {
    desde: String(bruto.desde ?? ''),
    hasta: String(bruto.hasta ?? ''),
    total: numero(bruto.total),
    reparaciones: numero(bruto.reparaciones),
    sin_regla: numero(bruto.sin_regla),
    tecnicos: tecnicos.map((t) => ({
      ...(t as unknown as TecnicoResumen),
      reparaciones: numero(t.reparaciones),
      base: numero(t.base),
      comision: numero(t.comision),
      sin_regla: numero(t.sin_regla),
    })),
  }
}

export function aReparto(dato: unknown): RepartoComision {
  const bruto = (dato ?? {}) as Record<string, unknown>
  const lineas = Array.isArray(bruto.reparto) ? (bruto.reparto as Record<string, unknown>[]) : []
  return {
    reparacion_id: String(bruto.reparacion_id ?? ''),
    congelado: bruto.congelado === true,
    anulada: bruto.anulada === true,
    por_defecto: bruto.por_defecto === true,
    puede_editar: bruto.puede_editar === true,
    reparto: lineas.map((l) => ({
      tecnico_id: (l.tecnico_id as string | null) ?? null,
      nombre: String(l.nombre ?? ''),
      porcentaje: numero(l.porcentaje),
    })),
  }
}

// --- Período (mes) -----------------------------------------------------------------------------------------------

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/

export function esMesValido(mes: string): boolean {
  return MES.test(mes)
}

// «2026-11» → primer y último día del mes (sin pasar por Date: nada de corrimientos de zona horaria).
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const partes = MES.exec(mes)
  if (!partes) throw new RangeError('Mes inválido')
  const anio = Number(partes[1])
  const m = Number(partes[2])
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
  const dias = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  return { desde: `${partes[1]}-${partes[2]}-01`, hasta: `${partes[1]}-${partes[2]}-${String(dias).padStart(2, '0')}` }
}

// Mes de hoy en Buenos Aires (como la base), «AAAA-MM».
export function mesActual(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' })
    .formatToParts(ahora)
  const anio = partes.find((p) => p.type === 'year')?.value
  const mes = partes.find((p) => p.type === 'month')?.value
  return `${anio}-${mes}`
}

// --- Reparto: validación en centésimas (sin errores de coma flotante) --------------------------------------------

// «33,34» → 3334. null si no es un número con hasta dos decimales.
export function aCentesimas(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpio)) return null
  return Math.round(Number(limpio) * 100)
}

export type BorradorLinea = { tecnico_id: string; porcentaje: string }

// Mensaje de lo que impide enviar el reparto (null si está bien). Espejo de la validación de la base, que manda.
export function errorDeReparto(lineas: readonly BorradorLinea[]): string | null {
  if (lineas.length === 0) return null
  if (lineas.length > MAX_TECNICOS_REPARTO) return `El reparto admite hasta ${MAX_TECNICOS_REPARTO} técnicos`
  const vistos = new Set<string>()
  let suma = 0
  for (const linea of lineas) {
    if (!linea.tecnico_id) return 'Elegí un técnico en cada línea'
    if (vistos.has(linea.tecnico_id)) return 'Un técnico no puede repetirse en el reparto'
    vistos.add(linea.tecnico_id)
    const centesimas = aCentesimas(linea.porcentaje)
    if (centesimas === null || centesimas <= 0 || centesimas > 10000) {
      return 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo'
    }
    suma += centesimas
  }
  if (suma !== 10000) return 'Los porcentajes del reparto tienen que sumar 100 %'
  return null
}

export function sumaDeReparto(lineas: readonly BorradorLinea[]): number {
  return lineas.reduce((total, linea) => total + (aCentesimas(linea.porcentaje) ?? 0), 0) / 100
}

export function aEnvioDeReparto(lineas: readonly BorradorLinea[]): LineaRepartoEnvio[] {
  return lineas.map((l) => ({ tecnico_id: l.tecnico_id, porcentaje: (aCentesimas(l.porcentaje) ?? 0) / 100 }))
}

export function formatearPorcentaje(valor: number): string {
  return `${valor.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`
}

// --- Errores -----------------------------------------------------------------------------------------------------

// Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas (22023, 23505): se muestran.
// El resto cae al catálogo general; `PT404`/`P0002` y `55000`/`PT409` los traduce el catálogo.
export function mensajeDeErrorComisiones(error: unknown, porDefecto: string): string {
  const e = error as { code?: unknown; message?: unknown } | null
  if ((e?.code === '22023' || e?.code === '23505') && typeof e.message === 'string' && e.message) return e.message
  return mensajeDeErrorBase(error, porDefecto, {
    PT404: 'Esa reparación ya no existe. Volvé al listado.',
    P0002: 'Esa reparación ya no existe. Volvé al listado.',
    '55000': 'La reparación está anulada: no se puede cambiar el reparto.',
    PT409: 'La reparación está anulada: no se puede cambiar el reparto.',
  })
}

// --- RPC ---------------------------------------------------------------------------------------------------------

export async function misComisiones(desde: string, hasta: string): Promise<DetalleComisiones> {
  const { data, error } = await supabaseClient.rpc('mis_comisiones', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return aDetalleComisiones(data)
}

export async function comisionesResumen(desde: string, hasta: string): Promise<ResumenComisiones> {
  const { data, error } = await supabaseClient.rpc('comisiones_resumen', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return aResumenComisiones(data)
}

export async function comisionesDeTecnico(tecnicoId: string, desde: string, hasta: string): Promise<DetalleComisiones> {
  const { data, error } = await supabaseClient.rpc('comisiones_de_tecnico', { p_tecnico: tecnicoId, p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return aDetalleComisiones(data)
}

export async function listarReglasComision(): Promise<ReglaComision[]> {
  const { data, error } = await supabaseClient.rpc('listar_reglas_comision')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as ReglaComision), porcentaje: numero(r.porcentaje) }))
}

export async function guardarReglaComision(tecnicoId: string | null, porcentaje: number, vigenteDesde: string): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_regla_comision', {
    p_tecnico: tecnicoId,
    p_porcentaje: porcentaje,
    p_vigente_desde: vigenteDesde,
  })
  if (error) throw error
}

export async function obtenerRepartoComision(reparacionId: string): Promise<RepartoComision> {
  const { data, error } = await supabaseClient.rpc('obtener_reparto_comision', { p_reparacion: reparacionId })
  if (error) throw error
  return aReparto(data)
}

export async function guardarRepartoComision(
  reparacionId: string,
  reparto: readonly LineaRepartoEnvio[],
  motivo: string | null,
): Promise<RepartoComision> {
  const { data, error } = await supabaseClient.rpc('guardar_reparto_comision', {
    p_reparacion: reparacionId,
    p_reparto: reparto,
    p_motivo: motivo,
  })
  if (error) throw error
  return aReparto(data)
}
