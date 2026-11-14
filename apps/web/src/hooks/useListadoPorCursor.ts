import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { esSinAcceso } from '../lib/tiendaCuentaDatos'

// Carga infinita de un listado paginado por cursor (Constitución, Principio VI): la primera tanda se pide al cambiar
// `clave` (host, filtros…: nunca se mezcla lo de otra consulta) y `cargarMas` suma la siguiente a lo ya mostrado. Es el
// mismo esquema que `useCatalogoPublico`, pero con un cursor `(fecha, id)` en vez de un número de página, que es lo que
// entregan las RPC de «Mi cuenta» (`useListadoAcumulado` acumula por número de página y no sirve con un cursor).
// Se usa junto con `CargaInfinita`.

export type TandaPorCursor<T, C> = { total: number; filas: T[]; siguiente: C | null }

type Opciones<T, C> = {
  // Identidad de la consulta: cambiarla descarta lo acumulado y vuelve a la primera tanda.
  clave: string
  leer: (cursor: C | null) => Promise<TandaPorCursor<T, C>>
  // Identidad de cada fila: una fila que se corre de tanda no se repite.
  idDe: (fila: T) => string
  // La cuenta dejó de estar activa (FR-011): se descarta todo lo cargado y se avisa a la pantalla.
  alSinAcceso?: () => void
}

export type ListadoPorCursor<T> = {
  fase: 'cargando' | 'lista' | 'error' | 'sin_acceso'
  filas: T[]
  total: number
  hayMas: boolean
  cargandoMas: boolean
  errorMas: boolean
  cargarMas: () => void
  reintentar: () => void
  // Quita una fila ya cargada (p. ej. un favorito recién quitado) y devuelve lo necesario para volver a ponerla.
  quitar: (id: string) => { fila: T; indice: number } | null
  reponer: (fila: T, indice: number) => void
}

type Estado<T, C> = {
  clave: string
  fase: 'lista' | 'error' | 'sin_acceso'
  filas: T[]
  total: number
  siguiente: C | null
  cargandoMas: boolean
  errorMas: boolean
}

export function useListadoPorCursor<T, C>({ clave, leer, idDe, alSinAcceso }: Opciones<T, C>): ListadoPorCursor<T> {
  const [intento, setIntento] = useState(0)
  const [estado, setEstado] = useState<Estado<T, C> | null>(null)
  const claveCompleta = useMemo(() => JSON.stringify([clave, intento]), [clave, intento])
  // Al cambiar la consulta lo acumulado deja de valer ya en este render (incluso A→B→A): patrón «ajustar estado al cambiar una entrada».
  const [claveVista, setClaveVista] = useState(claveCompleta)
  if (claveVista !== claveCompleta) {
    setClaveVista(claveCompleta)
    setEstado(null)
  }

  const generacion = useRef(0)
  const enCurso = useRef(false)
  const ultimo = useRef<Estado<T, C> | null>(null)
  const funciones = useRef({ leer, idDe, alSinAcceso })
  useEffect(() => {
    ultimo.current = estado
    funciones.current = { leer, idDe, alSinAcceso }
  })

  useEffect(() => {
    let cancelada = false
    generacion.current += 1
    enCurso.current = false
    funciones.current.leer(null)
      .then((tanda) => {
        if (!cancelada) setEstado({ clave: claveCompleta, fase: 'lista', filas: tanda.filas, total: tanda.total, siguiente: tanda.siguiente, cargandoMas: false, errorMas: false })
      })
      .catch((error: unknown) => {
        if (cancelada) return
        if (esSinAcceso(error)) {
          setEstado({ clave: claveCompleta, fase: 'sin_acceso', filas: [], total: 0, siguiente: null, cargandoMas: false, errorMas: false })
          funciones.current.alSinAcceso?.()
          return
        }
        console.error('No se pudo cargar el listado de Mi cuenta', error instanceof Error ? error.message : error)
        setEstado({ clave: claveCompleta, fase: 'error', filas: [], total: 0, siguiente: null, cargandoMas: false, errorMas: false })
      })
    return () => { cancelada = true }
  }, [claveCompleta])

  const cargarMas = useCallback(() => {
    const actual = ultimo.current
    if (!actual || actual.fase !== 'lista' || actual.siguiente === null || enCurso.current) return
    enCurso.current = true
    const miGeneracion = generacion.current
    const vigente = () => generacion.current === miGeneracion
    setEstado({ ...actual, cargandoMas: true, errorMas: false })
    funciones.current.leer(actual.siguiente)
      .then((tanda) => {
        if (!vigente()) return
        const vistos = new Set(actual.filas.map(funciones.current.idDe))
        const nuevas = tanda.filas.filter((fila) => !vistos.has(funciones.current.idDe(fila)))
        setEstado((previo) => (previo && previo.clave === actual.clave
          ? { ...previo, filas: [...previo.filas, ...nuevas], total: tanda.total, siguiente: tanda.filas.length === 0 ? null : tanda.siguiente, cargandoMas: false, errorMas: false }
          : previo))
      })
      .catch((error: unknown) => {
        if (!vigente()) return
        if (esSinAcceso(error)) {
          setEstado({ clave: actual.clave, fase: 'sin_acceso', filas: [], total: 0, siguiente: null, cargandoMas: false, errorMas: false })
          funciones.current.alSinAcceso?.()
          return
        }
        console.error('No se pudo cargar más filas de Mi cuenta', error instanceof Error ? error.message : error)
        setEstado((previo) => (previo && previo.clave === actual.clave ? { ...previo, cargandoMas: false, errorMas: true } : previo))
      })
      .finally(() => {
        if (vigente()) enCurso.current = false
      })
  }, [])

  const reintentar = useCallback(() => setIntento((actual) => actual + 1), [])

  const quitar = useCallback((id: string) => {
    const actual = ultimo.current
    if (!actual) return null
    const indice = actual.filas.findIndex((fila) => funciones.current.idDe(fila) === id)
    if (indice < 0) return null
    const fila = actual.filas[indice]
    const nuevo = { ...actual, filas: actual.filas.filter((_, i) => i !== indice), total: Math.max(actual.total - 1, 0) }
    ultimo.current = nuevo
    setEstado(nuevo)
    return { fila, indice }
  }, [])

  const reponer = useCallback((fila: T, indice: number) => {
    setEstado((previo) => {
      if (!previo || previo.fase !== 'lista') return previo
      if (previo.filas.some((existente) => funciones.current.idDe(existente) === funciones.current.idDe(fila))) return previo
      const filas = [...previo.filas]
      filas.splice(Math.min(indice, filas.length), 0, fila)
      return { ...previo, filas, total: previo.total + 1 }
    })
  }, [])

  if (!estado || estado.clave !== claveCompleta) {
    return { fase: 'cargando', filas: [], total: 0, hayMas: false, cargandoMas: false, errorMas: false, cargarMas, reintentar, quitar, reponer }
  }
  return {
    fase: estado.fase,
    filas: estado.filas,
    total: estado.total,
    hayMas: estado.fase === 'lista' && estado.siguiente !== null,
    cargandoMas: estado.cargandoMas,
    errorMas: estado.errorMas,
    cargarMas,
    reintentar,
    quitar,
    reponer,
  }
}
