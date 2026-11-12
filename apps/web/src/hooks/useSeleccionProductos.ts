import { useCallback, useMemo, useState } from 'react'

const VACIA: ReadonlySet<string> = new Set()

// Tope de la RPC (Contrato: de 1 a 100 ids). Con carga infinita pueden estar cargadas más filas.
export const MAXIMO_SELECCION = 100

// Selección de productos del listado (F-CAT-12, FR-001/FR-007): ids de las filas cargadas (hasta 100). Se reinicia
// sola cuando cambia el `contexto` (empresa activa, filtros, búsqueda u orden; pedir más filas no lo cambia) y descarta los ids que ya no
// están en las filas visibles. Sin efectos: el contexto se compara al leer.
export function useSeleccionProductos(contexto: string, idsVisibles: readonly string[]) {
  const [estado, setEstado] = useState<{ contexto: string; ids: ReadonlySet<string> }>({ contexto, ids: VACIA })
  const visibles = useMemo(() => new Set(idsVisibles), [idsVisibles])
  const ids = useMemo(
    () => (estado.contexto === contexto ? new Set([...estado.ids].filter((id) => visibles.has(id))) : VACIA),
    [estado, contexto, visibles],
  )

  const alternar = useCallback((id: string) => {
    setEstado((actual) => {
      const base = actual.contexto === contexto ? new Set(actual.ids) : new Set<string>()
      if (base.has(id)) base.delete(id)
      else if (base.size < MAXIMO_SELECCION) base.add(id)
      return { contexto, ids: base }
    })
  }, [contexto])

  const todosMarcados = idsVisibles.length > 0 && idsVisibles.slice(0, MAXIMO_SELECCION).every((id) => ids.has(id))
  const alternarTodos = useCallback(() => {
    setEstado({ contexto, ids: todosMarcados ? VACIA : new Set(idsVisibles.slice(0, MAXIMO_SELECCION)) })
  }, [contexto, idsVisibles, todosMarcados])

  const limpiar = useCallback(() => setEstado({ contexto, ids: VACIA }), [contexto])

  return { ids, cantidad: ids.size, todosMarcados, alternar, alternarTodos, limpiar }
}
