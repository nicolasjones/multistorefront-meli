// Reparto de ids en lotes para consultas cuyo filtro viaja en la URL del GET (MSF-716).
// PostgREST arma el filtro `in.(…)` en la query string: con ids de 36 caracteres (uuid) cada uno
// ocupa ~39 bytes, así que 100 ids ≈ 4,1 KB queda muy por debajo del límite típico de 8 KB del proxy.
// Lo usan el stock por depósito de la toma de inventario, el filtro por categoría de esa pantalla y
// los costos del listado de productos: los tres filtros viajan por la misma URL.

// Ids por petición: 100 ids ≈ 4,1 KB de URL.
export const MAXIMO_IDS_POR_PETICION = 100

// Peticiones simultáneas: tope para no largar una ráfaga contra el proxy (con 1000 ids son
// 10 lotes → 3 olas de 4). El navegador ya limita a 6 conexiones por host; el tope lo hace explícito.
export const MAXIMA_CONCURRENCIA_PETICIONES = 4

// Parte una lista de ids en lotes de `tamaño`.
export function enLotes<T>(ids: readonly T[], tamaño: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < ids.length; i += tamaño) lotes.push(ids.slice(i, i + tamaño))
  return lotes
}

// Pide los lotes de a olas (como mucho MAXIMA_CONCURRENCIA_PETICIONES a la vez) y devuelve las
// respuestas en el orden de los lotes. Si un lote falla, el error sale y no se sigue con las olas
// siguientes: nunca se devuelve un resultado parcial.
export async function pedirEnOlas<T, R>(lotes: readonly T[][], pedir: (lote: T[]) => Promise<R[]>): Promise<R[]> {
  const respuestas: R[] = []
  for (let i = 0; i < lotes.length; i += MAXIMA_CONCURRENCIA_PETICIONES) {
    const ola = lotes.slice(i, i + MAXIMA_CONCURRENCIA_PETICIONES)
    for (const respuesta of await Promise.all(ola.map(pedir))) respuestas.push(...respuesta)
  }
  return respuestas
}
