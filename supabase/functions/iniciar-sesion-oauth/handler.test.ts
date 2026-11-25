// Pruebas de `iniciar-sesion-oauth` con dependencias simuladas: fijan el comportamiento de la
// función (CORS, método, autenticación, validación del cuerpo, RLS, sesión de Nango nueva y de
// reconexión, fallos de Nango). Corre con `node --test` (`pnpm test:edge:iniciar-sesion-oauth`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type ConexionOauth, type Deps } from './handler.ts'

type Opciones = {
  jwtValido?: boolean
  conexion?: ConexionOauth | null
  nango?: { ok: boolean; cuerpo?: unknown } | 'caido' | 'json-roto'
}

const CONEXION_NUEVA: ConexionOauth = {
  organizacion_id: 'org-1',
  nango_connection_id: null,
  integraciones_oauth: { clave: 'mercadolibre' },
}

function montar(opciones: Opciones = {}) {
  const registro = { jwts: [] as string[], lecturas: [] as [string, string][], pedidos: [] as { url: string; init: RequestInit }[], config: 0 }
  const deps: Deps = {
    validarJwt: async (jwt) => {
      registro.jwts.push(jwt)
      return opciones.jwtValido ?? true
    },
    leerConexion: async (jwt, id) => {
      registro.lecturas.push([jwt, id])
      return opciones.conexion === undefined ? CONEXION_NUEVA : opciones.conexion
    },
    config: () => {
      registro.config++
      return { nangoUrl: 'https://nango.test', nangoSecretKey: 'secreto-nango' }
    },
    fetch: (async (url: string, init: RequestInit) => {
      registro.pedidos.push({ url, init })
      const n = opciones.nango ?? { ok: true, cuerpo: { data: { token: 'tok-1' } } }
      if (n === 'caido') throw new Error('ECONNREFUSED')
      if (n === 'json-roto') return { ok: true, json: async () => { throw new Error('json') } }
      return { ok: n.ok, json: async () => n.cuerpo }
    }) as unknown as typeof fetch,
  }
  return { deps, registro }
}

const pedir = (cuerpo: unknown, { metodo = 'POST', auth = 'Bearer jwt-1' as string | null } = {}) =>
  new Request('https://f.test/iniciar-sesion-oauth', {
    method: metodo,
    headers: auth === null ? {} : { Authorization: auth },
    body: metodo === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  })

describe('iniciar-sesion-oauth', () => {
  it('OPTIONS responde ok con CORS y no toca nada más', async () => {
    const { deps, registro } = montar()
    const r = await manejar(new Request('https://f.test/', { method: 'OPTIONS' }), deps)
    assert.equal(r.status, 200)
    assert.equal(await r.text(), 'ok')
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type')
    assert.deepEqual(registro.jwts, [])
  })

  it('otro método que no sea POST da 400 con CORS', async () => {
    const { deps } = montar()
    const r = await manejar(pedir(null, { metodo: 'GET' }), deps)
    assert.equal(r.status, 400)
    assert.deepEqual(await r.json(), { error: 'Método no soportado, usar POST.' })
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*')
  })

  it('sin Authorization o con Authorization vacío da 403 sin validar nada', async () => {
    for (const auth of [null, '']) {
      const { deps, registro } = montar()
      const r = await manejar(pedir({ conexion_id: 'c1' }, { auth }), deps)
      assert.equal(r.status, 403)
      assert.deepEqual(await r.json(), { error: 'No autorizado' })
      assert.deepEqual(registro.jwts, [])
    }
  })

  it('un JWT inválido da 403 y no lee la conexión', async () => {
    const { deps, registro } = montar({ jwtValido: false })
    const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
    assert.equal(r.status, 403)
    assert.deepEqual(registro.lecturas, [])
  })

  it('el prefijo Bearer se quita sin distinguir mayúsculas', async () => {
    const { deps, registro } = montar()
    await manejar(pedir({ conexion_id: 'c1' }, { auth: 'bearer   jwt-9' }), deps)
    assert.deepEqual(registro.jwts, ['jwt-9'])
    assert.deepEqual(registro.lecturas, [['jwt-9', 'c1']])
  })

  it('un cuerpo que no es JSON da 400', async () => {
    const { deps, registro } = montar()
    const r = await manejar(pedir('no-json'), deps)
    assert.equal(r.status, 400)
    assert.deepEqual(await r.json(), { error: 'Cuerpo inválido: se esperaba JSON.' })
    assert.deepEqual(registro.lecturas, [])
  })

  it('sin conexion_id da 400', async () => {
    const { deps } = montar()
    for (const cuerpo of [{}, { conexion_id: '' }]) {
      const r = await manejar(pedir(cuerpo), deps)
      assert.equal(r.status, 400)
      assert.deepEqual(await r.json(), { error: 'Falta "conexion_id".' })
    }
  })

  it('si RLS no deja ver la conexión da 403 (indistinguible de que no exista)', async () => {
    const { deps, registro } = montar({ conexion: null })
    const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
    assert.equal(r.status, 403)
    assert.deepEqual(await r.json(), { error: 'No autorizado' })
    assert.equal(registro.pedidos.length, 0)
    assert.equal(registro.config, 0)
  })

  it('una conexión sin integración (clave) da 403', async () => {
    for (const integraciones_oauth of [null, {}, { clave: '' }]) {
      const { deps, registro } = montar({ conexion: { ...CONEXION_NUEVA, integraciones_oauth } })
      const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
      assert.equal(r.status, 403)
      assert.equal(registro.pedidos.length, 0)
    }
  })

  it('primera vez: crea una sesión de Nango para la organización y devuelve el token', async () => {
    const { deps, registro } = montar()
    const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { token: 'tok-1', es_reconexion: false })
    assert.equal(r.headers.get('Content-Type'), 'application/json')
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*')
    const { url, init } = registro.pedidos[0]
    assert.equal(url, 'https://nango.test/connect/sessions')
    assert.equal(init.method, 'POST')
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer secreto-nango' })
    assert.deepEqual(JSON.parse(init.body as string), { end_user: { id: 'org-1' }, allowed_integrations: ['mercadolibre'] })
    assert.ok(init.signal)
  })

  it('con nango_connection_id pide una sesión de reconexión sobre esa misma conexión', async () => {
    const { deps, registro } = montar({ conexion: { ...CONEXION_NUEVA, nango_connection_id: 'nango-7' } })
    const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
    assert.deepEqual(await r.json(), { token: 'tok-1', es_reconexion: true })
    const { url, init } = registro.pedidos[0]
    assert.equal(url, 'https://nango.test/connect/sessions/reconnect')
    assert.deepEqual(JSON.parse(init.body as string), { connection_id: 'nango-7', integration_id: 'mercadolibre' })
  })

  it('Nango responde con error, está caído o devuelve basura: 503 sin detalles', async () => {
    for (const nango of [{ ok: false }, 'caido', 'json-roto', { ok: true, cuerpo: {} }] as const) {
      const { deps } = montar({ nango })
      const r = await manejar(pedir({ conexion_id: 'c1' }), deps)
      assert.equal(r.status, 503)
      assert.deepEqual(await r.json(), { error: 'conexion_oauth_no_disponible' })
    }
  })
})
