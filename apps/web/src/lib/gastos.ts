import { supabaseClient } from './supabase'
import { armarCsv, type ColumnaCsv } from './exportarCsv'
import { hoyEnOrganizacion } from './periodosRanking'

// Gastos de la empresa (F-GAS-01/02). La autoridad es la base (migraciones 20270347000000…300: tabla `dominio.gastos` y RPC
// `guardar_gasto`, `anular_gasto`, `listar_gastos`, `resumen_gastos`, `exportar_gastos`). Acá se espeja solo la validación para dar
// feedback mientras se escribe y se traducen los códigos de error a mensajes de negocio.

export const CATEGORIAS_GASTO = ['Alquiler', 'Servicios', 'Sueldos', 'Fletes', 'Insumos', 'Impuestos', 'Otros'] as const
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]
export type TipoCostoGasto = 'fijo' | 'variable'
export type MonedaGasto = 'ARS' | 'USD'

// Tipo de costo que se precarga según la categoría (D3); la persona puede cambiarlo.
export const TIPO_POR_OMISION: Readonly<Record<CategoriaGasto, TipoCostoGasto>> = {
  Alquiler: 'fijo', Servicios: 'fijo', Sueldos: 'fijo', Otros: 'fijo', Fletes: 'variable', Insumos: 'variable', Impuestos: 'variable',
}

export const DETALLE_MAX = 200
export const MOTIVO_MAX = 200

export type Gasto = {
  id: string
  empresaId: string
  empresaNombre: string
  fecha: string
  categoria: CategoriaGasto
  tipoCosto: TipoCostoGasto
  detalle: string | null
  importe: number
  moneda: MonedaGasto
  cotizacionUsada: number | null
  importePesos: number
  recurrente: boolean
  anuladoEn: string | null
  motivoAnulacion: string | null
  // Versión para el bloqueo optimista.
  actualizadoEn: string
}

type GastoRpc = {
  id: string
  empresa_id: string
  empresa_nombre: string
  fecha: string
  categoria: CategoriaGasto
  tipo_costo: TipoCostoGasto
  detalle: string | null
  importe: number | string
  moneda: MonedaGasto
  cotizacion_usada: number | string | null
  importe_pesos: number | string
  recurrente: boolean
  anulado_en: string | null
  motivo_anulacion: string | null
  updated_at: string
}

export type FiltrosGastos = {
  desde: string
  hasta: string
  empresaId: string | null
  categoria: CategoriaGasto | null
  tipoCosto: TipoCostoGasto | null
}

export type ResumenGastos = {
  total: number
  conteo: number
  conteoAnulados: number
  desglose: Array<{ categoria: CategoriaGasto; tipoCosto: TipoCostoGasto; total: number; conteo: number }>
}

export type CursorGastos = { fecha: string; id: string }

export const TAMANO_TANDA_GASTOS = 25

// --- Períodos (hora de Buenos Aires) ---------------------------------------------------------------------------------

export type PeriodoGasto = 'hoy' | 'semana' | 'mes' | 'mes-anterior'

export const PERIODOS_GASTO: ReadonlyArray<{ valor: PeriodoGasto; etiqueta: string }> = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
  { valor: 'mes-anterior', etiqueta: 'Mes anterior' },
]

const dos = (n: number) => String(n).padStart(2, '0')
const aIso = (f: Date) => `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`

// Hoy / Semana (últimos 7 días, hoy incluido) / Mes (del 1 a hoy) / Mes anterior (completo).
export function rangoDePeriodoGasto(periodo: PeriodoGasto, ahora: Date = new Date()): { desde: string; hasta: string } {
  const hoy = hoyEnOrganizacion(ahora)
  const [anio, mes, dia] = hoy.split('-').map(Number)
  switch (periodo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case 'semana':
      return { desde: aIso(new Date(Date.UTC(anio, mes - 1, dia - 6))), hasta: hoy }
    case 'mes':
      return { desde: aIso(new Date(Date.UTC(anio, mes - 1, 1))), hasta: hoy }
    case 'mes-anterior':
      return { desde: aIso(new Date(Date.UTC(anio, mes - 2, 1))), hasta: aIso(new Date(Date.UTC(anio, mes - 1, 0))) }
  }
}

// --- Validación del formulario ---------------------------------------------------------------------------------------

export type ErroresGasto = { fecha?: string; categoria?: string; importe?: string; detalle?: string; empresa?: string }

const FORMATO_IMPORTE = /^\d+(?:,\d{1,2})?$/

// El campo solo admite dígitos y coma decimal.
export const soloCaracteresDeImporte = (texto: string) => texto.replace(/[^0-9,]/g, '')

