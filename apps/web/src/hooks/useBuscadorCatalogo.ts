import { useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { LARGO_MAXIMO_BUSQUEDA } from '../lib/productosListado'

/** Tope de opciones que se traen del servidor en una consulta de catálogo. */
export const MAXIMO_OPCIONES_CATALOGO = 500
/** Espera antes de consultar al servidor mientras se escribe. */
const ESPERA_BUSQUEDA_MS = 250

type Opciones = {
  tabla: 'productos' | 'proveedores'
  /** Columnas a traer, separadas por coma. */
  columnas: string
  /** Columnas en las que se busca el texto, separadas por coma (ilike, «contiene»). */
  columnasBusqueda: string
  orden: string
  soloActivos?: boolean
  /** Solo consulta mientras es true (p. ej. con la lista desplegada). */
  habilitado: boolean
}

// Texto del usuario como patrón de `ilike` dentro de un filtro `or` de PostgREST: se acota el
// largo, se quitan los caracteres que separan o agrupan condiciones (`,` `(` `)` `"` `\`) y el
// comodín `*` de PostgREST, y se escapan los comodines de LIKE (`%` `_`), para que lo tipeado se
// busque como texto y no altere la consulta (mismo criterio que `lib/productosListado.ts`).
export const filtroBusquedaCatalogo = (texto: string, columnas: string[]): string | null => {
  const limpio = texto
    .slice(0, LARGO_MAXIMO_BUSQUEDA)
    .replace(/[,()"\\*]/g, ' ')
    .replace(/[%_]/g, (caracter) => `\\${caracter}`)
    .trim()
  if (limpio === '') return null
  return columnas.map((columna) => `${columna}.ilike.%${limpio}%`).join(',')
}

/** Aviso que se muestra cuando el catálogo tiene más registros que el tope. */
export const avisoCatalogoTruncado = (plural: string) =>
  `Hay más de ${MAXIMO_OPCIONES_CATALOGO} ${plural}: escribí para buscar el que necesitás.`

// Búsqueda por texto en el servidor (la RLS del llamador decide qué ve) con tope de
// MAXIMO_OPCIONES_CATALOGO: se pide una fila de más para saber si el catálogo se cortó
// (`truncado`). «Última petición gana»: una respuesta vieja no pisa a la nueva.
export function useBuscadorCatalogo<T>({ tabla, columnas, columnasBusqueda, orden, soloActivos = false, habilitado }: Opciones) {
  const [texto, setTexto] = useState('')
  const [opciones, setOpciones] = useState<T[]>([])
  const [truncado, setTruncado] = useState(false)
  const [error, setError] = useState(false)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!habilitado) return
    let vigente = true
    const temporizador = setTimeout(() => {
      void (async () => {
        setCargando(true)
        let consulta = supabaseClient.schema('dominio').from(tabla).select(columnas)
        if (soloActivos) consulta = consulta.eq('activo', true)
        const filtro = filtroBusquedaCatalogo(texto, columnasBusqueda.split(',').map((columna) => columna.trim()).filter(Boolean))
        if (filtro) consulta = consulta.or(filtro)
        let respuesta: { data: T[] | null; error: unknown }
        try {
          respuesta = await consulta
            .order(orden, { ascending: true })
            .order('id', { ascending: true })
            .limit(MAXIMO_OPCIONES_CATALOGO + 1)
            .returns<T[]>()
        } catch (excepcion) {
          respuesta = { data: null, error: excepcion }
        }
        if (!vigente) return
        if (respuesta.error) {
          console.error(`No pudimos buscar en ${tabla}.`, respuesta.error)
          setError(true)
        } else {
          const filas = respuesta.data ?? []
          setError(false)
          setTruncado(filas.length > MAXIMO_OPCIONES_CATALOGO)
          setOpciones(filas.slice(0, MAXIMO_OPCIONES_CATALOGO))
        }
        setCargando(false)
      })()
    }, texto.trim() === '' ? 0 : ESPERA_BUSQUEDA_MS)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [habilitado, texto, tabla, columnas, columnasBusqueda, orden, soloActivos])

  return { opciones, truncado, error, cargando, buscar: setTexto }
}
