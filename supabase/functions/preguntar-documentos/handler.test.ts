// Pruebas de `preguntar-documentos` con dependencias simuladas: fijan el comportamiento de la función (CORS, método,
// autenticación, validación, funcionalidad, límite por usuario, política, credencial, proveedor, embeddings, búsqueda,
// citas y timeout). Corre con `node --test` (`pnpm test:edge:preguntar-documentos`).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'
import { crearLimitador, enteroPositivo } from '../_shared/limite-memoria.ts'
import { fetchConTimeout } from '../_shared/fetch-ia.ts'

const AHORA = Date.UTC(2027, 0, 1, 12, 0, 0)
const SIN_INFO = 'No encontré información relevante en los documentos para responder eso.'
const ERROR_PROVEEDOR = 'No pude obtener una respuesta del proveedor de IA, probá de nuevo.'

type Res = { data: unknown; error: unknown }
type Opciones = {
  jwtValido?: boolean
  feature?: Res
  politica?: Res
  credencial?: Res
  proveedor?: string
  limiteSegundos?: unknown
  prepararError?: Error
  embeddingError?: Error
  busqueda?: Res
  versiones?: Res
  respuestas?: Array<unknown | Error | { ok: false; status: number }>
  limiteMax?: number
  fetchBase?: (url: string, init: { signal?: AbortSignal }) => Promise<unknown>
}

const fragmento = (version_id: string, texto: string) => ({ version_id, texto })

function montar(o: Opciones = {}) {
  const r = {
    admins: 0, jwts: [] as string[], clientes: [] as string[],
    rpcAdmin: [] as [string, unknown][], rpcUsuario: [] as [string, unknown][],
    tablas: [] as { tabla: string; ops: unknown[][] }[],
    prepararLlamadas: [] as unknown[][], embeddings: [] as [string, string][],
    segundos: [] as number[], pedidos: [] as { url: string; init: { headers: Record<string, string>; body: string } }[],
  }
  const cola = [...(o.respuestas ?? [])]
  const politicaBase = { politica_id: 'p1', contrato_id: 'c1', perfil_principal_id: 'perfil-1', limite_intentos: 1, limite_segundos: o.limiteSegundos ?? 60, perfil_fallback_id: null }
  const deps: Deps = {
    crearAdmin: () => {
      r.admins++
      return {
        auth: { getUser: async (jwt: string) => { r.jwts.push(jwt); return o.jwtValido === false ? { data: null, error: { message: 'jwt' } } : { data: { user: { id: 'u1' } }, error: null } } },
        rpc: async (nombre: string, args: Record<string, unknown>) => {
          r.rpcAdmin.push([nombre, args])
          if (nombre === 'resolver_politica_ia') return o.politica ?? { data: [politicaBase], error: null }
          return o.credencial ?? { data: [{ clave: 'clave-proveedor-secreta', proveedor_codigo: o.proveedor ?? 'openai', modelo_id: 'modelo-x' }], error: null }
        },
      }
    },
    crearCliente: (jwt) => {
      r.clientes.push(jwt)
      return {
        rpc: async (nombre: string, args: Record<string, unknown>) => {
          r.rpcUsuario.push([nombre, args])
          if (nombre === 'tiene_feature_publica') return o.feature ?? { data: true, error: null }
          return o.busqueda ?? { data: [fragmento('v1', 'El plazo es de 5 días.')], error: null }
        },
        from: (tabla: string) => {
          const ops: unknown[][] = []
          r.tablas.push({ tabla, ops })
          const q: Record<string, unknown> = {}
          for (const m of ['select', 'in']) q[m] = (...a: unknown[]) => { ops.push([m, ...a]); return q }
          q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(o.versiones ?? { data: [{ id: 'v1', documento_id: 'doc-1' }], error: null }).then(ok, ko)
          return q
        },
      }
    },
    prepararInvocacion: ((...a: unknown[]) => {
      r.prepararLlamadas.push(a)
      if (o.prepararError) throw o.prepararError
      return { pregunta: (a[2] as { pregunta: string }).pregunta }
    }) as Deps['prepararInvocacion'],
    generarEmbedding: async (texto, clave) => {
      r.embeddings.push([texto, clave])
      if (o.embeddingError) throw o.embeddingError
      return [0.1, 0.2]
    },
    fetchProveedor: (segundos) => {
      r.segundos.push(segundos)
      return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
        r.pedidos.push({ url, init })
        const sig = cola.shift()
        if (sig instanceof Error) throw sig
        if (sig && typeof sig === 'object' && 'ok' in sig && (sig as { ok: boolean }).ok === false) return { ok: false, status: (sig as { status: number }).status, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => sig }
      }) as ReturnType<Deps['fetchProveedor']>
    },
    limitador: crearLimitador({ max: o.limiteMax ?? 30, ventanaMs: 3_600_000, ahora: () => AHORA }),
    ahora: () => AHORA,
  }
  return { deps, r }
}

