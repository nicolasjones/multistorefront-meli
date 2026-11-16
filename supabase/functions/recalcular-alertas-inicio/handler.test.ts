// Pruebas de `recalcular-alertas-inicio` con la base simulada. Corre con `node --test`
// (`pnpm test:edge:recalcular-alertas-inicio`); handler.ts no importa nada de Deno.
// Verifica FR-022: el token protege la función, el barrido recalcula cada organización y un fallo no frena a las demás.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, procesarOrganizacion, type Deps } from './handler.ts'

const ORG_1 = '11111111-1111-4111-8111-111111111111'
const ORG_2 = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'secreto-de-prueba'

type Opciones = {
  organizaciones?: string[]
  organizacionesError?: boolean
  fallan?: string[]
  token?: string | undefined
}

function armar(opciones: Opciones = {}) {
  const llamadas: string[] = []
  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    datos: {
      organizaciones: async () =>
        opciones.organizacionesError
          ? { data: null, error: { message: 'boom' } }
          : { data: opciones.organizaciones ?? [ORG_1, ORG_2], error: null },
      recalcular: async (organizacion) => {
        llamadas.push(organizacion)
        return opciones.fallan?.includes(organizacion)
          ? { data: null, error: { message: 'falló' } }
          : { data: { alertas: 3, calculada_en: '2027-01-15T12:00:00Z' }, error: null }
      },
    },
  }
  return { deps, llamadas }
}

const pedido = (cuerpo: unknown, token: string | null = TOKEN, metodo = 'POST') =>
  new Request('http://localhost/recalcular-alertas-inicio', {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-aviso-token': token } : {}) },
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  })

describe('recalcular-alertas-inicio', () => {
  it('rechaza un método que no es POST', async () => {
    const { deps } = armar()
    assert.equal((await manejar(pedido(null, TOKEN, 'GET'), deps)).status, 405)
  })

  it('responde 503 si falta el secreto configurado', async () => {
    const { deps, llamadas } = armar({ token: undefined })
    assert.equal((await manejar(pedido({ barrer: true }), deps)).status, 503)
    assert.equal(llamadas.length, 0)
  })

  it('responde 403 sin token o con un token incorrecto y no recalcula nada', async () => {
    const { deps, llamadas } = armar()
    assert.equal((await manejar(pedido({ barrer: true }, null), deps)).status, 403)
    assert.equal((await manejar(pedido({ barrer: true }, 'otro'), deps)).status, 403)
    assert.equal(llamadas.length, 0)
  })

  it('responde 400 si el pedido no es {"barrer": true}', async () => {
    const { deps, llamadas } = armar()
    assert.equal((await manejar(pedido({ organizacion_id: ORG_1 }), deps)).status, 400)
    assert.equal(llamadas.length, 0)
  })

  it('el barrido recalcula cada organización y resume el resultado', async () => {
    const { deps, llamadas } = armar()
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(llamadas, [ORG_1, ORG_2])
    assert.deepEqual(await res.json(), { organizaciones: 2, calculadas: 2, alertas: 6, errores: 0 })
  })

  it('un error en una organización no frena a las demás y responde 502 para que Kestra reintente', async () => {
    const { deps, llamadas } = armar({ fallan: [ORG_1] })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 502)
    assert.deepEqual(llamadas, [ORG_1, ORG_2])
    assert.deepEqual(await res.json(), { organizaciones: 2, calculadas: 1, alertas: 3, errores: 1 })
  })

  it('responde 502 si no se pueden listar las organizaciones', async () => {
    const { deps } = armar({ organizacionesError: true })
    assert.equal((await manejar(pedido({ barrer: true }), deps)).status, 502)
  })

  it('sin organizaciones responde 200 con todo en cero', async () => {
    const { deps } = armar({ organizaciones: [] })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { organizaciones: 0, calculadas: 0, alertas: 0, errores: 0 })
  })

  it('procesarOrganizacion falla si la base devuelve error', async () => {
    const { deps } = armar({ fallan: [ORG_1] })
    await assert.rejects(procesarOrganizacion(ORG_1, deps), /No se pudo recalcular/)
  })
})