export function parsearImporteGasto(texto: string): number | null {
  const limpio = texto.trim()
  if (!FORMATO_IMPORTE.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  return valor > 0 ? valor : null
}

export function validarGasto(entrada: {
  fecha: string
  categoria: CategoriaGasto | ''
  importeTexto: string
  detalle: string
  empresaIds: string[]
}, ahora: Date = new Date()): ErroresGasto {
  const errores: ErroresGasto = {}
  const [a, m, d] = hoyEnOrganizacion(ahora).split('-').map(Number)
  const limite = aIso(new Date(Date.UTC(a, m - 1, d + 31)))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha)) errores.fecha = 'Ingresá la fecha del gasto.'
  else if (entrada.fecha > limite) errores.fecha = 'La fecha no puede superar los 31 días a futuro.'
  else if (entrada.fecha < FECHA_MINIMA_GASTO) errores.fecha = 'La fecha no puede ser anterior al 01/01/2000.'
  if (entrada.categoria === '') errores.categoria = 'Elegí un concepto.'
  if (parsearImporteGasto(entrada.importeTexto) === null) errores.importe = 'Ingresá un importe mayor que cero, por ejemplo 36800 o 1250,50.'
  if (entrada.detalle.length > DETALLE_MAX) errores.detalle = `El detalle admite hasta ${DETALLE_MAX} caracteres.`
  if (entrada.empresaIds.length !== 1) errores.empresa = 'Elegí la tienda del gasto.'
  return errores
}

export const FECHA_MINIMA_GASTO = '2000-01-01'

const MENSAJES: Record<string, string> = {
  '42501': 'Tu rol no puede cargar ni anular gastos de esa tienda.',
  P0002: 'El gasto o la tienda ya no existen. Recargá la lista.',
  '40001': 'Otra persona cambió este gasto mientras lo editabas. Recargá la lista y probá de nuevo.',
}

// Mensajes de validación (22023) de las RPC que sí se muestran tal cual: lista blanca. Cualquier otro texto del servidor (un
// error interno, un nombre de columna, una restricción) no se muestra a la persona: va el mensaje por omisión.
const MENSAJES_VALIDACION_CONOCIDOS: ReadonlySet<string> = new Set([
  'Cargá la cotización del dólar',
  'La fecha es obligatoria, desde el 01/01/2000 y no puede superar los 31 días a futuro',
  'La categoría no es válida',
  'El tipo de costo debe ser fijo o variable',
  'El detalle admite hasta 200 caracteres',
  'El importe debe ser mayor que cero, con hasta 2 decimales',
  'La moneda debe ser ARS o USD',
  'No se pueden cargar gastos a una empresa inactiva',
  'Un gasto anulado no se puede editar',
  'El importe en pesos es demasiado grande: revisá el importe',
  'El importe en pesos debe ser mayor que cero',
  'El motivo es obligatorio y admite hasta 200 caracteres',
])

export function mensajeDeErrorGasto(error: { code?: string; message?: string } | null | undefined, porOmision = 'No pudimos guardar el gasto. Intentá de nuevo.'): string {
  const codigo = error?.code ?? ''
  if (codigo === '22023') return error?.message && MENSAJES_VALIDACION_CONOCIDOS.has(error.message) ? error.message : porOmision
  return MENSAJES[codigo] ?? porOmision
}

// --- Formato ---------------------------------------------------------------------------------------------------------

const formatoMoneda = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const formatearImporteGasto = (valor: number, moneda: MonedaGasto) =>
  `${moneda === 'USD' ? 'US$' : '$'} ${formatoMoneda.format(valor)}`

// --- RPC -------------------------------------------------------------------------------------------------------------

const aGasto = (f: GastoRpc): Gasto => ({
  id: f.id,
  empresaId: f.empresa_id,
  empresaNombre: f.empresa_nombre,
  fecha: f.fecha,
  categoria: f.categoria,
  tipoCosto: f.tipo_costo,
  detalle: f.detalle,
  importe: Number(f.importe),
  moneda: f.moneda,
  cotizacionUsada: f.cotizacion_usada === null ? null : Number(f.cotizacion_usada),
  importePesos: Number(f.importe_pesos),
  recurrente: f.recurrente,
  anuladoEn: f.anulado_en,
  motivoAnulacion: f.motivo_anulacion,
  actualizadoEn: f.updated_at,
})

const parametrosFiltro = (f: FiltrosGastos) => ({
  p_desde: f.desde,
  p_hasta: f.hasta,
  p_empresa: f.empresaId,
  p_categoria: f.categoria,
  p_tipo_costo: f.tipoCosto,
})

