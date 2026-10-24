import { fechaDeHoy, parsearCantidad } from './stock'

// Carga en lote (F-STK-10, FR-001/FR-002). Acá se espejan las reglas solo para validar antes de
// viajar; la autoridad es `public.registrar_lote_stock` (migración 20261202100200).

export const MAXIMO_LINEAS_LOTE = 100
export const MAXIMO_CANTIDAD_LINEA = 1_000_000
export const LARGO_MAXIMO_PROVEEDOR = 120

export type LineaLote = { producto_id: string; cantidad: string }

export type FormularioLote = {
  proveedor: string
  fecha: string
  motivo_id: string
  lineas: LineaLote[]
}

export type ErroresLote = {
  proveedor?: string
  fecha?: string
  motivo_id?: string
  lineas?: string
  porLinea?: Array<{ producto_id?: string; cantidad?: string }>
}

export type LoteHistorial = {
  id: string
  numero: number
  fecha: string
  proveedor: string | null
  productos: number
  unidades: number
  creado_en: string
}

export type MovimientoDeLote = {
  movimiento_id: string
  producto: string
  sku: string | null
  cantidad: number
  saldo: number
  creado_en: string
}

export const lineaLoteVacia = (): LineaLote => ({ producto_id: '', cantidad: '' })

export function formularioLoteVacio(motivoId = '', fecha: string = fechaDeHoy()): FormularioLote {
  return { proveedor: '', fecha, motivo_id: motivoId, lineas: [lineaLoteVacia()] }
}

export function validarLote(formulario: FormularioLote, hoy: string = fechaDeHoy()): ErroresLote {
  const errores: ErroresLote = {}
  if (formulario.proveedor.trim().length > LARGO_MAXIMO_PROVEEDOR) {
    errores.proveedor = `El proveedor admite hasta ${LARGO_MAXIMO_PROVEEDOR} caracteres.`
  }
  if (!formulario.fecha) errores.fecha = 'Indicá la fecha del lote.'
  else if (formulario.fecha > hoy) errores.fecha = 'La fecha no puede ser futura.'
  if (!formulario.motivo_id) errores.motivo_id = 'Elegí un motivo.'

  if (formulario.lineas.length === 0) errores.lineas = 'Agregá al menos un producto.'
  const vistos = new Set<string>()
  const porLinea = formulario.lineas.map((linea) => {
    const error: { producto_id?: string; cantidad?: string } = {}
    if (!linea.producto_id) error.producto_id = 'Elegí un producto.'
    else if (vistos.has(linea.producto_id)) error.producto_id = 'Este producto ya está en el lote.'
    else vistos.add(linea.producto_id)
    const cantidad = parsearCantidad(linea.cantidad)
    if (cantidad === null || cantidad <= 0 || cantidad > MAXIMO_CANTIDAD_LINEA) {
      error.cantidad = 'Ingresá un entero mayor a cero.'
    }
    return error
  })
  if (porLinea.some((error) => Object.keys(error).length > 0)) errores.porLinea = porLinea
  return errores
}

export const hayErroresLote = (errores: ErroresLote) => Object.keys(errores).length > 0

export function lineasParaRpcLote(lineas: LineaLote[]) {
  return lineas.map((linea) => ({ producto: linea.producto_id, cantidad: Number(linea.cantidad) }))
}

// Los 22023 de la RPC ya vienen en castellano y sin nombres internos; el resto se traduce.
export function mensajeDeErrorLote(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const codigo = (error as { code?: string } | null)?.code
  const mensaje = String((error as { message?: string } | null)?.message ?? '')
  if (codigo === '42501' || mensaje.includes('Tu rol no puede')) {
    return 'No tenés permiso para registrar lotes de stock. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (codigo === '22023' && mensaje !== '') return mensaje
  return porDefecto
}

export const formatearFechaLote = (fecha: string) => fecha.split('-').reverse().join('/')
