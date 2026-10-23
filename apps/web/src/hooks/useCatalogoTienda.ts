import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  guardarCatalogoTienda,
  listarCatalogoTienda,
  type CambiosCatalogoTienda,
  type CatalogoTienda,
  type ProductoTienda,
} from '../lib/tiendaCatalogo'

type BorradorProducto = { visible?: boolean; destacado?: boolean }

// Catálogo visible de la tienda de una empresa (F-TDA-04, FR-041…FR-048). Lo guardado lo calcula
// la base (visibilidad efectiva, motivo y resumen); acá solo se mantiene el borrador local de los
// interruptores y estrellas hasta «Guardar» / «Descartar». Cambiar de empresa (empresaId) descarta
// el borrador y rehace la consulta: nunca queda nada de la empresa anterior (Principio VIII).
export function useCatalogoTienda(empresaId: string) {
  const [catalogo, setCatalogo] = useState<CatalogoTienda | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [categorias, setCategorias] = useState<Record<string, boolean>>({})
  const [productos, setProductos] = useState<Record<string, BorradorProducto>>({})
  const ultimaPeticion = useRef(0)

  const descartar = useCallback(() => {
    setCategorias({})
    setProductos({})
    setErrorGuardado(null)
  }, [])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setCatalogo(null)
    descartar()
    try {
      const resultado = await listarCatalogoTienda(empresaId)
      if (peticion !== ultimaPeticion.current) return
      setCatalogo(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudo cargar el catálogo de la tienda', error instanceof Error ? error.message : error)
      setHayError(true)
    }
    setCargando(false)
  }, [empresaId, descartar])

  useEffect(() => {
    void cargar()
    return () => { ultimaPeticion.current++ }
  }, [cargar])

  const categoriaVisible = useCallback(
    (id: string) => categorias[id] ?? catalogo?.categorias.find((c) => c.id === id)?.visible ?? true,
    [categorias, catalogo],
  )

  const productoVisible = useCallback(
    (p: ProductoTienda) => productos[p.id]?.visible ?? p.visible,
    [productos],
  )

  const productoDestacado = useCallback(
    (p: ProductoTienda) => productos[p.id]?.destacado ?? p.destacado,
    [productos],
  )

  const cambiarCategoria = useCallback((id: string, visible: boolean) => {
    setCategorias((previo) => ({ ...previo, [id]: visible }))
  }, [])

  const cambiarProducto = useCallback((id: string, cambio: BorradorProducto) => {
    setProductos((previo) => ({ ...previo, [id]: { ...previo[id], ...cambio } }))
  }, [])

  // Solo viaja lo que difiere de lo guardado (la RPC es idempotente de todos modos).
  const cambios = useMemo<CambiosCatalogoTienda>(() => {
    if (!catalogo) return { categorias: [], productos: [] }
    return {
      categorias: catalogo.categorias
        .filter((c) => c.id in categorias && categorias[c.id] !== c.visible)
        .map((c) => ({ id: c.id, visible: categorias[c.id] })),
      productos: catalogo.productos
        .filter((p) => productoVisible(p) !== p.visible || productoDestacado(p) !== p.destacado)
        .map((p) => ({ id: p.id, visible: productoVisible(p), destacado: productoDestacado(p) })),
    }
  }, [catalogo, categorias, productoVisible, productoDestacado])

  const hayCambios = cambios.categorias.length > 0 || cambios.productos.length > 0

  const guardar = useCallback(async (): Promise<boolean> => {
    if (!hayCambios) return true
    setGuardando(true)
    setErrorGuardado(null)
    const peticion = ultimaPeticion.current
    try {
      await guardarCatalogoTienda(empresaId, cambios)
    } catch (error) {
      console.error('No se pudo guardar el catálogo de la tienda', error instanceof Error ? error.message : error)
      if (peticion === ultimaPeticion.current) {
        setErrorGuardado('No pudimos guardar los cambios. Revisá tu conexión e intentá de nuevo.')
        setGuardando(false)
      }
      return false
    }
    if (peticion !== ultimaPeticion.current) return true
    setGuardando(false)
    await cargar()
    return true
  }, [empresaId, cambios, hayCambios, cargar])

  return {
    catalogo,
    isLoading: cargando,
    isError: hayError,
    refetch: cargar,
    guardando,
    errorGuardado,
    hayCambios,
    categoriaVisible,
    productoVisible,
    productoDestacado,
    cambiarCategoria,
    cambiarProducto,
    guardar,
    descartar,
  }
}
