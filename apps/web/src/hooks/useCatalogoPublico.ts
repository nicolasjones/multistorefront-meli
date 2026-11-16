import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  // Límite de búsquedas en una tanda siguiente (FR-027): aviso y segundos antes de poder reintentar; `null` si no aplica.
  esperaMas: EsperaMas | null
}

export type EsperaMas = { mensaje: string; segundos: number }

type Acumulado = {
  clave: string
  estado: Exclude<EstadoCatalogoPublico, { fase: 'cargando' }>
  cargandoMas: boolean
  errorMas: boolean
  esperaMas?: EsperaMas
  // La última tanda no trajo nada nuevo aunque el total diga que falta: se corta para no pedir sin fin.
  agotado?: boolean
}

const MENSAJE_LIMITE = 'Hiciste muchas búsquedas seguidas, esperá unos segundos y reintentá'

// Catálogo público con carga infinita (F-TDA-12, FR-040/FR-041; MSF-845). La primera tanda se pide al
// cambiar host, filtros, orden o `q` (reinicio desde el principio: nunca se mezclan resultados de otra
// consulta) y `cargarMas` suma la siguiente de a una, con un firmado en lote de las imágenes de cada tanda.
// Con `q` (F-TDA-15, FR-025) lee la búsqueda en vez del catálogo; el resto del flujo es el mismo.
export function useCatalogoPublico(host: string, filtros: FiltrosCatalogo, q: string | null = null): CatalogoPublico {
  const [intento, setIntento] = useState(0)
  const [acumulado, setAcumulado] = useState<Acumulado | null>(null)
  const clave = useMemo(() => JSON.stringify([host, filtros, q, intento]), [host, filtros, q, intento])
  // Al cambiar la clave (incluso A→B→A) lo acumulado deja de valer ya en este render: sin esto, al volver a A se
  // vería un instante la lista vieja de A, que tiene la misma clave. Es el patrón de «ajustar estado al cambiar una entrada».
  const [claveVista, setClaveVista] = useState(clave)
  if (claveVista !== clave) {
    setClaveVista(clave)
    setAcumulado(null)
  }
  // Se actualizan en efectos (no durante el render). `generacion` identifica la consulta vigente: sube cada vez
  // que arranca una primera tanda, así una respuesta tardía de una consulta anterior (incluso A→B→A, con la
  // misma clave) no se cuela.
  const generacion = useRef(0)
  const ultimo = useRef<Acumulado | null>(null)
  const enCurso = useRef(false)
  useEffect(() => {
    ultimo.current = acumulado
  }, [acumulado])

  const leer = useCallback(
    (pagina: number) => (q ? leerPaginaBusqueda(host, q, filtros, pagina) : leerPaginaCatalogo(host, filtros, pagina)),
    // `clave` resume host, filtros y q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clave],
  )

  useEffect(() => {
    let cancelada = false
    generacion.current += 1
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
    if (!actual || actual.estado.fase !== 'lista' || enCurso.current) return
    const { pagina, imagenes } = actual.estado
    enCurso.current = true
    const claveDePedido = actual.clave
    const miGeneracion = generacion.current
    const vigente = () => generacion.current === miGeneracion
    setAcumulado({ ...actual, cargandoMas: true, errorMas: false, esperaMas: undefined })
    leer(pagina.pagina + 1)
      .then(async (tanda) => {
        if (!vigente()) return
        // Una tanda con `esperaSegundos` es el límite de búsquedas (FR-027): se corta antes de firmar imágenes.
        if (tanda.esperaSegundos !== undefined) {
          setAcumulado({
            clave: claveDePedido,
            estado: { fase: 'lista', pagina, imagenes },
            cargandoMas: false,
            errorMas: true,
            esperaMas: { mensaje: MENSAJE_LIMITE, segundos: tanda.esperaSegundos },
          })
          return
        }
        const nuevas = await urlsImagenesProducto(tanda.productos.flatMap((p) => (p.imagen ? [p.imagen] : [])))
        if (!vigente()) return
        const vistos = new Set(pagina.productos.map((p) => p.id))
        // Un producto puede correrse de tanda si el catálogo cambia entre dos pedidos: no se repite.
        const productos = [...pagina.productos, ...tanda.productos.filter((p) => !vistos.has(p.id))]
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
        if (vigente()) setAcumulado({ clave: claveDePedido, estado: { fase: 'lista', pagina, imagenes }, cargandoMas: false, errorMas: true })
      })
      .finally(() => {
        if (vigente()) enCurso.current = false
      })
  }, [leer])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  if (!acumulado || acumulado.clave !== clave) {
    return { fase: 'cargando', reintentar, cargarMas, hayMas: false, cargandoMas: false, errorMas: false, esperaMas: null }
  }
  const { estado, cargandoMas, errorMas, agotado, esperaMas = null } = acumulado
  const hayMas =
    estado.fase === 'lista' && !agotado && estado.pagina.esperaSegundos === undefined && estado.pagina.productos.length < estado.pagina.total
  return { ...estado, reintentar, cargarMas, hayMas, cargandoMas, errorMas, esperaMas }
}
