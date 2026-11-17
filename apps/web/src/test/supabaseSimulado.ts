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
// LÍMITE: filtra solo de forma mínima: `eq(col, valor)`, `in(col, valores)`, `order(col, { ascending })` y `limit(n)`; el resto de
// los métodos (`select`, `or`, `ilike`, `range`, `returns`…) se aceptan y se ignoran. No usarlo para probar filtrado complejo.
// Cada consulta se resuelve con `{ data, error: null, count }`; `rpc` resuelve con lo declarado en `rpc` (o `null`). `schema`
// es un `vi.fn` para poder afirmar qué esquema se pidió. `createSignedUrls` devuelve una entrada por ruta pedida, como el real:
// las rutas no declaradas en `firmadas` vuelven con `error: 'Object not found'` y sin URL.
export type OpcionesClienteSimulado = {
  tablas?: Record<string, unknown[]>
  rpc?: Record<string, unknown>
  /** `ruta → URL firmada` que devuelve `storage.from(bucket).createSignedUrls`. */
  firmadas?: Record<string, string>
}

type Resultado = { data: unknown[]; error: null; count: number }
type Cadena = PromiseLike<Resultado> & { [metodo: string]: (...argumentos: unknown[]) => Cadena }

function cadenaDe(filas: unknown[]): Cadena {
  const resultado: Resultado = { data: filas, error: null, count: filas.length }
  const valor = (fila: unknown, columna: string) => (fila as Record<string, unknown>)[columna]
  const cadena = new Proxy(
    {},
    {
      get(_, propiedad) {
        if (propiedad === 'then') return (resolver: (valor: unknown) => unknown) => Promise.resolve(resultado).then(resolver)
        if (propiedad === 'maybeSingle' || propiedad === 'single') return () => Promise.resolve({ data: filas[0] ?? null, error: null })
        if (propiedad === 'eq') return (columna: string, esperado: unknown) => cadenaDe(filas.filter((fila) => valor(fila, columna) === esperado))
        if (propiedad === 'in') return (columna: string, esperados: unknown[]) => cadenaDe(filas.filter((fila) => esperados.includes(valor(fila, columna))))
        if (propiedad === 'limit') return (maximo: number) => cadenaDe(filas.slice(0, maximo))
        if (propiedad === 'order')
          return (columna: string, opciones?: { ascending?: boolean }) => {
            const signo = opciones?.ascending === false ? -1 : 1
            return cadenaDe([...filas].sort((a, b) => signo * (String(valor(a, columna)) < String(valor(b, columna)) ? -1 : String(valor(a, columna)) > String(valor(b, columna)) ? 1 : 0)))
          }
        return () => cadena
      },
    },
  ) as Cadena
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
      from: vi.fn((_bucket?: string) => ({
        createSignedUrls: vi.fn(async (rutas: string[]) => ({
          data: rutas.map((ruta) =>
            ruta in firmadas ? { path: ruta, signedUrl: firmadas[ruta], error: null } : { path: ruta, signedUrl: '', error: 'Object not found' },
          ),
          error: null,
        })),
      })),
    },
  }
}
