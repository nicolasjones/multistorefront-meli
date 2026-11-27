// Pruebas de `cableado.ts` (MSF-980): armado de las dependencias con el cliente y el entorno inyectados. Corre con `node --test`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { armarDepsDesdeEntorno } from './cableado.ts'
import { manejar } from './handler.ts'

const TOKEN = 'a'.repeat(64)
const entorno = (valores: Record<string, string>) => (clave: string) => Object.hasOwn(valores, clave) ? valores[clave] : undefined
const completo = { SUPABASE_URL: 'https://proyecto.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'clave-de-servicio' }

function cliente(responder: (nombre: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const llamadas: [string, Record<string, unknown>][] = []
  const credenciales: string[][] = []
  return {
    llamadas,
    credenciales,
    crearCliente: (url: string, clave: string) => {
      credenciales.push([url, clave])
      return { rpc: async (nombre: string, args: Record<string, unknown>) => { llamadas.push([nombre, args]); return responder(nombre, args) } }
    },
  }
}
const pedido = (xff = '10.2.3.4') => new Request('http://localhost/baja-correo-masivo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ token: TOKEN }) })
const silenciar = async <T>(f: () => Promise<T> | T): Promise<T> => {
  const original = console.error
  console.error = () => {}
  try { return await f() } finally { console.error = original }
}

describe('armarDepsDesdeEntorno', () => {
  it('con entorno completo crea el cliente con la URL y la clave de servicio y arma cupo y baja sobre la misma RPC', async () => {
    const c = cliente((nombre) => nombre === 'consumir_cupo_baja_correo' ? { data: [{ se_consumio: true, segundos_hasta_reinicio: 10 }], error: null } : { data: true, error: null })
    const deps = armarDepsDesdeEntorno({ env: entorno(completo), crearCliente: c.crearCliente })
    const res = await manejar(pedido(), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(c.credenciales, [['https://proyecto.supabase.co', 'clave-de-servicio']])
    assert.deepEqual(c.llamadas.map(([nombre]) => nombre), ['consumir_cupo_baja_correo', 'dar_de_baja_correo_masivo'])
    assert.deepEqual(c.llamadas[0][1], { p_ip: '10.2.3.4' })
  })

  it('BAJA_PROXY_SALTOS se lee del entorno (con 1 salto se toma el valor anterior al último)', async () => {
    const c = cliente(() => ({ data: [{ se_consumio: true }], error: null }))
    const deps = armarDepsDesdeEntorno({ env: entorno({ ...completo, BAJA_PROXY_SALTOS: '1' }), crearCliente: c.crearCliente })
    assert.equal(deps.saltosProxy, 1)
    await manejar(pedido('1.1.1.1, 2.2.2.2'), deps)
    assert.deepEqual(c.llamadas[0][1], { p_ip: '1.1.1.1' })
  })

  it('un valor inválido de BAJA_PROXY_SALTOS vale 0', () => {
    const c = cliente(() => ({ data: null, error: null }))
    assert.equal(armarDepsDesdeEntorno({ env: entorno({ ...completo, BAJA_PROXY_SALTOS: 'mucho' }), crearCliente: c.crearCliente }).saltosProxy, 0)
  })

  it('sin la URL o sin la clave de servicio responde 503, no da de baja y ni siquiera crea el cliente (cada variable por separado)', async () => {
    for (const faltante of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      const c = cliente(() => ({ data: true, error: null }))
      const valores = { ...completo } as Record<string, string>
      delete valores[faltante]
      const deps = armarDepsDesdeEntorno({ env: entorno(valores), crearCliente: c.crearCliente })
      const res = await silenciar(() => manejar(pedido(), deps))
      assert.equal(res.status, 503, faltante)
      assert.deepEqual(c.llamadas, [], faltante)
      assert.deepEqual(c.credenciales, [], faltante)
    }
  })

  it('si crear el cliente lanza también falla cerrado con 503', async () => {
    const deps = armarDepsDesdeEntorno({ env: entorno(completo), crearCliente: () => { throw new Error('url inválida') } })
    const res = await silenciar(() => manejar(pedido(), deps))
    assert.equal(res.status, 503)
  })

  it('un cupo agotado responde 429 con Retry-After a través del cableado', async () => {
    const c = cliente(() => ({ data: [{ se_consumio: false, segundos_hasta_reinicio: 777 }], error: null }))
    const res = await manejar(pedido(), armarDepsDesdeEntorno({ env: entorno(completo), crearCliente: c.crearCliente }))
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('retry-after'), '777')
    assert.deepEqual(c.llamadas.map(([nombre]) => nombre), ['consumir_cupo_baja_correo'])
  })
})