export async function listarGastos(filtros: FiltrosGastos, incluirAnulados: boolean, cursor: CursorGastos | null, limite = TAMANO_TANDA_GASTOS): Promise<Gasto[]> {
  const { data, error } = await supabaseClient.rpc('listar_gastos', {
    ...parametrosFiltro(filtros),
    p_incluir_anulados: incluirAnulados,
    p_cursor_fecha: cursor?.fecha ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limite: limite,
  })
  if (error) throw error
  return ((data ?? []) as GastoRpc[]).map(aGasto)
}

export async function resumenGastos(filtros: FiltrosGastos): Promise<ResumenGastos> {
  const { data, error } = await supabaseClient.rpc('resumen_gastos', parametrosFiltro(filtros))
  if (error) throw error
  const d = (data ?? {}) as {
    total?: number | string; conteo?: number | string; conteo_anulados?: number | string
    desglose?: Array<{ categoria: CategoriaGasto; tipo_costo: TipoCostoGasto; total: number | string; conteo: number | string }>
  }
  return {
    total: Number(d.total ?? 0),
    conteo: Number(d.conteo ?? 0),
    conteoAnulados: Number(d.conteo_anulados ?? 0),
    desglose: (d.desglose ?? []).map((x) => ({ categoria: x.categoria, tipoCosto: x.tipo_costo, total: Number(x.total), conteo: Number(x.conteo) })),
  }
}

export type EntradaGasto = {
  id: string | null
  empresaId: string
  fecha: string
  categoria: CategoriaGasto
  tipoCosto: TipoCostoGasto
  detalle: string
  importe: number
  moneda: MonedaGasto
  recurrente: boolean
  actualizadoEn: string | null
}

export async function guardarGasto(g: EntradaGasto): Promise<string> {
  const { data, error } = await supabaseClient.rpc('guardar_gasto', {
    p_id: g.id,
    p_empresa: g.empresaId,
    p_fecha: g.fecha,
    p_categoria: g.categoria,
    p_tipo_costo: g.tipoCosto,
    p_detalle: g.detalle.trim() === '' ? null : g.detalle.trim(),
    p_importe: g.importe,
    p_moneda: g.moneda,
    p_recurrente: g.recurrente,
    p_actualizado: g.actualizadoEn,
  })
  if (error) throw error
  return data as string
}

export async function anularGasto(id: string, motivo: string, actualizadoEn: string): Promise<void> {
  const { error } = await supabaseClient.rpc('anular_gasto', { p_id: id, p_motivo: motivo, p_actualizado: actualizadoEn })
  if (error) throw error
}

type FilaExportada = {
  fecha: string; empresa: string; categoria: string; tipo_costo: string; detalle: string | null; moneda: string
  importe: number; cotizacion_usada: number | null; importe_pesos: number; recurrente: boolean; anulado: boolean; motivo_anulacion: string | null
}

export const COLUMNAS_CSV_GASTOS: ReadonlyArray<ColumnaCsv<FilaExportada>> = [
  { encabezado: 'Fecha', valor: (f) => f.fecha },
  { encabezado: 'Tienda', valor: (f) => f.empresa },
  { encabezado: 'Concepto', valor: (f) => f.categoria },
  { encabezado: 'Tipo de costo', valor: (f) => f.tipo_costo },
  { encabezado: 'Detalle', valor: (f) => f.detalle },
  { encabezado: 'Moneda', valor: (f) => f.moneda },
  { encabezado: 'Importe', valor: (f) => Number(f.importe) },
  { encabezado: 'Cotización usada', valor: (f) => (f.cotizacion_usada === null ? null : Number(f.cotizacion_usada)) },
  { encabezado: 'Importe en pesos', valor: (f) => Number(f.importe_pesos) },
  { encabezado: 'Recurrente', valor: (f) => (f.recurrente ? 'Sí' : 'No') },
  { encabezado: 'Anulado', valor: (f) => (f.anulado ? 'Sí' : 'No') },
  { encabezado: 'Motivo de anulación', valor: (f) => f.motivo_anulacion },
]

// `public.exportar_gastos`: las mismas filas y filtros del listado, en CSV, y deja el evento en Actividad.
export async function exportarGastosCsv(filtros: FiltrosGastos, incluirAnulados: boolean): Promise<{ contenido: string; total: number; truncado: boolean }> {
  const { data, error } = await supabaseClient.rpc('exportar_gastos', { ...parametrosFiltro(filtros), p_incluir_anulados: incluirAnulados })
  if (error) throw error
  const d = data as { total: number; truncado: boolean; filas: FilaExportada[] }
  return { contenido: armarCsv(COLUMNAS_CSV_GASTOS, d.filas), total: Number(d.total), truncado: d.truncado === true }
}
