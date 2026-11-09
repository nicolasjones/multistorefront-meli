// Órdenes de compra a proveedor (F-PRV-09, MSF-454). Los límites y las reglas viven en
// las migraciones 20270114130001 y 20270114130100; acá se espejan solo para validar
// antes de viajar (la autoridad es la base).
import { fechaDeHoy } from './stock'

export const MAXIMO_ITEMS = 100
export const MAXIMO_CANTIDAD = 1_000_000
export const LARGO_MAXIMO_OBSERVACIONES = 1000
export const LARGO_MINIMO_MOTIVO_ANULACION = 3
export const LARGO_MAXIMO_MOTIVO_ANULACION = 500
export const MENSAJE_ORDEN_CREADA = 'Orden de compra creada'
export const MENSAJE_ORDEN_RECIBIDA = 'Orden marcada como recibida'
export const MENSAJE_ORDEN_ANULADA = 'Orden anulada'

export type EstadoOrdenCompra = 'emitida' | 'recibida' | 'anulada'

export const ESTADOS_ORDEN: ReadonlyArray<{ valor: EstadoOrdenCompra; etiqueta: string; variante: 'info' | 'exito' | 'error' }> = [
  { valor: 'emitida', etiqueta: 'Emitida', variante: 'info' },
  { valor: 'recibida', etiqueta: 'Recibida', variante: 'exito' },
  { valor: 'anulada', etiqueta: 'Anulada', variante: 'error' },
]

export type LineaOrden = {
  producto_id: string
  cantidad: string
}

export type FormularioOrden = {
  empresa_id: string
  proveedor_id: string
  fecha: string
  observaciones: string
  lineas: LineaOrden[]
}

export type ErroresLineaOrden = Partial<Record<keyof LineaOrden, string>>

export type ErroresOrden = {
  empresa_id?: string
  proveedor_id?: string
  fecha?: string
  observaciones?: string
  lineas?: string
  porLinea?: Record<number, ErroresLineaOrden>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANTIDAD = /^\d{1,7}$/

export function lineaVacia(): LineaOrden {
  return { producto_id: '', cantidad: '1' }
}

export function formularioOrdenVacio(fecha: string = fechaDeHoy()): FormularioOrden {
  return { empresa_id: '', proveedor_id: '', fecha, observaciones: '', lineas: [] }
}

export function validarOrden(formulario: FormularioOrden, hoy: string = fechaDeHoy()): ErroresOrden {
  const errores: ErroresOrden = {}
  if (!UUID.test(formulario.empresa_id)) errores.empresa_id = 'Elegí la empresa de la compra.'
  if (!UUID.test(formulario.proveedor_id)) errores.proveedor_id = 'Elegí el proveedor.'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(formulario.fecha)) {
    errores.fecha = 'Elegí la fecha de la orden.'
  } else if (formulario.fecha > hoy) {
    errores.fecha = 'La fecha no puede ser futura.'
  }

  if (formulario.observaciones.trim().length > LARGO_MAXIMO_OBSERVACIONES) {
    errores.observaciones = `Las observaciones admiten hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres.`
  }

  if (formulario.lineas.length === 0) {
    errores.lineas = 'Elegí al menos un producto en alerta de reposición.'
  } else if (formulario.lineas.length > MAXIMO_ITEMS) {
    errores.lineas = `Una orden admite hasta ${MAXIMO_ITEMS} productos.`
  }

  const porLinea: Record<number, ErroresLineaOrden> = {}
  const vistos = new Set<string>()

  formulario.lineas.forEach((linea, indice) => {
    const erroresLinea: ErroresLineaOrden = {}
    if (!UUID.test(linea.producto_id)) {
      erroresLinea.producto_id = 'Elegí un producto.'
    } else if (vistos.has(linea.producto_id)) {
      erroresLinea.producto_id = 'No repitas el mismo producto.'
    } else {
      vistos.add(linea.producto_id)
    }

    const cantidad = linea.cantidad.trim()
    if (!CANTIDAD.test(cantidad) || Number(cantidad) <= 0 || Number(cantidad) > MAXIMO_CANTIDAD) {
      erroresLinea.cantidad = `Entero entre 1 y ${MAXIMO_CANTIDAD.toLocaleString('es-AR')}.`
    }

    if (Object.keys(erroresLinea).length > 0) porLinea[indice] = erroresLinea
  })

  if (Object.keys(porLinea).length > 0) errores.porLinea = porLinea
  return errores
}

export type ItemParaRpc = {
  producto_id: string
  cantidad: number
}

export function lineasParaRpc(lineas: LineaOrden[]): ItemParaRpc[] {
  return lineas.map((linea) => ({
    producto_id: linea.producto_id,
    cantidad: Number(linea.cantidad.trim()),
  }))
}

export function validarMotivoAnulacion(motivo: string): string | null {
  const recortado = motivo.trim()
  if (recortado.length < LARGO_MINIMO_MOTIVO_ANULACION) {
    return `El motivo debe tener al menos ${LARGO_MINIMO_MOTIVO_ANULACION} caracteres.`
  }
  if (recortado.length > LARGO_MAXIMO_MOTIVO_ANULACION) {
    return `El motivo admite hasta ${LARGO_MAXIMO_MOTIVO_ANULACION} caracteres.`
  }
  return null
}

// El mensaje crudo de Postgres puede nombrar políticas o columnas: a la persona va
// solo el texto en castellano y el detalle queda en consola.
export function mensajeDeErrorOrden(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const codigo = (error as { code?: string } | null)?.code
  const mensaje = String((error as { message?: string } | null)?.message ?? '')
  if (codigo === '42501' || mensaje.includes('Tu rol no puede')) {
    return 'No tenés permiso para crear órdenes de compra. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (mensaje.includes('ya está cerrada')) {
    return 'Esa orden ya está cerrada: no se cambia más.'
  }
  if (codigo === '22023') {
    if (mensaje.includes('empresa')) return 'Elegí una empresa activa a la que tengas acceso.'
    if (mensaje.includes('proveedor')) return 'Elegí un proveedor activo de la organización.'
    if (mensaje.includes('fecha')) return 'La fecha de la orden no puede ser futura.'
    if (mensaje.includes('observaciones')) return `Las observaciones admiten hasta ${LARGO_MAXIMO_OBSERVACIONES} caracteres.`
    if (mensaje.includes('motivo')) return `El motivo debe tener entre ${LARGO_MINIMO_MOTIVO_ANULACION} y ${LARGO_MAXIMO_MOTIVO_ANULACION} caracteres.`
    if (mensaje.includes('alerta de reposición')) return 'Alguno de los productos ya no está en alerta de reposición. Volvé a cargar la lista.'
    if (mensaje.includes('repite')) return 'No repitas el mismo producto en una orden.'
    if (mensaje.includes('cantidad')) return 'La cantidad debe ser un entero mayor a cero.'
    if (mensaje.includes('productos')) return 'Revisá los productos: alguno no existe, está inactivo o es de otro proveedor.'
    return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  }
  return porDefecto
}
