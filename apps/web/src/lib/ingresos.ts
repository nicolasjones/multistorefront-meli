// Ingreso de mercadería por proveedor (F-PRV-04, MSF-383). Los límites y las reglas
// viven en la migración 20261021180100_ingresos_mercaderia_registrar.sql; acá se
// espejan solo para validar antes de viajar (la autoridad es la base).
import { fechaDeHoy } from './stock'

export const MAXIMO_LINEAS = 100
export const MAXIMO_CANTIDAD = 1_000_000
export const LARGO_MAXIMO_COMPROBANTE = 100
export const LARGO_MINIMO_MOTIVO_ANULACION = 3
export const LARGO_MAXIMO_MOTIVO_ANULACION = 500
export const MENSAJE_INGRESO_REGISTRADO = 'Ingreso registrado'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANTIDAD = /^\d{1,7}$/
const COSTO = /^\d{1,12}(\.\d{1,2})?$/

export type LineaIngreso = {
  producto_id: string
  cantidad: string
  costo_unitario_usd: string
}

export type FormularioIngreso = {
  empresa_id: string
  proveedor_id: string
  fecha: string
  comprobante: string
  lineas: LineaIngreso[]
}

export type ErroresLineaIngreso = Partial<Record<keyof LineaIngreso, string>>

export type ErroresIngreso = {
  empresa_id?: string
  proveedor_id?: string
  fecha?: string
  comprobante?: string
  lineas?: string
  porLinea?: Record<number, ErroresLineaIngreso>
}

export function lineaVacia(): LineaIngreso {
  return { producto_id: '', cantidad: '1', costo_unitario_usd: '' }
}

export function formularioIngresoVacio(fecha: string = fechaDeHoy()): FormularioIngreso {
  return { empresa_id: '', proveedor_id: '', fecha, comprobante: '', lineas: [lineaVacia()] }
}

export function validarIngreso(formulario: FormularioIngreso, hoy: string = fechaDeHoy()): ErroresIngreso {
  const errores: ErroresIngreso = {}
  if (!UUID.test(formulario.empresa_id)) errores.empresa_id = 'Elegí la empresa de la compra.'
  if (!UUID.test(formulario.proveedor_id)) errores.proveedor_id = 'Elegí el proveedor.'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(formulario.fecha)) {
    errores.fecha = 'Elegí la fecha del ingreso.'
  } else if (formulario.fecha > hoy) {
    errores.fecha = 'La fecha no puede ser futura.'
  }

  if (formulario.comprobante.trim().length > LARGO_MAXIMO_COMPROBANTE) {
    errores.comprobante = `El comprobante admite hasta ${LARGO_MAXIMO_COMPROBANTE} caracteres.`
  }

  if (formulario.lineas.length === 0) {
    errores.lineas = 'Agregá al menos un producto para registrar el ingreso.'
  } else if (formulario.lineas.length > MAXIMO_LINEAS) {
    errores.lineas = `Un ingreso admite hasta ${MAXIMO_LINEAS} productos.`
  }

  const porLinea: Record<number, ErroresLineaIngreso> = {}
  const vistos = new Set<string>()

  formulario.lineas.forEach((linea, indice) => {
    const erroresLinea: ErroresLineaIngreso = {}
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

    const costo = linea.costo_unitario_usd.trim()
    if (!COSTO.test(costo)) {
      erroresLinea.costo_unitario_usd = 'Costo en USD con hasta dos decimales.'
    }

    if (Object.keys(erroresLinea).length > 0) porLinea[indice] = erroresLinea
  })

  if (Object.keys(porLinea).length > 0) errores.porLinea = porLinea
  return errores
}

export type LineaParaRpc = {
  producto_id: string
  cantidad: number
  costo_unitario_usd: number
}

export function lineasParaRpc(lineas: LineaIngreso[]): LineaParaRpc[] {
  return lineas.map((linea) => ({
    producto_id: linea.producto_id,
    cantidad: Number(linea.cantidad.trim()),
    costo_unitario_usd: Number(linea.costo_unitario_usd.trim()),
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

export function generarClaveIdempotencia(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Entorno sin Web Crypto (tests viejos): la base valida el formato uuid.
  return '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12)
}

// El mensaje crudo de Postgres puede nombrar políticas o columnas: a la persona va
// solo el texto en castellano y el detalle queda en consola.
export function mensajeDeErrorIngreso(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const codigo = (error as { code?: string } | null)?.code
  const mensaje = String((error as { message?: string } | null)?.message ?? '')
  if (codigo === '42501' || mensaje.includes('Tu rol no puede')) {
    return mensaje.includes('costo')
      ? 'Tu rol no puede actualizar el costo de los productos. Destildá la opción e intentá de nuevo.'
      : 'No tenés permiso para registrar ingresos de mercadería. Puede que tu rol haya cambiado: recargá la página.'
  }
  if (codigo === '23514' || mensaje.includes('No hay stock suficiente')) {
    return 'No hay stock suficiente para anular: parte de la mercadería ya se movió.'
  }
  if (mensaje.includes('ya está anulado')) {
    return 'Ese ingreso ya está anulado.'
  }
  if (codigo === '23505' || mensaje.includes('duplicate key')) {
    return 'Este ingreso ya fue registrado. Recargá el historial para verlo.'
  }
  if (codigo === '22023') {
    if (mensaje.includes('comprobante')) return 'El comprobante admite hasta 100 caracteres.'
    if (mensaje.includes('fecha')) return 'La fecha del ingreso no puede ser futura.'
    if (mensaje.includes('proveedor')) return 'Elegí un proveedor activo de la organización.'
    if (mensaje.includes('empresa')) return 'Elegí una empresa activa a la que tengas acceso.'
    if (mensaje.includes('producto')) return 'Revisá los productos: alguno no existe, está inactivo o es de otra organización.'
    if (mensaje.includes('cantidad')) return 'La cantidad debe ser un entero mayor a cero.'
    if (mensaje.includes('costo')) return 'El costo unitario debe ser un número de hasta dos decimales.'
    if (mensaje.includes('repetir')) return 'No repitas el mismo producto en un ingreso.'
    return 'Algún dato no es válido. Revisá el formulario e intentá de nuevo.'
  }
  return porDefecto
}
