import { useCallback, useSyncExternalStore } from 'react'
import {
  agregarALista,
  almacenamientoBloqueado,
  fijarCantidad,
  leerLista,
  quitarDeLista,
  quitarVariosDeLista,
  suscribirLista,
  vaciarLista,
  type LineaPedido,
  type ResultadoAgregar,
} from '../lib/listaPedido'

// Lista de pedido de la tienda del host (MSF-176, B1, FR-020/FR-021/FR-022): las líneas {productoId, cantidad} del navegador y sus acciones.
// El número del encabezado es la cantidad de PRODUCTOS DISTINTOS (`productos`), no de unidades. Se actualiza al instante al agregar o
// quitar (misma pestaña) y al volver el foco o cambiar el almacenamiento (otras pestañas).
export type ListaPedido = {
  lineas: readonly LineaPedido[]
  productos: number
  // Navegador que no deja guardar la lista: dura mientras la página esté abierta.
  bloqueado: boolean
  agregar: (productoId: string, cantidad?: number) => ResultadoAgregar
  fijar: (productoId: string, cantidad: number) => void
  quitar: (productoId: string) => void
  quitarVarios: (productoIds: readonly string[]) => void
  vaciar: () => void
  cantidadDe: (productoId: string) => number
}

// Un host vacío (vista previa del panel) no tiene lista.
export function useListaPedido(host: string): ListaPedido {
  const lineas = useSyncExternalStore(
    useCallback((avisar) => suscribirLista(host, avisar), [host]),
    () => leerLista(host),
    () => leerLista(host),
  )
  const bloqueado = useSyncExternalStore(
    useCallback((avisar) => suscribirLista(host, avisar), [host]),
    almacenamientoBloqueado,
    almacenamientoBloqueado,
  )
  const agregar = useCallback((productoId: string, cantidad = 1) => agregarALista(host, productoId, cantidad), [host])
  const fijar = useCallback((productoId: string, cantidad: number) => fijarCantidad(host, productoId, cantidad), [host])
  const quitar = useCallback((productoId: string) => quitarDeLista(host, productoId), [host])
  const quitarVarios = useCallback((productoIds: readonly string[]) => quitarVariosDeLista(host, productoIds), [host])
  const vaciar = useCallback(() => vaciarLista(host), [host])
  const cantidadDe = useCallback((productoId: string) => lineas.find((linea) => linea.productoId === productoId.toLowerCase())?.cantidad ?? 0, [lineas])
  return { lineas, productos: lineas.length, bloqueado, agregar, fijar, quitar, quitarVarios, vaciar, cantidadDe }
}