const pedir = (cuerpo: unknown, { metodo = 'POST', auth = 'Bearer jwt-1' as string | null } = {}) =>
  new Request('https://f.test/preguntar-documentos', {
    method: metodo,
    headers: auth === null ? {} : { Authorization: auth },
    body: metodo === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  })

const textoOpenAI = (content: string | null | undefined) => ({ choices: [{ message: { content } }] })
const llamar = async (opciones: Opciones, cuerpo: unknown = { pregunta: '¿Cuál es el plazo?' }, req?: Request) => {
  const { deps, r } = montar(opciones)
  const res = await manejar(req ?? pedir(cuerpo), deps)
  return { res, r, json: await res.clone().json().catch(() => null) as Record<string, unknown> | null }
}
const cuerpoProveedor = (r: ReturnType<typeof montar>['r'], n = 0) => JSON.parse(r.pedidos[n].init.body)

let errores: unknown[][]
let original: typeof console.error
beforeEach(() => { errores = []; original = console.error; console.error = (...a: unknown[]) => { errores.push(a) } })
afterEach(() => { console.error = original })

describe('CORS, método y autenticación', () => {
  it('OPTIONS responde ok con CORS y sin tocar clientes', async () => {
    const { deps, r } = montar()
    const res = await manejar(pedir(undefined, { metodo: 'OPTIONS' }), deps)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'ok')
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type')
    assert.equal(r.admins, 0)
  })

  it('un método distinto de POST responde 400 sin crear clientes', async () => {
    for (const metodo of ['GET', 'PUT', 'DELETE']) {
      const { deps, r } = montar()
      const res = await manejar(pedir(undefined, { metodo }), deps)
      assert.equal(res.status, 400)
      assert.deepEqual(await res.json(), { error: 'Método no soportado, usar POST.' })
      assert.equal(r.admins, 0)
    }
  })

  it('sin Authorization (o vacío) responde 403 sin validar JWT; las respuestas llevan CORS y JSON', async () => {
    for (const auth of [null, '']) {
      const { res, r, json } = await llamar({}, { pregunta: 'hola' }, pedir({ pregunta: 'hola' }, { auth }))
      assert.equal(res.status, 403)
      assert.deepEqual(json, { error: 'No autorizado' })
      assert.deepEqual(r.jwts, [])
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
      assert.equal(res.headers.get('Content-Type'), 'application/json')
    }
  })

  it('JWT inválido responde 403 y no llega a la funcionalidad ni al proveedor', async () => {
    const { res, r, json } = await llamar({ jwtValido: false })
    assert.equal(res.status, 403)
    assert.deepEqual(json, { error: 'No autorizado' })
    assert.deepEqual(r.jwts, ['jwt-1'])
    assert.deepEqual(r.clientes, [])
    assert.equal(r.pedidos.length, 0)
  })

  it('quita el prefijo Bearer sin distinguir mayúsculas', async () => {
    const { r } = await llamar({}, { pregunta: 'hola' }, pedir({ pregunta: 'hola' }, { auth: 'bearer abc.def' }))
    assert.deepEqual(r.jwts, ['abc.def'])
    assert.deepEqual(r.clientes, ['abc.def'])
  })
})

