import { supabaseClient } from './supabase'
import { parsearPrecioLinea } from './ventasLineas'

// Nota de crédito (F-VTA-11, MSF-377, FR-043…FR-046). La autoridad es la base: `emitir_nota_credito` valida el
// permiso `emitir_nota_credito` en la tienda de la factura, el tope acreditable y devuelve la mercadería al depósito
// de origen solo en «Devolución de productos». Acá se nombran los tres motivos (textos del prototipo
// `VentasComprobante.dc.html`), se arma lo que se envía y se traducen los errores. Las notas viven en la base con
// cantidades e importes POSITIVOS; la pantalla los muestra con signo negativo.

export type TipoNotaCredito = 'devolucion_productos' | 'devolucion_importe' | 'descuento'

type DefinicionTipo = { valor: TipoNotaCredito; etiqueta: string; descripcion: string }

export const TIPOS_NOTA_CREDITO: ReadonlyArray<DefinicionTipo> = [
  { valor: 'devolucion_productos', etiqueta: 'Devolución de productos', descripcion: 'Vuelve la mercadería al depósito y se acredita el importe.' },
  { valor: 'devolucion_importe', etiqueta: 'Devolución de importe', descripcion: 'Se devuelve el dinero sin que vuelva mercadería.' },
  { valor: 'descuento', etiqueta: 'Descuento o bonificación', descripcion: 'Ajuste de precio sin devolución de mercadería.' },
]

export const definicionTipoNota = (tipo: string): DefinicionTipo =>
  TIPOS_NOTA_CREDITO.find((definicion) => definicion.valor === tipo) ?? { valor: 'descuento', etiqueta: tipo, descripcion: '' }

export const ETIQUETA_NOTA_CREDITO = 'Nota de crédito'
export const ETIQUETA_EMITIR_NOTA_CREDITO = 'Emitir nota de crédito'
export const EJEMPLO_NOTA_CREDITO = 'Ejemplo: 1 Transformador Nintendo Switch con IVA, -$ 13.552.'
export const MENSAJE_NOTA_EMITIDA = 'Nota de crédito emitida'
export const MENSAJE_ERROR_NOTA = 'No pudimos emitir la nota de crédito. No se guardó nada: probá de nuevo.'
export const MENSAJE_CONCEPTO_OBLIGATORIO = 'Escribí el concepto de la nota de crédito.'
export const MENSAJE_IMPORTE_NOTA = 'Ingresá un importe mayor a cero, con hasta dos decimales.'
export const MENSAJE_SIN_CANTIDADES = 'Indicá cuántas unidades se devuelven de al menos un producto.'
export const CONCEPTO_NOTA_MAXIMO = 200

export type LineaAcreditable = {
  linea_id: string
  orden: number
  descripcion: string
  cantidad: number
  devuelta: number
  disponible: number
  precio_unitario: number
  deposito: string
}

export type LineaNota = {
  orden: number
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal_sin_iva: number
  iva: number
}

export type NotaCredito = {
  id: string
  numero: string
  nc_tipo: TipoNotaCredito
  concepto: string | null
  fecha: string
  total_sin_iva: number
  total_con_iva: number
  lineas: LineaNota[]
}

export type DetalleAnulacion = {
  puede_anular: boolean
  puede_emitir_nota_credito: boolean
  anulacion: { cuando: string; quien: string; motivo: string } | null
  acreditable_sin_iva: number
  lineas_acreditables: LineaAcreditable[]
  notas: NotaCredito[]
}

const DETALLE_VACIO: DetalleAnulacion = {
  puede_anular: false,
  puede_emitir_nota_credito: false,
  anulacion: null,
  acreditable_sin_iva: 0,
  lineas_acreditables: [],
  notas: [],
}

const numero = (valor: unknown): number => Number(valor ?? 0)

