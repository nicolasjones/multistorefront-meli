import { vi } from 'vitest'

// Cliente de Supabase simulado para los tests de la web. Implementa `.schema(nombre)` (como el cliente real: devuelve un
// cliente con `from`/`rpc` acotado al esquema), así el código que consulta `dominio`/`publico` no cae en
// «cliente.schema is not a function», un error que la mayoría de las pantallas atrapa y deja pasar el test por el camino
// de error en vez de por el camino feliz.
//
// Uso típico:
//   vi.mock('../lib/supabase', () => ({ supabaseClient: clienteSupabaseSimulado({ tablas: { producto_imagenes: [...] } }) }))
// (si el mock se declara con `vi.hoisted`/`vi.mock`, importá este módulo con `await import` dentro de la fábrica).
//
// `tablas` es `tabla → filas` (o `esquema.tabla → filas`, que gana sobre la forma corta); lo no declarado devuelve `[]`.
// Cada consulta es una cadena que acepta cualquier método (`select`, `eq`, `in`, `order`, `returns`…) y se resuelve con
// `{ data, error: null }`; `rpc` resuelve con lo declarado en `rpc` (o `null`). `schema` es un `vi.fn` para poder
// afirmar qué esquema se pidió.
export type OpcionesClienteSimulado = {
  tablas?: Record<string, unknown[]>
  rpc?: Record<string, unknown>
  /** `ruta → URL firmada` que devuelve `storage.from(bucket).createSignedUrls`. */
  firmadas?: Record<string, string>
}

type Cadena = Record<string, unknown>

function cadenaDe(filas: unknown[]): Cadena {
  const resultado = { data: filas, error: null, count: filas.length }
  const cadena: Cadena = new Proxy(
    {},
    {
      get(_, propiedad) {
        if (propiedad === 'then') return (resolver: (valor: unknown) => unknown) => Promise.resolve(resultado).then(resolver)
        if (propiedad === 'maybeSingle' || propiedad === 'single') return () => Promise.resolve({ data: filas[0] ?? null, error: null })
        return () => cadena
      },
    },
  )
  return cadena
}

export function clienteSupabaseSimulado({ tablas = {}, rpc = {}, firmadas = {} }: OpcionesClienteSimulado = {}) {
  const construir = (esquema: string) => ({
    from: vi.fn((tabla: string) => cadenaDe(tablas[`${esquema}.${tabla}`] ?? tablas[tabla] ?? [])),
    rpc: vi.fn(async (nombre: string) => ({ data: rpc[nombre] ?? null, error: null })),
  })
  const publico = construir('public')
  const porEsquema = new Map<string, ReturnType<typeof construir>>()
  return {
    ...publico,
    schema: vi.fn((nombre: string) => {
      if (!porEsquema.has(nombre)) porEsquema.set(nombre, construir(nombre))
      return porEsquema.get(nombre)!
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: vi.fn(async (rutas: string[]) => ({
          data: rutas.filter((ruta) => ruta in firmadas).map((ruta) => ({ path: ruta, signedUrl: firmadas[ruta], error: null })),
          error: null,
        })),
      })),
    },
  }
}