describe('validación del cuerpo', () => {
  it('JSON roto responde 400', async () => {
    const { res, json, r } = await llamar({}, '{no es json')
    assert.equal(res.status, 400)
    assert.deepEqual(json, { error: 'Cuerpo inválido: se esperaba JSON.' })
    assert.deepEqual(r.clientes, [])
  })

  it('pregunta ausente, no texto, vacía o solo espacios responde 400', async () => {
    for (const cuerpo of [{}, null, { pregunta: 5 }, { pregunta: '' }, { pregunta: '   \n' }]) {
      const { res, json, r } = await llamar({}, cuerpo)
      assert.equal(res.status, 400, JSON.stringify(cuerpo))
      assert.deepEqual(json, { error: 'Falta "pregunta".' })
      assert.equal(r.rpcUsuario.length, 0)
    }
  })

  it('admite 2000 caracteres y rechaza 2001 con 400 antes de verificar la funcionalidad', async () => {
    const largo = await llamar({}, { pregunta: 'a'.repeat(2001) })
    assert.equal(largo.res.status, 400)
    assert.deepEqual(largo.json, { error: 'La pregunta admite hasta 2000 caracteres.' })
    assert.equal(largo.r.rpcUsuario.length, 0)
    const justo = await llamar({ respuestas: [textoOpenAI('ok')] }, { pregunta: 'a'.repeat(2000) })
    assert.equal(justo.res.status, 200)
  })
})

describe('funcionalidad y límite por usuario (antes de gastar crédito)', () => {
  it('verifica tiene_feature_publica(busqueda-documental) con el cliente del usuario', async () => {
    const { r } = await llamar({ respuestas: [textoOpenAI('ok')] })
    assert.deepEqual(r.rpcUsuario[0], ['tiene_feature_publica', { p_feature_id: 'busqueda-documental' }])
  })

  it('funcionalidad apagada (false/null) responde 403 sin política, embedding ni proveedor', async () => {
    for (const data of [false, null]) {
      const { res, json, r } = await llamar({ feature: { data, error: null } })
      assert.equal(res.status, 403)
      assert.deepEqual(json, { error: 'La búsqueda documental no está habilitada para tu organización.' })
      assert.deepEqual(r.rpcAdmin, [])
      assert.deepEqual(r.embeddings, [])
      assert.equal(r.pedidos.length, 0)
    }
  })

  it('error al verificar la funcionalidad responde 503, lo registra y no deja pasar', async () => {
    const { res, json, r } = await llamar({ feature: { data: true, error: { message: 'boom' } } })
    assert.equal(res.status, 503)
    assert.deepEqual(json, { error: 'No se pudo verificar la funcionalidad de búsqueda documental.' })
    assert.deepEqual(errores[0], ['preguntar-documentos: no se pudo verificar la funcionalidad', 'boom'])
    assert.deepEqual(r.rpcAdmin, [])
    assert.deepEqual(r.embeddings, [])
  })

  it('supera el límite por usuario: 429 sin gastar crédito; el límite cuenta solo preguntas que pasaron la funcionalidad', async () => {
    const { deps, r } = montar({ limiteMax: 2, respuestas: [textoOpenAI('a'), textoOpenAI('b'), textoOpenAI('c')] })
    assert.equal((await manejar(pedir({ pregunta: 'uno' }), deps)).status, 200)
    assert.equal((await manejar(pedir({ pregunta: 'dos' }), deps)).status, 200)
    const tercera = await manejar(pedir({ pregunta: 'tres' }), deps)
    assert.equal(tercera.status, 429)
    assert.deepEqual(await tercera.json(), { error: 'Hiciste demasiadas preguntas en poco tiempo. Probá de nuevo más tarde.' })
    assert.equal(r.embeddings.length, 2)
    assert.equal(r.pedidos.length, 2)
  })

  it('el cupo es por usuario: A agota el suyo (429) y B sigue pudiendo preguntar (y al revés)', async () => {
    const { deps } = montar({ limiteMax: 1, respuestas: [textoOpenAI('a'), textoOpenAI('b'), textoOpenAI('c')] })
    let usuario = 'A'
    const getUser = deps.crearAdmin().auth.getUser
    deps.crearAdmin = () => ({ ...montar().deps.crearAdmin(), auth: { getUser: async (jwt: string) => ({ ...(await getUser(jwt)), data: { user: { id: usuario } } }) } })
    assert.equal((await manejar(pedir({ pregunta: 'uno' }), deps)).status, 200)
    assert.equal((await manejar(pedir({ pregunta: 'dos' }), deps)).status, 429)
    usuario = 'B'
    assert.equal((await manejar(pedir({ pregunta: 'tres' }), deps)).status, 200)
    assert.equal((await manejar(pedir({ pregunta: 'cuatro' }), deps)).status, 429)
    usuario = 'A'
    assert.equal((await manejar(pedir({ pregunta: 'cinco' }), deps)).status, 429)
  })

  it('con la funcionalidad apagada no consume cupo del límite', async () => {
    const { deps } = montar({ limiteMax: 1, feature: { data: false, error: null } })
    for (let i = 0; i < 3; i++) assert.equal((await manejar(pedir({ pregunta: 'x' }), deps)).status, 403)
  })
})

