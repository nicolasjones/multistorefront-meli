import { supabaseClient } from './supabase'
import { hoyEnArgentina } from './reparaciones'
import { crearComprobante, obtenerComprobante, mensajeDeErrorComprobante, type Comprobante } from './ventas'
import { aEntradas, conProductoAgregado, guardarLineasComprobante, type EntradaLinea } from './ventasLineas'
import { mensajeDeConfirmacion } from './ventasConfirmacion'
import { mensajeDeErrorCobro } from './ventas/cobros'

// Venta de mostrador con lector de código de barras (F-VTA-31, MSF-329). Reutiliza el comprobante, las líneas y
// el cobro ya construidos: la base es la autoridad (precio por escala, stock, saldo). Acá solo se orquestan sus
// RPC y se traducen sus errores. Contrato en specs/20261027-100000-ventas-mejoras/spec.md (FR-001…FR-005).

export const MENSAJE_PRODUCTO_NO_ENCONTRADO = 'Producto no encontrado'
export const MENSAJE_CODIGO_INVALIDO = 'El código de barras debe tener 13 dígitos (EAN-13).'
export const MENSAJE_ERROR_ESCANEO = 'No pudimos agregar el producto. Probá de nuevo.'
export const MENSAJE_ERROR_COBRAR = 'La venta se confirmó pero no pudimos registrar el cobro. Probá de nuevo: no se duplica la venta.'
export const MENSAJE_SIN_CONSUMIDOR_FINAL = 'No hay un cliente «Consumidor final» en tu organización. Pedile a un administrador que lo cree.'

// Aviso de descarte de la venta en curso al cambiar de tienda (Principio VIII).
export const mensajeDescarteVenta = (empresa: string): string =>
  `Cambiaste de tienda: se descartó la venta en curso (${empresa}). Empezá una nueva escaneando un producto.`

export type ProductoEscaneado = { producto_id: string; nombre: string; sku: string | null; codigo_barras: string }

const EAN13 = /^[0-9]{13}$/

export const esEan13 = (codigo: string): boolean => EAN13.test(codigo.trim())

// Resuelve el producto activo de la organización por su EAN-13; `null` si no existe (FR-001).
export async function buscarProductoPorCodigoBarras(codigo: string): Promise<ProductoEscaneado | null> {
  const { data, error } = await supabaseClient.rpc('buscar_producto_por_codigo_barras', { p_codigo_barras: codigo.trim() })
  if (error) throw error
  const filas = (data ?? []) as ProductoEscaneado[]
  return filas[0] ?? null
}

// El cliente «Consumidor final» de la organización (RLS de `clientes`); `null` si no hay (FR-003).
export async function obtenerConsumidorFinal(): Promise<string | null> {
  const { data, error } = await supabaseClient
    .from('clientes')
    .select('id')
    .eq('es_consumidor_final', true)
    .is('archivado_en', null)
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
}

// Depósito de salida de la línea que se está agregando. La base lo resuelve y lo guarda (si la línea llega sin
// depósito, usa el principal de la tienda), así que el `deposito_id` que vuelve del comprobante SIEMPRE es el
// real. Por eso la línea nueva usa el depósito que ya usa la venta: si se mandara `null`, el segundo escaneo del
// MISMO producto no encontraría la línea guardada y la duplicaría en vez de incrementarla (FR-002, caso borde de
// la spec: «escanear el mismo código varias veces incrementa la cantidad, no crea duplicados»).
export function depositoParaAgregar(entradas: readonly EntradaLinea[], productoId: string): string | null {
  const delProducto = entradas.find((entrada) => entrada.producto_id === productoId)
  return delProducto?.deposito_id ?? entradas[0]?.deposito_id ?? null
}

// Agrega un producto a la venta en curso (cantidad 1; si ya estaba, incrementa). Si todavía no hay comprobante
// lo crea: factura `borrador`, canal Mostrador, Consumidor final y la empresa indicada (FR-002, FR-003). Los
// precios y totales los calcula la base: se relee el comprobante.
export async function agregarProductoAVenta(
  venta: Comprobante | null,
  empresaId: string,
  clienteId: string,
  productoId: string,
): Promise<Comprobante> {
  let actual = venta
  if (!actual) {
    const creado = await crearComprobante({
      tipo: 'factura',
      empresa_id: empresaId,
      cliente: { id: clienteId, nombre: '', contacto: '' },
      canal: 'mostrador',
      fecha: hoyEnArgentina(),
      valido_hasta: '',
    })
    actual = await obtenerComprobante(creado.id)
  }
  const entradas = aEntradas(actual.lineas)
  const conProducto = conProductoAgregado(entradas, productoId, depositoParaAgregar(entradas, productoId))
  await guardarLineasComprobante(actual.id, conProducto, actual.updated_at)
  return obtenerComprobante(actual.id)
}

export function mensajeDeEscaneo(error: unknown): string {
  const e = error as { code?: string; hint?: string; message?: string } | null
  if (e?.code === '22023' && e.hint === 'codigo_barras') return MENSAJE_CODIGO_INVALIDO
  if (e?.code === '42501') return 'No tenés permiso para vender en el mostrador de esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  return mensajeDeErrorComprobante(error, MENSAJE_ERROR_ESCANEO)
}

export const mensajeDeConfirmarVenta = (error: unknown): string => mensajeDeConfirmacion(error)

export const mensajeDeCobroVenta = (error: unknown): string => mensajeDeErrorCobro(error, MENSAJE_ERROR_COBRAR)
