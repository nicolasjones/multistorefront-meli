import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { opcionesCategoriaProducto } from '../lib/categorias'
import { useCategorias } from './useCategorias'
import { useOrganizacionActiva } from './useOrganizacionActiva'

const MAX_PRODUCTOS = 20
const MAX_CLIENTES_PROVINCIA = 5000

export type OpcionProducto = { id: string; nombre: string; sku: string | null }
export type OpcionCategoria = { id: string; ruta: string; nivel: 0 | 1 }

// Texto que se arma en la clave de un filtro `or` de PostgREST: se quitan los caracteres con
// significado propio (coma, paréntesis, comodines y barra) para que el término no altere el filtro.
const limpiarBusqueda = (texto: string) => texto.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()

// Clave de comparación de provincias: sin mayúsculas ni tildes (igual que el servidor).
const claveProvincia = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

// Provincias distintas, una por clave (la primera grafía que aparece), ordenadas.
export function provinciasDistintas(valores: ReadonlyArray<string | null>): string[] {
  const porClave = new Map<string, string>()
  for (const valor of valores) {
    const texto = valor?.trim()
    if (texto && !porClave.has(claveProvincia(texto))) porClave.set(claveProvincia(texto), texto)
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

// Opciones de los filtros Producto, Categoría y Provincia del ranking (F-CLI-15, FR-009). Sin
// identificadores técnicos: productos por nombre/SKU, categorías con su ruta y provincias por nombre.
// RLS resuelve la organización. Las búsquedas siguen el patrón «última petición gana». `habilitado`
// difiere las tres consultas hasta que la persona usa los filtros (Principio VI: carga diferida).
export function useOpcionesDimension({ busquedaProducto, habilitado = true }: { busquedaProducto: string; habilitado?: boolean }) {
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const { categorias, isLoading: cargandoCategorias, isError: errorCategorias } = useCategorias({ habilitado })
  const opcionesCategorias = useMemo<OpcionCategoria[]>(() => opcionesCategoriaProducto(categorias), [categorias])

  const [productos, setProductos] = useState<OpcionProducto[]>([])
  const [cargandoProductos, setCargandoProductos] = useState(false)
  const [errorProductos, setErrorProductos] = useState(false)
  const ultimaBusqueda = useRef(0)
  const termino = limpiarBusqueda(busquedaProducto)

  const buscarProductos = useCallback(async () => {
    const peticion = ++ultimaBusqueda.current
    setCargandoProductos(true)
    let consulta = supabaseClient.schema('dominio').from('productos').select('id, nombre, sku')
    if (termino) consulta = consulta.or(`nombre.ilike.%${termino}%,sku.ilike.%${termino}%`)
    let resultado: { data: OpcionProducto[] | null; error: unknown }
    try {
      resultado = await consulta.order('nombre', { ascending: true }).order('id', { ascending: true }).limit(MAX_PRODUCTOS)
        .returns<OpcionProducto[]>()
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaBusqueda.current) return
    setErrorProductos(Boolean(resultado.error))
    setProductos(resultado.error ? [] : resultado.data ?? [])
    setCargandoProductos(false)
    // organizacionId solo dispara la recarga; la organización la resuelve RLS.
  }, [termino, organizacionId])

  useEffect(() => {
    if (habilitado) void buscarProductos()
  }, [habilitado, buscarProductos])

  const [provincias, setProvincias] = useState<string[]>([])
  const [errorProvincias, setErrorProvincias] = useState(false)
  const ultimaProvincias = useRef(0)
  useEffect(() => {
    const peticion = ++ultimaProvincias.current
    const cargar = async () => {
      let resultado: { data: Array<{ provincia: string | null }> | null; error: unknown }
      try {
        resultado = await supabaseClient.from('clientes').select('provincia').not('provincia', 'is', null).limit(MAX_CLIENTES_PROVINCIA)
          .returns<Array<{ provincia: string | null }>>()
      } catch (excepcion) {
        resultado = { data: null, error: excepcion }
      }
      if (peticion !== ultimaProvincias.current) return
      setErrorProvincias(Boolean(resultado.error))
      setProvincias(resultado.error ? [] : provinciasDistintas((resultado.data ?? []).map((fila) => fila.provincia)))
    }
    if (habilitado) void cargar()
  }, [habilitado, organizacionId])

  return {
    productos,
    categorias: opcionesCategorias,
    provincias,
    cargandoProductos,
    cargandoCategorias,
    isError: errorProductos || errorCategorias || errorProvincias,
  }
}