describe('política, entrada y credencial', () => {
  it('sin política (error o vacía) responde 503 con el mensaje de configuración', async () => {
    for (const politica of [{ data: [], error: null }, { data: null, error: null }, { data: [{ politica_id: 'p' }], error: { message: 'x' } }]) {
      const { res, json, r } = await llamar({ politica })
      assert.equal(res.status, 503)
      assert.match(String(json?.error), /falta una política aprobada para "rag-busqueda-documental"/)
      assert.deepEqual(r.rpcAdmin.map((c) => c[0]), ['resolver_politica_ia'])
      assert.deepEqual(r.embeddings, [])
    }
  })

  it('prepara la invocación con la política, la pregunta, 0 intentos y el reloj inyectado', async () => {
    const { r } = await llamar({ respuestas: [textoOpenAI('ok')] })
    assert.deepEqual(r.rpcAdmin[0], ['resolver_politica_ia', { p_codigo: 'rag-busqueda-documental' }])
    const [contrato, politica, entrada, intentos, iniciadoEn] = r.prepararLlamadas[0] as [any, any, any, number, Date]
    assert.equal(contrato.codigo, 'rag-busqueda-documental')
    assert.deepEqual(politica, { id: 'p1', contratoId: 'c1', perfilPrincipalId: 'perfil-1', estado: 'aprobada', limiteIntentos: 1, limiteSegundos: 60, perfilFallbackId: null })
    assert.deepEqual(entrada, { pregunta: '¿Cuál es el plazo?' })
    assert.equal(intentos, 0)
    assert.equal(iniciadoEn.getTime(), AHORA)
  })

  it('una entrada rechazada por la validación responde 400 con su mensaje (o ENTRADA_IA_INVALIDA)', async () => {
    const a = await llamar({ prepararError: new Error('ENTRADA_IA_FUERA_DE_ESQUEMA') })
    assert.equal(a.res.status, 400)
    assert.deepEqual(a.json, { error: 'ENTRADA_IA_FUERA_DE_ESQUEMA' })
    assert.deepEqual(a.r.rpcAdmin.map((c) => c[0]), ['resolver_politica_ia'])
    const b = await llamar({ prepararError: 'texto' as unknown as Error })
    assert.equal(b.res.status, 400)
    assert.deepEqual(b.json, { error: 'ENTRADA_IA_INVALIDA' })
  })

  it('sin credencial (error o vacía) responde 500 sin llamar al proveedor ni a los embeddings', async () => {
    for (const credencial of [{ data: [], error: null }, { data: [{ clave: 'x' }], error: { message: 'x' } }]) {
      const { res, json, r } = await llamar({ credencial })
      assert.equal(res.status, 500)
      assert.deepEqual(json, { error: 'No se pudo resolver la credencial del proveedor de IA.' })
      assert.deepEqual(r.rpcAdmin[1], ['obtener_clave_perfil_ia', { p_perfil_id: 'perfil-1' }])
      assert.deepEqual(r.embeddings, [])
    }
  })

  it('un proveedor que no es OpenAI responde 501 (los embeddings son solo de OpenAI)', async () => {
    const { res, json, r } = await llamar({ proveedor: 'anthropic' })
    assert.equal(res.status, 501)
    assert.deepEqual(json, { error: 'Búsqueda documental todavía no soporta el proveedor "anthropic" — solo OpenAI por ahora.' })
    assert.deepEqual(r.embeddings, [])
    assert.equal(r.pedidos.length, 0)
  })
})

