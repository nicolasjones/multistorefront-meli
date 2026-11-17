import type { Consulta, ItemConsulta } from './consultas'
import { crearComprobante, obtenerComprobante } from './ventas'
import { guardarLineasComprobante, CANTIDAD_MAXIMA_LINEA, type EntradaLinea } from './ventasLineas'
import { obtenerConsumidorFinal } from './ventasMostrador'
import { hoyEnArgentina } from './reparaciones'

// «Crear presupuesto» desde una consulta de pedido (MSF-941, spec tienda-compra-y-cuentas D-14). Sin migración: usa las mismas RPC que el panel
// (`crear_comprobante` y `guardar_lineas_comprobante`), de modo que el precio, la escala, el IVA y los permisos los resuelve la base como en
// cualquier presupuesto. El precio de referencia que vio el cliente NO se copia: la línea sale sin `precio_manual` y se recalcula para el cliente de la consulta.

export const MENSAJE_PEDIDO_SIN_PRODUCTOS = 'El pedido no tiene productos que sigan en el catálogo: no hay nada para presupuestar.'
export const MENSAJE_SIN_CONSUMIDOR_FINAL = 'La consulta no tiene cliente y la organización no tiene «Consumidor final»: vinculá un cliente primero.'

/** Error de negocio con texto apto para mostrar tal cual. */
export class ErrorPresupuestoDesdePedido extends Error {
  /** Presente cuando el presupuesto SÍ se creó pero no se pudieron cargar sus líneas: hay que completarlo a mano, no reintentar. */
  readonly presupuesto?: { id: string; numero: string }
  constructor(mensaje: string, presupuesto?: { id: string; numero: string }) {
    super(mensaje)
    this.presupuesto = presupuesto
  }
}

export type ResultadoPresupuestoDesdePedido = {
  id: string
  numero: string
  /** Líneas del pedido que no se pudieron pasar (el producto ya no existe) y hay que revisar a mano. */
  omitidas: number
}

/** Las líneas que se mandan a la base: solo las que conservan producto; cantidad entera de 1 a CANTIDAD_MAXIMA_LINEA. */
export function entradasDesdePedido(items: readonly ItemConsulta[]): { entradas: EntradaLinea[]; omitidas: number } {
  const entradas: EntradaLinea[] = []
  let omitidas = 0
  for (const item of items) {
    const cantidad = Math.trunc(item.cantidad)
    if (item.producto_id === null || !Number.isFinite(cantidad) || cantidad < 1) {
      omitidas += 1
      continue
    }
    // `deposito_id: null`: la base usa el depósito principal de la empresa, igual que al agregar un producto sin elegir.
    entradas.push({ producto_id: item.producto_id, cantidad: Math.min(cantidad, CANTIDAD_MAXIMA_LINEA), deposito_id: null, precio_manual: null })
  }
  return { entradas, omitidas }
}

export async function crearPresupuestoDesdePedido(consulta: Pick<Consulta, 'empresa_id' | 'cliente_id' | 'nombre' | 'contacto'>, items: readonly ItemConsulta[], organizacionId: string | null): Promise<ResultadoPresupuestoDesdePedido> {
  const { entradas, omitidas } = entradasDesdePedido(items)
  if (entradas.length === 0) throw new ErrorPresupuestoDesdePedido(MENSAJE_PEDIDO_SIN_PRODUCTOS)
  const clienteId = consulta.cliente_id ?? (await obtenerConsumidorFinal(organizacionId))
  if (clienteId === null) throw new ErrorPresupuestoDesdePedido(MENSAJE_SIN_CONSUMIDOR_FINAL)

  const creado = await crearComprobante({
    tipo: 'presupuesto',
    empresa_id: consulta.empresa_id,
    cliente: { id: clienteId, nombre: consulta.nombre, contacto: consulta.contacto },
    // El pedido viene de la tienda; `crear_comprobante` exige un canal válido.
    canal: 'tienda_online',
    fecha: hoyEnArgentina(),
    valido_hasta: '',
  })
  // Desde acá el presupuesto ya existe: un fallo NO puede decir «no se creó» (invitaría a reintentar y a acumular presupuestos vacíos).
  try {
    const actualizadoEn = (await obtenerComprobante(creado.id)).updated_at
    await guardarLineasComprobante(creado.id, entradas, actualizadoEn)
  } catch {
    throw new ErrorPresupuestoDesdePedido(
      `Se creó el presupuesto N° ${creado.numero} pero no se pudieron cargar los productos: abrilo y agregalos a mano.`,
      { id: creado.id, numero: creado.numero },
    )
  }
  return { id: creado.id, numero: creado.numero, omitidas }
}