export function aDetalleAnulacion(dato: unknown): DetalleAnulacion {
  if (!dato || typeof dato !== 'object') return DETALLE_VACIO
  const d = dato as Record<string, unknown>
  const lista = (valor: unknown): Record<string, unknown>[] => (Array.isArray(valor) ? (valor as Record<string, unknown>[]) : [])
  return {
    puede_anular: d.puede_anular === true,
    puede_emitir_nota_credito: d.puede_emitir_nota_credito === true,
    anulacion: d.anulacion ? (d.anulacion as DetalleAnulacion['anulacion']) : null,
    acreditable_sin_iva: numero(d.acreditable_sin_iva),
    lineas_acreditables: lista(d.lineas_acreditables).map((l) => ({
      ...(l as unknown as LineaAcreditable),
      orden: numero(l.orden),
      cantidad: numero(l.cantidad),
      devuelta: numero(l.devuelta),
      disponible: numero(l.disponible),
      precio_unitario: numero(l.precio_unitario),
    })),
    notas: lista(d.notas).map((n) => ({
      ...(n as unknown as NotaCredito),
      total_sin_iva: numero(n.total_sin_iva),
      total_con_iva: numero(n.total_con_iva),
      lineas: lista(n.lineas).map((l) => ({
        ...(l as unknown as LineaNota),
        orden: numero(l.orden),
        cantidad: numero(l.cantidad),
        precio_unitario: numero(l.precio_unitario),
        subtotal_sin_iva: numero(l.subtotal_sin_iva),
        iva: numero(l.iva),
      })),
    })),
  }
}

export async function detalleAnulacionNotaCredito(comprobanteId: string): Promise<DetalleAnulacion> {
  const { data, error } = await supabaseClient.rpc('detalle_anulacion_nota_credito', { p_id: comprobanteId })
  if (error) throw error
  return aDetalleAnulacion(data)
}

// --- Qué se envía ---

export type EntradaNota = {
  tipo: TipoNotaCredito
  // Texto de cantidad por `linea_id` (solo «Devolución de productos»).
  cantidades: Readonly<Record<string, string>>
  importe: string
  concepto: string
}

export type ErroresNota = { cantidades?: string; importe?: string; concepto?: string; cantidadPorLinea?: Record<string, string> }

function cantidadDeTexto(texto: string | undefined): number | null | undefined {
  const limpio = (texto ?? '').trim()
  if (limpio === '') return 0
  if (!/^\d{1,5}$/.test(limpio)) return undefined
  return Number(limpio)
}

export function validarNota(entrada: EntradaNota, lineas: readonly LineaAcreditable[]): ErroresNota {
  const errores: ErroresNota = {}
  if (entrada.tipo === 'devolucion_productos') {
    const porLinea: Record<string, string> = {}
    let total = 0
    for (const linea of lineas) {
      const cantidad = cantidadDeTexto(entrada.cantidades[linea.linea_id])
      if (cantidad === undefined) porLinea[linea.linea_id] = 'Ingresá un número entero.'
      else if (cantidad > linea.disponible) porLinea[linea.linea_id] = `Quedan ${linea.disponible} por devolver.`
      else total += cantidad ?? 0
    }
    if (Object.keys(porLinea).length > 0) errores.cantidadPorLinea = porLinea
    else if (total === 0) errores.cantidades = MENSAJE_SIN_CANTIDADES
    return errores
  }
  const importe = parsearPrecioLinea(entrada.importe)
  if (importe === undefined || importe === null || importe <= 0) errores.importe = MENSAJE_IMPORTE_NOTA
  const concepto = entrada.concepto.trim()
  if (concepto === '') errores.concepto = MENSAJE_CONCEPTO_OBLIGATORIO
  else if (concepto.length > CONCEPTO_NOTA_MAXIMO) errores.concepto = `El concepto no puede superar los ${CONCEPTO_NOTA_MAXIMO} caracteres.`
  return errores
}

export const hayErroresNota = (errores: ErroresNota): boolean => Object.keys(errores).length > 0

export function armarLineasNota(entrada: EntradaNota, lineas: readonly LineaAcreditable[]): Array<Record<string, unknown>> {
  if (entrada.tipo !== 'devolucion_productos') {
    return [{ importe_sin_iva: parsearPrecioLinea(entrada.importe) }]
  }
  return lineas
    .map((linea) => ({ linea_id: linea.linea_id, cantidad: cantidadDeTexto(entrada.cantidades[linea.linea_id]) ?? 0 }))
    .filter((linea) => linea.cantidad > 0)
}

