import { useEffect, useRef, useState } from 'react'
import { consultarImagenesPrincipales } from '../lib/imagenesPrincipales'
import { SEGUNDOS_URL_FIRMADA } from '../lib/productoImagenes'
import { supabaseClient } from '../lib/supabase'

// Las URL firmadas viven SEGUNDOS_URL_FIRMADA; se renuevan un poco antes de que venzan.
const VIDA_UTIL_MS = (SEGUNDOS_URL_FIRMADA - 30) * 1000

// Imagen principal de los productos de un listado: `Map<productoId, urlFirmada>`. Pide solo los productos
// que todavía no tiene (o cuya URL está por vencer), así que con carga infinita cada tanda trae únicamente
// sus imágenes. Si falla, el listado se muestra igual sin miniaturas (no tira abajo la pantalla).
export function useImagenesProductos(productoIds: ReadonlyArray<string | null | undefined>): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  // id → instante en que hay que volver a pedirla (también se anotan los productos sin imagen, para no insistir).
  const vencimientos = useRef(new Map<string, number>())
  const clave = [...new Set(productoIds.filter((id): id is string => Boolean(id)))].sort().join(',')

  useEffect(() => {
    const ahora = Date.now()
    const faltantes = clave === '' ? [] : clave.split(',').filter((id) => (vencimientos.current.get(id) ?? 0) <= ahora)
    if (faltantes.length === 0) return
    let vigente = true
    consultarImagenesPrincipales(supabaseClient, faltantes)
      .then((nuevas) => {
        if (!vigente) return
        const vence = Date.now() + VIDA_UTIL_MS
        for (const id of faltantes) vencimientos.current.set(id, vence)
        setUrls((anterior) => {
          const siguiente = new Map(anterior)
          for (const id of faltantes) {
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

  return urls
}