describe('embeddings, búsqueda y contexto', () => {
  it('error del proveedor de embeddings responde 502 sin buscar ni generar, y no filtra el detalle', async () => {
    const { res, json, r } = await llamar({ embeddingError: new Error('EMBEDDING_PROVEEDOR_IA_FALLO_500 clave-proveedor-secreta') })
    assert.equal(res.status, 502)
    assert.deepEqual(json, { error: 'No pude procesar la pregunta, probá de nuevo.' })
    assert.equal(JSON.stringify(json).includes('secreta'), false)
    assert.equal(r.rpcUsuario.length, 1) // solo tiene_feature_publica
    assert.equal(r.pedidos.length, 0)
  })

  it('embebe la pregunta sanitizada con la clave de la credencial y busca con umbral 0.5 y k=6 como el usuario', async () => {
    const { r } = await llamar({ respuestas: [textoOpenAI('ok')] })
    assert.deepEqual(r.embeddings, [['¿Cuál es el plazo?', 'clave-proveedor-secreta']])
    assert.deepEqual(r.rpcUsuario[1], ['buscar_fragmentos', { p_embedding: '[0.1,0.2]', p_umbral: 0.5, p_k: 6 }])
    assert.equal(r.rpcAdmin.some(([n]) => n === 'buscar_fragmentos'), false)
  })

  it('error de búsqueda responde 500 sin generar', async () => {
    const { res, json, r } = await llamar({ busqueda: { data: null, error: { message: 'rls' } } })
    assert.equal(res.status, 500)
    assert.deepEqual(json, { error: 'No pude buscar en los documentos.' })
    assert.equal(r.pedidos.length, 0)
  })

  it('sin fragmentos (vacío o null) responde que no encontró nada, con 200, sin llamar al proveedor ni consultar versiones', async () => {
    for (const data of [[], null]) {
      const { res, json, r } = await llamar({ busqueda: { data, error: null } })
      assert.equal(res.status, 200)
      assert.deepEqual(json, { respuesta: SIN_INFO, documentos_citados: [] })
      assert.equal(r.pedidos.length, 0)
      assert.equal(r.tablas.length, 0)
    }
  })

  it('fragmentos sin texto responden que no encontró nada sin llamar al proveedor (MSF-725)', async () => {
    const { res, json, r } = await llamar({ busqueda: { data: [fragmento('v1', ''), fragmento('v2', '   ')], error: null } })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { respuesta: SIN_INFO, documentos_citados: [] })
    assert.equal(r.pedidos.length, 0)
  })
})