// --- Errores ---

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// Solo los mensajes que levanta nuestra RPC llegan en castellano y se muestran tal cual (ver `anularComprobante`).
const PREFIJOS_MENSAJE_DE_LA_RPC = [
  'Necesitás una sesión con organización para emitir',
  'Tu rol no puede emitir',
  'Elegí el motivo',
  'Indicá qué se acredita',
  'Indicá un solo importe',
  'El concepto no puede',
  'Escribí el concepto',
  'La nota de crédito se emite sobre una factura',
  'La factura está en borrador',
  'La factura está anulada',
  'Cada línea de la nota',
  'Una de las líneas no pertenece',
  'Las líneas de la nota',
  'El importe de la nota',
  'La nota de crédito no acredita',
  'No podés devolver más',
  'No podés acreditar más',
  'El motivo «',
] as const

function esMensajeDeLaRpc(error: ErrorDeBase): error is { message: string } {
  const mensaje = error?.message
  return typeof mensaje === 'string' && PREFIJOS_MENSAJE_DE_LA_RPC.some((prefijo) => mensaje.startsWith(prefijo))
}

export const esTopeDeNota = (error: unknown): boolean => (error as ErrorDeBase)?.code === 'P0001' && (error as ErrorDeBase)?.hint === 'tope'

export function mensajeDeNotaCredito(error: unknown): string {
  const e = error as ErrorDeBase
  console.error(MENSAJE_ERROR_NOTA, error)
  if ((e?.code === '42501' || e?.code === '55000' || e?.code === '22023' || esTopeDeNota(error)) && esMensajeDeLaRpc(e)) return e.message
  if (e?.code === 'P0002') return 'Esa factura no existe o no pertenece a tu organización.'
  return MENSAJE_ERROR_NOTA
}

export async function emitirNotaCredito(
  facturaId: string,
  tipo: TipoNotaCredito,
  lineas: ReadonlyArray<Record<string, unknown>>,
  concepto: string,
): Promise<{ id: string; numero: string }> {
  const { data, error } = await supabaseClient.rpc('emitir_nota_credito', {
    p_factura_id: facturaId,
    p_tipo: tipo,
    p_lineas: lineas,
    p_concepto: concepto.trim() === '' ? null : concepto.trim(),
  })
  if (error) throw error
  const fila = data as { id?: string; numero?: string } | null
  if (!fila?.id || !fila.numero) throw new Error('La base no devolvió la nota de crédito')
  return { id: fila.id, numero: fila.numero }
}

// --- Cómo se muestra una nota (importes en negativo) ---

export type FilaNota = { clave: string; descripcion: string; cantidad: number; precio: number; importe: number }

// Cada línea con cantidad e importe NEGATIVOS (se devuelve al cliente). Las notas de importe no llevan líneas:
// se muestran como una sola fila con su concepto.
export function filasDeNota(nota: NotaCredito): FilaNota[] {
  if (nota.lineas.length > 0) {
    return nota.lineas.map((linea) => ({
      clave: `${nota.id}-${linea.orden}`,
      descripcion: linea.descripcion,
      cantidad: -linea.cantidad,
      precio: linea.precio_unitario,
      importe: -(linea.subtotal_sin_iva + linea.iva),
    }))
  }
  const etiqueta = definicionTipoNota(nota.nc_tipo).etiqueta
  return [
    {
      clave: `${nota.id}-importe`,
      descripcion: nota.concepto ? `${etiqueta} · ${nota.concepto}` : etiqueta,
      cantidad: -1,
      precio: nota.total_sin_iva,
      importe: -nota.total_con_iva,
    },
  ]
}

export function unidadesDevueltas(nota: NotaCredito): number {
  return nota.nc_tipo === 'devolucion_productos' ? nota.lineas.reduce((suma, linea) => suma + linea.cantidad, 0) : 0
}

// Aviso del prototipo bajo la tabla de la nota: lo que pasa con el stock según el motivo.
export function textoStockNota(nota: NotaCredito): string {
  const unidades = unidadesDevueltas(nota)
  return nota.nc_tipo === 'devolucion_productos'
    ? `Vuelve${unidades === 1 ? '' : 'n'} ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} al stock del depósito de origen.`
    : 'No cambia el stock.'
}
