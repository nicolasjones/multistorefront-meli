import { useCallback, useEffect, useRef, useState } from 'react'
import { urlsImagenesProducto } from '../lib/imagenProducto'
import { leerPaginaBusqueda } from '../lib/tiendaBusqueda'
import { leerPaginaCatalogo, type FiltrosCatalogo, type PaginaCatalogo } from '../lib/tiendaListado'

// `pagina.productos` es todo lo cargado hasta ahora (tandas sumadas); `pagina.pagina` es la última tanda
// leída y `pagina.total` el total del servidor.
export type EstadoCatalogoPublico =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'lista'; pagina: PaginaCatalogo; imagenes: Record<string, string> }

export type CatalogoPublico = EstadoCatalogoPublico & {
  // Repite la primera tanda (pantalla de error o aviso de espera de la búsqueda).
  reintentar: () => void
  // Pide la tanda siguiente y la suma a lo mostrado; también reintenta una tanda que falló.
  cargarMas: () => void
  hayMas: boolean
  cargandoMas: boolean
  errorMas: boolean
}

type Acumulado = {
  clave: string
  estado: Exclude<EstadoCatalogoPublico, { fase: 'cargando' }>
  cargandoMas: boolean
  errorMas: boolean
  // La última tanda no trajo nada nuevo aunque el total diga que falta: se corta para no pedir sin fin.
  agotado?: boolean
}

// Catálogo público con carga infinita (F-TDA-12, FR-040/FR-041; MSF-845). La primera tanda se pide al
// cambiar host, filtros, orden o `q` (reinicio desde el principio: nunca se mezclan resultados de otra
// consulta) y `cargarMas` suma la siguiente de a una, con un firmado en lote de las imágenes de cada tanda.
// Con `q` (F-TDA-15, FR-025) lee la búsqueda en vez del catálogo; el resto del flujo es el mismo.
export function useCatalogoPublico(host: string, filtros: FiltrosCatalogo, q: string | null = null): CatalogoPublico {
  const [intento, setIntento] = useState(0)
  const [acumulado, setAcumulado] = useState<Acumulado | null>(null)
  const clave = JSON.stringify([host, filtros, q, intento])
  const claveActual = useRef(clave)
  claveActual.current = clave
  const ultimo = useRef<Acumulado | null>(null)
  ultimo.current = acumulado
  const enCurso = useRef(false)

  const leer = useCallback(
    (pagina: number) => (q ? leerPaginaBusqueda(host, q, filtros, pagina) : leerPaginaCatalogo(host, filtros, pagina)),
    // `clave` resume host, filtros y q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clave],
  )

  useEffect(() => {
    let cancelada = false
    enCurso.current = false
    leer(1)
      .then(async (pagina) => {
        const imagenes = await urlsImagenesProducto(pagina.productos.flatMap((p) => (p.imagen ? [p.imagen] : [])))
        if (!cancelada) setAcumulado({ clave, estado: { fase: 'lista', pagina, imagenes }, cargandoMas: false, errorMas: false })
      })
      .catch((error) => {
        console.error('No se pudo cargar el catálogo de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setAcumulado({ clave, estado: { fase: 'error' }, cargandoMas: false, errorMas: false })
      })
    return () => { cancelada = true }
    // `clave` resume host, filtros, q e intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const cargarMas = useCallback(() => {
    const actual = ultimo.current
    if (!actual || actual.clave !== claveActual.current || actual.estado.fase !== 'lista' || enCurso.current) return
    const { pagina, imagenes } = actual.estado
    enCurso.current = true
    const claveDePedido = actual.clave
    setAcumulado({ ...actual, cargandoMas: true, errorMas: false })
    leer(pagina.pagina + 1)
      .then(async (tanda) => {
        const nuevas = await urlsImagenesProducto(tanda.productos.flatMap((p) => (p.imagen ? [p.imagen] : [])))
        if (claveActual.current !== claveDePedido) return
        const vistos = new Set(pagina.productos.map((p) => p.id))
        // Un producto puede correrse de tanda si el catálogo cambia entre dos pedidos: no se repite.
        const productos = [...pagina.productos, ...tanda.productos.filter((p) => !vistos.has(p.id))]
        // Una tanda con `esperaSegundos` es el límite de búsquedas (FR-027): se trata como fallo reintentable.
        if (tanda.esperaSegundos !== undefined) throw new Error('límite de búsquedas')
        setAcumulado({
          clave: claveDePedido,
          estado: { fase: 'lista', pagina: { ...pagina, ...tanda, categorias: pagina.categorias, productos }, imagenes: { ...imagenes, ...nuevas } },
          cargandoMas: false,
          errorMas: false,
          agotado: productos.length === pagina.productos.length,
        })
      })
      .catch((error) => {
        console.error('No se pudo cargar más productos de la tienda', error instanceof Error ? error.message : error)
        if (claveActual.current === claveDePedido) setAcumulado({ clave: claveDePedido, estado: { fase: 'lista', pagina, imagenes }, cargandoMas: false, errorMas: true })
      })
      .finally(() => {
        if (claveActual.current === claveDePedido) enCurso.current = false
      })
  }, [leer])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!acumulado || acumulado.clave !== clave) {
    return { fase: 'cargando', reintentar, cargarMas, hayMas: false, cargandoMas: false, errorMas: false }
  }
  const { estado, cargandoMas, errorMas, agotado } = acumulado
  const hayMas =
    estado.fase === 'lista' && !agotado && estado.pagina.esperaSegundos === undefined && estado.pagina.productos.length < estado.pagina.total
  return { ...estado, reintentar, cargarMas, hayMas, cargandoMas, errorMas }
}
