import { useCallback, useEffect, useRef, useState } from 'react'

type Opciones<T> = {
  // Filas de la página actual, tal como las entrega el hook de datos de la pantalla.
  items: readonly T[]
  pagina: number
  setPagina: (pagina: number) => void
  // Total de filas del servidor (para saber si hay más).
  total: number
  // true mientras llega la página `pagina` (primera carga o tanda siguiente).
  cargando: boolean
  // Cambia cuando cambia la búsqueda, un filtro o el orden: vuelve a la tanda 1 y descarta lo acumulado.
  reinicio: unknown
}

export type ListadoAcumulado<T> = {
  // Todas las filas cargadas hasta ahora, en orden.
  filas: T[]
  hayMas: boolean
  // Se está pidiendo una tanda siguiente (no la primera).
  cargandoMas: boolean
  cargarMas: () => void
}

const aClave = (valor: unknown) => (typeof valor === 'string' ? valor : JSON.stringify(valor))

// Carga infinita (Constitución, Principio VI) SOBRE un hook de datos paginado ya existente: la pantalla sigue
// pidiendo «la página N» a su hook y este suma cada página a las anteriores. Así no se reescribe la capa de datos
// de cada listado (RPC, vista, react-query…). Se usa junto con `CargaInfinita`.
//
// Las páginas ya completas se guardan en una referencia en el momento de pedir la siguiente (`cargarMas`), no en un
// efecto: no hay estado que se actualice en cada render, así que no entra en bucle aunque `items` sea un arreglo
// nuevo en cada render. Los datos deben llegar de forma asíncrona (con `cargando`); si todas las filas ya están
// en memoria se usa `useListadoLocal`.
export function useListadoAcumulado<T>({ items, pagina, setPagina, total, cargando, reinicio }: Opciones<T>): ListadoAcumulado<T> {
  const previas = useRef(new Map<number, readonly T[]>())
  // `items` de la página anterior en el instante de pedir la siguiente: mientras `items` siga siendo ese mismo
  // arreglo, la página nueva todavía no llegó (evita sumar dos veces la anterior).
  const alPedir = useRef<readonly T[] | null>(null)
  const claveReinicio = aClave(reinicio)
  const claveVista = useRef(claveReinicio)

  // Cambió la búsqueda/filtro/orden: se descarta lo acumulado y se vuelve a la tanda 1.
  useEffect(() => {
    if (claveVista.current === claveReinicio) return
    claveVista.current = claveReinicio
    previas.current = new Map()
    alPedir.current = null
    if (pagina !== 1) setPagina(1)
  }, [claveReinicio, pagina, setPagina])

  const cargarMas = useCallback(() => {
    if (cargando) return
    previas.current.set(pagina, items)
    alPedir.current = items
    setPagina(pagina + 1)
  }, [cargando, items, pagina, setPagina])

  const paginaLista = !cargando && items !== alPedir.current
  const acumuladas: T[] = []
  for (let numero = 1; numero < pagina; numero += 1) acumuladas.push(...(previas.current.get(numero) ?? []))
  // La primera página muestra siempre lo que entrega el hook de datos (también mientras se actualiza).
  const filas = pagina === 1 ? [...items] : paginaLista ? [...acumuladas, ...items] : acumuladas
  const sinMas = pagina > 1 && paginaLista && items.length === 0

  return { filas, hayMas: !sinMas && filas.length < total, cargandoMas: cargando && pagina > 1, cargarMas }
}

// Variante para listados que ya tienen TODAS las filas en memoria (paginación del lado del cliente):
// va mostrando de a `tamano` a medida que se llega al final.
export function useListadoLocal<T>(items: readonly T[], tamano = 25, reinicio: unknown = null) {
  const [visibles, setVisibles] = useState(tamano)
  const clave = aClave(reinicio)
  const claveVista = useRef(clave)
  useEffect(() => {
    if (claveVista.current === clave) return
    claveVista.current = clave
    setVisibles(tamano)
  }, [clave, tamano])
  const cargarMas = useCallback(() => setVisibles((v) => v + tamano), [tamano])
  return { filas: items.slice(0, visibles), hayMas: items.length > visibles, cargandoMas: false, cargarMas }
}
