import { useCallback, useEffect, useState } from 'react'
import { esSinAcceso, leerFavoritosEntre } from '../lib/tiendaCuentaDatos'

// Qué productos de una pantalla son favoritos de la cuenta (F-CLI-20, FR-007): UNA llamada por pantalla
// (`favoritos_entre_por_dominio`, hasta 50 ids), no una por tarjeta ni por botón. `activo = false` (sin sesión o con la
// función apagada) no llama y descarta lo que hubiera. `sesion` (el contador de ingresos y salidas) entra en la clave:
// si se va una persona y entra otra, lo de la anterior no se muestra. `marcar` refleja un cambio ya confirmado por el servidor sin volver a pedir.
export type FavoritosEntre = {
  fase: 'cargando' | 'lista' | 'error' | 'sin_acceso'
  esFavorito: (productoId: string) => boolean
  marcar: (productoId: string, favorito: boolean) => void
}

type Resultado = { clave: string; fase: 'lista' | 'error' | 'sin_acceso'; ids: ReadonlySet<string> }

export function useFavoritosEntre(host: string, productos: readonly string[], activo: boolean, sesion = 0): FavoritosEntre {
  const clave = JSON.stringify([host, activo, sesion, [...productos].sort()])
  const [resultado, setResultado] = useState<Resultado | null>(null)
  // Al dejar de estar activo (cierre de sesión, función apagada) no queda nada de la persona anterior.
  if (!activo && resultado !== null) setResultado(null)

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    leerFavoritosEntre(host, productos)
      .then((ids) => { if (!cancelada) setResultado({ clave, fase: 'lista', ids: new Set(ids) }) })
      .catch((error: unknown) => {
        if (cancelada) return
        if (!esSinAcceso(error)) console.error('No se pudo leer qué productos son favoritos', error instanceof Error ? error.message : error)
        setResultado({ clave, fase: esSinAcceso(error) ? 'sin_acceso' : 'error', ids: new Set() })
      })
    return () => { cancelada = true }
    // `clave` resume host, activo y productos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const marcar = useCallback((productoId: string, favorito: boolean) => {
    setResultado((previo) => {
      if (!previo) return previo
      const ids = new Set(previo.ids)
      if (favorito) ids.add(productoId)
      else ids.delete(productoId)
      return { ...previo, fase: 'lista', ids }
    })
  }, [])

  const vigente = activo && resultado && resultado.clave === clave ? resultado : null
  return {
    fase: !activo ? 'cargando' : vigente ? vigente.fase : 'cargando',
    esFavorito: (productoId) => vigente?.ids.has(productoId) ?? false,
    marcar,
  }
}