describe('generación y citas', () => {
  it('caso feliz: responde con el texto del proveedor y cita los documentos de origen, sin repetirlos', async () => {
    const { res, json, r } = await llamar({
      busqueda: { data: [fragmento('v1', 'Plazo: 5 días.'), fragmento('v2', 'Devoluciones.'), fragmento('v3', 'Otro del doc 1.'), fragmento('v9', 'Sin versión visible.')], error: null },
      versiones: { data: [{ id: 'v1', documento_id: 'doc-1' }, { id: 'v2', documento_id: 'doc-2' }, { id: 'v3', documento_id: 'doc-1' }], error: null },
      respuestas: [textoOpenAI('El plazo es de 5 días.')],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { respuesta: 'El plazo es de 5 días.', documentos_citados: ['doc-1', 'doc-2'] })
    // Las versiones se consultan con el cliente del usuario (RLS), una sola vez y sin duplicados.
    assert.deepEqual(r.tablas.map((t) => t.tabla), ['versiones_documento'])
    assert.deepEqual(r.tablas[0].ops, [['select', 'id, documento_id'], ['in', 'id', ['v1', 'v2', 'v3', 'v9']]])
    assert.equal(r.pedidos.length, 1)
  })

  it('arma la petición al proveedor: modelo, tope de tokens, instrucción de sistema, contexto delimitado y pregunta', async () => {
    const { r } = await llamar({ respuestas: [textoOpenAI('ok')] })
    assert.match(r.pedidos[0].url, /openai/)
    assert.equal(r.pedidos[0].init.headers.Authorization, 'Bearer clave-proveedor-secreta')
    const cuerpo = cuerpoProveedor(r)
    assert.equal(cuerpo.model, 'modelo-x')
    assert.equal(cuerpo.max_tokens, 1024)
    assert.equal(cuerpo.messages[0].role, 'system')
    assert.match(cuerpo.messages[0].content, /únicamente el contexto provisto/)
    assert.equal(cuerpo.messages[1].role, 'user')
    assert.match(cuerpo.messages[1].content, /^Contexto:\n\[INSTRUCCIÓN DE SISTEMA: .*\n<datos-no-confiables nonce="[0-9a-f-]+">/)
    assert.match(cuerpo.messages[1].content, /El plazo es de 5 días\./)
    assert.match(cuerpo.messages[1].content, /\n\nPregunta: ¿Cuál es el plazo\?$/)
  })

  it('sin versiones visibles igual responde, con documentos_citados vacío', async () => {
    for (const versiones of [{ data: [], error: null }, { data: null, error: { message: 'x' } }]) {
      const { res, json } = await llamar({ versiones, respuestas: [textoOpenAI('ok')] })
      assert.equal(res.status, 200)
      assert.deepEqual(json, { respuesta: 'ok', documentos_citados: [] })
    }
  })

  it('si el proveedor no trae contenido responde el texto de respaldo con 200', async () => {
    for (const r of [textoOpenAI(undefined), { choices: [] }, {}]) {
      const { res, json } = await llamar({ respuestas: [r] })
      assert.equal(res.status, 200)
      assert.equal(json?.respuesta, 'No pude generar una respuesta.')
    }
  })

  it('error HTTP del proveedor de IA responde 502 genérico, sin filtrar la clave', async () => {
    for (const falla of [{ ok: false as const, status: 500 }, { ok: false as const, status: 429 }, new Error('boom clave-proveedor-secreta')]) {
      const { res, json } = await llamar({ respuestas: [falla] })
      assert.equal(res.status, 502)
      assert.deepEqual(json, { error: ERROR_PROVEEDOR })
      assert.equal(JSON.stringify(json).includes('secreta'), false)
    }
  })

  it('el tope de espera sale de la política (máximo 90 s) o del contrato (60 s) si no es numérico', async () => {
    const casos: Array<[unknown, number]> = [[30, 30], ['45', 45], [500, 90], [undefined, 60], ['abc', 60], [0, 60]]
    for (const [limite, esperado] of casos) {
      const { r } = await llamar({ limiteSegundos: limite, respuestas: [textoOpenAI('ok')] })
      assert.deepEqual(r.segundos, [esperado], `limite_segundos=${String(limite)}`)
    }
  })

  it('timeout: un proveedor colgado se corta por AbortSignal y responde 502', async () => {
    const { deps } = montar()
    let signal: AbortSignal | undefined
    // Mismo cableado que index.ts (fetchConTimeout), con un `fetch` base que nunca responde y respeta la señal.
    deps.fetchProveedor = () => {
      const base = (_url: string, init: { signal?: AbortSignal }) => new Promise<never>((_ok, ko) => {
        signal = init.signal
        init.signal?.addEventListener('abort', () => ko(init.signal?.reason))
      })
      return fetchConTimeout(0.05, base as never)
    }
    // fetchConTimeout fuerza 60 s para valores <= 0; con 0.05 s la señal vence en ~50 ms.
    const res = await manejar(pedir({ pregunta: 'hola' }), deps)
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { error: ERROR_PROVEEDOR })
    assert.equal(signal?.aborted, true)
  })
})

describe('cableado de index.ts', () => {
  // index.ts corre en Deno y no se puede importar acá: se fija por texto qué cliente se usa para qué.
  const fuente = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const bloque = (desde: string, hasta: string) => {
    const i = fuente.indexOf(desde)
    assert.ok(i >= 0, `index.ts: falta el ancla «${desde}»`)
    const j = fuente.indexOf(hasta, i + 1)
    assert.ok(j > i, `index.ts: falta el ancla «${hasta}» después de «${desde}»`)
    return fuente.slice(i, j)
  }

  it('la service-role solo aparece en el cliente admin; el cliente del usuario usa anon + el JWT', () => {
    assert.equal((fuente.match(/SERVICE_ROLE/g) ?? []).length, 1)
    assert.match(bloque('crearAdmin:', 'crearCliente:'), /SUPABASE_SERVICE_ROLE_KEY/)
    const usuario = bloque('crearCliente:', 'prepararInvocacion,')
    assert.match(usuario, /SUPABASE_ANON_KEY/)
    assert.match(usuario, /Authorization: `Bearer \$\{jwt\}`/)
    assert.doesNotMatch(usuario, /SERVICE_ROLE/)
  })

  it('cablea el límite horario configurable (30 por defecto), los embeddings reales y el fetch con timeout', () => {
    assert.match(fuente, /enteroPositivo\(Deno\.env\.get\('PREGUNTAR_DOCUMENTOS_LIMITE_HORA'\), 30\)/)
    assert.match(fuente, /ventanaMs: 60 \* 60 \* 1000/)
    assert.match(fuente, /^\s+generarEmbedding,$/m)
    assert.match(fuente, /fetchProveedor: \(limiteSegundos\) => fetchConTimeout\(limiteSegundos\)/)
    assert.match(fuente, /ahora: \(\) => Date\.now\(\)/)
  })

  it('el limitador es una constante de módulo, creada una sola vez fuera de Deno.serve y referenciada desde deps', () => {
    assert.equal((fuente.match(/crearLimitador\(/g) ?? []).length, 1)
    assert.match(fuente, /^const limitador = crearLimitador\(/m)
    assert.ok(fuente.indexOf('crearLimitador(') < fuente.indexOf('Deno.serve('))
    assert.match(fuente, /^\s+limitador,$/m)
  })

  it('comportamiento: el manejador de index.ts comparte el mismo limitador entre requests', async () => {
    // Se evalúa index.ts sin sus imports (`Deno.serve`, clientes y manejar simulados) y se invoca el callback dos veces.
    const codigo = fuente.replace(/^import .*$/gm, '').replace(/const deps: Deps =/, 'const deps =').replace(/\)!/g, ')')
    const depsVistas: Array<{ limitador: { consumir(c: string): boolean } }> = []
    let callback: ((req: Request) => unknown) | undefined
    const Deno = { env: { get: (k: string) => (k === 'PREGUNTAR_DOCUMENTOS_LIMITE_HORA' ? '1' : 'x') }, serve: (cb: typeof callback) => { callback = cb } }
    const manejarSimulado = (_req: Request, deps: (typeof depsVistas)[number]) => { depsVistas.push(deps); return new Response('ok') }
    new Function('Deno', 'createClient', 'prepararInvocacion', 'generarEmbedding', 'fetchConTimeout', 'crearLimitador', 'enteroPositivo', 'manejar', codigo)(
      Deno, () => ({}), () => ({}), async () => [], () => async () => ({}), crearLimitador, enteroPositivo, manejarSimulado)
    assert.ok(callback)
    await callback(pedir({}))
    await callback(pedir({}))
    assert.equal(depsVistas.length, 2)
    assert.equal(depsVistas[0].limitador, depsVistas[1].limitador)
    assert.equal(depsVistas[0].limitador.consumir('u'), true)
    assert.equal(depsVistas[1].limitador.consumir('u'), false) // límite 1 por hora: el contador se comparte entre requests
  })

  it('handler.ts no lee entorno ni crea clientes; el admin solo valida el JWT y resuelve política y credencial', () => {
    const handler = readFileSync(new URL('./handler.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(handler, /Deno\.|createClient|SERVICE_ROLE|process\.env/)
    assert.deepEqual([...handler.matchAll(/admin\.(\w+)/g)].map((m) => m[1]).sort(), ['auth', 'rpc', 'rpc'])
    assert.equal(/admin\.from/.test(handler), false)
    assert.equal(/admin\.rpc\('buscar_fragmentos/.test(handler), false)
  })
})
