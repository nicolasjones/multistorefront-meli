import { useCallback, useEffect, useRef, useState } from 'react'
import { consultarImagenesPrincipales } from '../lib/imagenesPrincipales'
import { SEGUNDOS_URL_FIRMADA } from '../lib/productoImagenes'
import { supabaseClient } from '../lib/supabase'

// Las URL firmadas viven SEGUNDOS_URL_FIRMADA; se renuevan un poco antes de que venzan.
const VIDA_UTIL_MS = (SEGUNDOS_URL_FIRMADA - 30) * 1000

export type ImagenesProductos = {
  /** `Map<productoId, urlFirmada>`. */
  imagenes: ReadonlyMap<string, string>
  /**
   * Pide una URL nueva para un producto cuya imagen no pudo cargarse (p. ej. la URL firmada venció antes de que el
   * usuario hiciera scroll). Una sola vez por producto: si la nueva también falla, queda el recuadro vacío (sin bucles).
   */
  renovar: (productoId: string) => void
}

// Imagen principal de los productos de un listado. Pide solo los productos que todavía no tiene, así que con carga
// infinita cada tanda trae únicamente sus imágenes. Las URL vencidas solo se renuevan cuando la lista cambia de otra
// manera que sumando una tanda al final (filtros, orden, búsqueda): ahí las filas se vuelven a montar y necesitan una
// URL vigente. Si falla, el listado se muestra igual sin miniaturas (no tira abajo la pantalla); los productos de un
// bloque que falló NO se anotan como «sin imagen»: se reintentan en el siguiente cambio de lista.
export function useImagenesProductosRenovables(productoIds: ReadonlyArray<string | null | undefined>): ImagenesProductos {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  // id → instante en que hay que volver a pedirla (también se anotan los productos sin imagen, para no insistir).
  const vencimientos = useRef(new Map<string, number>())
  // Ids ya renovados por fallo de carga (tope: una vez por id).
  const renovados = useRef(new Set<string>())
  // Clave en el ORDEN recibido (no ordenada): permite distinguir «sumó una tanda al final» de «cambió la lista».
  const clave = [...new Set(productoIds.filter((id): id is string => Boolean(id)))].join(',')
  const anteriores = useRef<string[]>([])

  useEffect(() => {
    const ahora = Date.now()
    const ids = clave === '' ? [] : clave.split(',')
    const previos = anteriores.current
    // AMPLIACIÓN (carga infinita): los ids anteriores son un PREFIJO de la lista nueva, en el mismo orden. No se re-firma
    // nada de lo ya cargado (cambiaría el `src` de las filas visibles y recargaría sus miniaturas). Un superconjunto en
    // otro orden (p. ej. de «En alerta» a «Todos») NO es una ampliación: las filas se montan de nuevo.
    const esAmpliacion = previos.length > 0 && previos.length <= ids.length && previos.every((id, indice) => ids[indice] === id)
    anteriores.current = ids
    const faltantes = ids.filter((id) => {
      const vence = vencimientos.current.get(id)
      return vence === undefined || (!esAmpliacion && vence <= ahora)
    })
    if (faltantes.length === 0) return
    let vigente = true
    consultarImagenesPrincipales(supabaseClient, faltantes)
      .then(({ urls: nuevas, fallidos }) => {
        if (!vigente) return
        const vence = Date.now() + VIDA_UTIL_MS
        const resueltos = faltantes.filter((id) => !fallidos.has(id))
        // Los de un bloque caído no se anotan: se reintentan en el siguiente cambio de lista (el efecto solo depende de `clave`).
        for (const id of resueltos) vencimientos.current.set(id, vence)
        setUrls((anterior) => {
          const siguiente = new Map(anterior)
          for (const id of resueltos) {
            const url = nuevas.get(id)
            if (url) siguiente.set(id, url)
            else siguiente.delete(id)
          }
          return siguiente
        })
      })
      .catch((error) => console.error('No pudimos cargar las imágenes de los productos.', error))
    return () => {
      vigente = false
    }
  }, [clave])

  const renovar = useCallback((productoId: string) => {
    if (renovados.current.has(productoId)) return
    renovados.current.add(productoId)
    consultarImagenesPrincipales(supabaseClient, [productoId])
      .then(({ urls: nuevas }) => {
        const url = nuevas.get(productoId)
        if (!url) return
        vencimientos.current.set(productoId, Date.now() + VIDA_UTIL_MS)
        setUrls((anterior) => new Map(anterior).set(productoId, url))
      })
      .catch((error) => console.error('No pudimos renovar la imagen del producto.', error))
  }, [])

  return { imagenes: urls, renovar }
}

// Versión simple para los listados que solo necesitan el mapa de URL (todas las pantallas actuales).
export function useImagenesProductos(productoIds: ReadonlyArray<string | null | undefined>): ReadonlyMap<string, string> {
  return useImagenesProductosRenovables(productoIds).imagenes
}
