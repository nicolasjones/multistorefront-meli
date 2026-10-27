// Pruebas de `emitir-acceso-reporte` (spec 007 + F-REN-01, FR-007/SC-003; + filtro por empresa de
// F-VTA-22, FR-004) con dependencias simuladas: sin sección (la RPC devuelve null) → 403 y NO se pide
// nada a Superset; con sección → token cuya cláusula `rls` fuerza `organizacion_id` y acota a las
// empresas accesibles del usuario; Superset caído → 503. Corre con `node --test`
// (`pnpm test:edge:emitir-acceso-reporte`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMPRESA_A = '11111111-1111-1111-1111-111111111111'
const EMPRESA_B = '22222222-2222-2222-2222-222222222222'
const DASHBOARD = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

type Opciones = {
  organizacion?: string | null
  empresas?: string[] | null
  empresasFallan?: boolean
  jwtValido?: boolean
  dashboard?: string | null
  supersetLogin?: boolean
  supersetToken?: boolean
}

function montar(opciones: Opciones = {}) {
  const {
    organizacion = ORG_A,
    empresas = [EMPRESA_A, EMPRESA_B],
    jwtValido = true,
    dashboard = DASHBOARD,
  } = opciones
  const llamadas = {
    resolver: [] as string[],
    empresas: 0,
    superset: [] as { url: string; body: unknown }[],
  }
  const deps: Deps = {
    validarJwt: async () => jwtValido,
    resolverOrganizacion: async (_jwt, reporteId) => {
      llamadas.resolver.push(reporteId)
      return organizacion
    },
    empresasAccesibles: async () => {
      llamadas.empresas += 1
      if (opciones.empresasFallan) throw new Error('no se pudo resolver el alcance')
      return empresas ?? []
    },
    dashboardUuid: async () => dashboard,
    config: {
      supersetUrl: 'http://superset',
      supersetPublicUrl: 'https://superset.publico',
      username: 'guest-token-service',
      password: 'x',
    },
    fetch: (async (url: string, init?: RequestInit) => {
      llamadas.superset.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.endsWith('/login')) {
        return Response.json({ access_token: 'acceso' }, { status: opciones.supersetLogin === false ? 500 : 200 })
      }
      return Response.json({ token: 'guest-jwt' }, { status: opciones.supersetToken === false ? 500 : 200 })
    }) as typeof fetch,
  }
  return { deps, llamadas }
}

const pedir = (cuerpo: unknown = { reporte_id: 'rep-1' }, encabezados: Record<string, string> = {}) =>
  new Request('http://localhost/emitir-acceso-reporte', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt', ...encabezados },
    body: JSON.stringify(cuerpo),
  })

const clausulaEmitida = (llamadas: { superset: { url: string; body: unknown }[] }) => {
  const emision = llamadas.superset.find((l) => l.url.endsWith('/guest_token/'))
  const rls = (emision?.body as { rls: { clause: string }[] }).rls
  assert.equal(rls.length, 1, 'la cláusula rls es un único texto SQL')
  return rls[0].clause
}

