import { useEffect, useRef, useState } from 'react'
import { consultarImagenesPrincipales } from '../lib/imagenesPrincipales'
import { SEGUNDOS_URL_FIRMADA } from '../lib/productoImagenes'
import { supabaseClient } from '../lib/supabase'

// Las URL firmadas viven SEGUNDOS_URL_FIRMADA; se renuevan un poco antes de que venzan.
const VIDA_UTIL_MS = (SEGUNDOS_URL_FIRMADA - 30) * 1000

// Imagen principal de los productos de un listado: `Map<productoId, urlFirmada>`. Pide solo los productos
// que todavía no tiene, así que con carga infinita cada tanda trae únicamente sus imágenes; las URL vencidas solo
// se renuevan cuando la lista cambia (no al sumar una tanda). Si falla, el listado se muestra igual sin miniaturas (no tira abajo la pantalla).
export function useImagenesProductos(productoIds: ReadonlyArray<string | null | undefined>): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  // id → instante en que hay que volver a pedirla (también se anotan los productos sin imagen, para no insistir).
  const vencimientos = useRef(new Map<string, number>())
  const clave = [...new Set(productoIds.filter((id): id is string => Boolean(id)))].sort().join(',')

  // Ids de la última pasada: si la lista nueva los contiene a todos es una AMPLIACIÓN (carga infinita: llegó otra
  // tanda) y no se re-firma nada de lo ya cargado (cambiaría el `src` de las filas visibles y recargaría sus miniaturas).
  const previos = useRef(new Set<string>())

  useEffect(() => {
    const ahora = Date.now()
    const ids = clave === '' ? [] : clave.split(',')
    const anteriores = previos.current
    const esAmpliacion = anteriores.size > 0 && [...anteriores].every((id) => ids.includes(id))
    previos.current = new Set(ids)
    // Siempre lo que nunca se pidió; lo vencido solo cuando la lista cambió de otra manera (filtros, otra pantalla):
    // ahí las filas se vuelven a montar y necesitan una URL vigente.
    const faltantes = ids.filter((id) => {
      const vence = vencimientos.current.get(id)
      return vence === undefined || (!esAmpliacion && vence <= ahora)
    })
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
