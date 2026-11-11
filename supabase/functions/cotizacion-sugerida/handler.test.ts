// Pruebas de `cotizacion-sugerida` con clientes simulados. Corre con `node --test`
// (`pnpm test:edge:cotizacion-sugerida`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FUENTE_NOMBRE, leerSugerencia, manejar, VALOR_MAXIMO, type Deps } from './handler.ts'

type Opciones = { nivel?: string | null; nivelError?: boolean; fuente?: unknown; fuenteCae?: boolean }

function montar(opciones: Opciones = {}) {
  let consultas = 0
  const deps: Deps = {
    getUser: async (jwt) => jwt === 'valido' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'x' } },
    caller: () => ({
      nivelCotizacion: async () => opciones.nivelError ? { data: null, error: { message: 'boom' } } : { data: opciones.nivel === undefined ? 'edicion' : opciones.nivel, error: null },
    }),
    leerFuente: async () => {
      consultas += 1
      if (opciones.fuenteCae) throw new Error('timeout')
      return opciones.fuente === undefined ? { venta: 1405.5, fechaActualizacion: '2026-11-10T15:00:00.000Z' } : opciones.fuente
    },
  }
  return { deps, consultas: () => consultas }
}

const pedir = (deps: Deps, jwt: string | null = 'valido', method = 'POST') =>
  manejar(new Request('http://x/', { method, headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }), deps)

describe('cotizacion-sugerida', () => {
  it('devuelve el valor sugerido, la fuente y la fecha', async () => {
    const { deps } = montar()
    const res = await pedir(deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { valor: 1405.5, fuente: FUENTE_NOMBRE, fecha: '2026-11-10T15:00:00.000Z' })
  })

  it('redondea a dos decimales y tolera una fecha ausente', async () => {
    const { deps } = montar({ fuente: { venta: 1405.5678 } })
    assert.deepEqual(await (await pedir(deps)).json(), { valor: 1405.57, fuente: FUENTE_NOMBRE, fecha: null })
  })

  it('sin sesión o con token inválido: 403 y no consulta la fuente', async () => {
    const { deps, consultas } = montar()
    assert.equal((await pedir(deps, null)).status, 403)
    assert.equal((await pedir(deps, 'roto')).status, 403)
    assert.equal(consultas(), 0)
  })

  it('sin permiso de edición del dólar: 403 y no consulta la fuente', async () => {
    for (const nivel of ['lectura', 'ninguno', null]) {
      const { deps, consultas } = montar({ nivel })
      assert.equal((await pedir(deps)).status, 403)
      assert.equal(consultas(), 0)
    }
  })

  it('si no puede resolver el permiso: 502 y no consulta la fuente', async () => {
    const { deps, consultas } = montar({ nivelError: true })
    assert.equal((await pedir(deps)).status, 502)
    assert.equal(consultas(), 0)
  })

  it('fuente caída: 502 con mensaje que invita a cargar a mano', async () => {
    const { deps } = montar({ fuenteCae: true })
    const res = await pedir(deps)
    assert.equal(res.status, 502)
    assert.match((await res.json() as { error: string }).error, /a mano/)
  })

  it('respuesta inválida de la fuente: 502', async () => {
    for (const fuente of [null, 'texto', {}, { venta: '1405' }, { venta: 0 }, { venta: 0.001 }, { venta: -3 }, { venta: Number.NaN }, { venta: VALOR_MAXIMO }]) {
      const { deps } = montar({ fuente })
      assert.equal((await pedir(deps)).status, 502, JSON.stringify(fuente))
    }
  })

  it('solo admite POST (y responde el preflight)', async () => {
    const { deps } = montar()
    assert.equal((await pedir(deps, 'valido', 'GET')).status, 405)
    assert.equal((await pedir(deps, null, 'OPTIONS')).status, 200)
  })

  it('leerSugerencia ignora una fecha ilegible', () => {
    assert.deepEqual(leerSugerencia({ venta: 10, fechaActualizacion: 'ayer' }), { valor: 10, fuente: FUENTE_NOMBRE, fecha: null })
  })
})