describe('emitir-acceso-reporte', () => {
  it('403 sin emitir token cuando el usuario no tiene la sección del reporte (la RPC devuelve null)', async () => {
    const { deps, llamadas } = montar({ organizacion: null })
    const res = await manejar(pedir(), deps)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'No autorizado' })
    assert.equal(llamadas.superset.length, 0, 'no se debe tocar Superset sin autorización')
  })

  it('403 sin JWT o con JWT inválido, sin consultar la RPC', async () => {
    const sinJwt = montar()
    const r1 = await manejar(new Request('http://localhost/x', { method: 'POST', body: '{}' }), sinJwt.deps)
    assert.equal(r1.status, 403)
    const invalido = montar({ jwtValido: false })
    const r2 = await manejar(pedir(), invalido.deps)
    assert.equal(r2.status, 403)
    assert.equal(invalido.llamadas.resolver.length, 0)
  })

  it('con sección permitida emite el token y la cláusula rls fuerza la organización de la RPC', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedir(), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      guest_token: 'guest-jwt',
      superset_url: 'https://superset.publico',
      dashboard_uuid: DASHBOARD,
    })
    assert.match(
      clausulaEmitida(llamadas),
      new RegExp(`^organizacion_id = '${ORG_A}' AND empresa_id IN `),
      'la cláusula acota organización y empresas',
    )
    assert.deepEqual((llamadas.superset.find((l) => l.url.endsWith('/guest_token/'))?.body as { resources: unknown }).resources, [
      { type: 'dashboard', id: DASHBOARD },
    ])
  })

  it('FR-004: la cláusula rls acota el token a las empresas accesibles del usuario', async () => {
    const { deps, llamadas } = montar({ empresas: [EMPRESA_A, EMPRESA_B] })
    await manejar(pedir(), deps)
    assert.equal(
      clausulaEmitida(llamadas),
      `organizacion_id = '${ORG_A}' AND empresa_id IN ('${EMPRESA_A}', '${EMPRESA_B}')`,
    )
  })

  it('descarta los identificadores que no son UUID: al clause nunca lleva texto libre', async () => {
    const { deps, llamadas } = montar({ empresas: ["x' or '1'='1", EMPRESA_A, 'no-es-un-uuid'] })
    await manejar(pedir(), deps)
    const clause = clausulaEmitida(llamadas)
    assert.equal(clause, `organizacion_id = '${ORG_A}' AND empresa_id IN ('${EMPRESA_A}')`)
    assert.equal(clause.includes("x'"), false, 'no se interpola texto libre')
    assert.equal(clause.includes('no-es-un-uuid'), false)
  })

  it('sin empresas accesibles la cláusula no deja pasar filas (no emite un token sin filtro)', async () => {
    const { deps, llamadas } = montar({ empresas: [] })
    const res = await manejar(pedir(), deps)
    assert.equal(res.status, 200)
    assert.equal(clausulaEmitida(llamadas), `organizacion_id = '${ORG_A}' AND false`)
  })

  it('503 y sin tocar Superset si no se pueden resolver las empresas accesibles (falla cerrado)', async () => {
    const { deps, llamadas } = montar({ empresasFallan: true })
    const res = await manejar(pedir(), deps)
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'alcance_no_resuelto' })
    assert.equal(llamadas.superset.length, 0, 'sin el filtro por empresa no se emite token')
  })

  it('no resuelve las empresas accesibles si el usuario no tiene acceso al reporte', async () => {
    const { deps, llamadas } = montar({ organizacion: null })
    await manejar(pedir(), deps)
    assert.equal(llamadas.empresas, 0)
  })

  it('la organización del cuerpo no se usa: solo la que resuelve la RPC (B nunca aparece)', async () => {
    const { deps, llamadas } = montar()
    await manejar(pedir({ reporte_id: 'rep-1', organizacion_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }), deps)
    const emision = llamadas.superset.find((l) => l.url.endsWith('/guest_token/'))
    assert.equal(JSON.stringify(emision?.body).includes('bbbbbbbb'), false)
  })

  it('la empresa del cuerpo no se usa: solo las empresas accesibles del usuario', async () => {
    const { deps, llamadas } = montar({ empresas: [EMPRESA_A] })
    await manejar(
      pedir({ reporte_id: 'rep-1', empresa_id: '33333333-3333-3333-3333-333333333333' }),
      deps,
    )
    assert.equal(clausulaEmitida(llamadas).includes('33333333'), false)
  })

  it('rechaza una organización que no sea UUID antes de armar la cláusula rls', async () => {
    const { deps, llamadas } = montar({ organizacion: "x' or '1'='1" })
    const res = await manejar(pedir(), deps)
    assert.equal(res.status, 403)
    assert.equal(llamadas.superset.length, 0)
  })

  it('403 si el reporte no es visible para el usuario (sin dashboard)', async () => {
    const { deps } = montar({ dashboard: null })
    assert.equal((await manejar(pedir(), deps)).status, 403)
  })

  it('503 analitica_no_disponible si Superset falla al iniciar sesión o al emitir', async () => {
    for (const opciones of [{ supersetLogin: false }, { supersetToken: false }]) {
      const res = await manejar(pedir(), montar(opciones).deps)
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { error: 'analitica_no_disponible' })
    }
  })

  it('400 con método distinto de POST, cuerpo no JSON o sin reporte_id', async () => {
    const { deps } = montar()
    assert.equal((await manejar(new Request('http://localhost/x', { method: 'GET' }), deps)).status, 400)
    const noJson = new Request('http://localhost/x', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: 'no-json' })
    assert.equal((await manejar(noJson, deps)).status, 400)
    assert.equal((await manejar(pedir({}), deps)).status, 400)
  })
})
