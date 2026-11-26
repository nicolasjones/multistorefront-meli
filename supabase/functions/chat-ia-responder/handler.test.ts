// Pruebas de `chat-ia-responder` con dependencias simuladas: fijan el comportamiento de la función (CORS, método,
// autenticación, validación, funcionalidad, cuota, política, conversación, adaptadores Anthropic y OpenAI, herramientas
// `leer`/`ejecutar`, errores del proveedor y de persistencia). Corre con `node --test` (`pnpm test:edge:chat-ia-responder`).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'
import { MAX_TOKENS_RESPUESTA } from './guardas.ts'

const CONV = '11111111-1111-4111-8111-111111111111'
const AHORA = Date.UTC(2027, 0, 1, 12, 0, 0)
const SIN_RESPUESTA = 'No encontré información relevante para responder eso.'
const ERROR_PROVEEDOR = 'No pude obtener una respuesta del proveedor de IA, probá de nuevo.'
const ERROR_TIMEOUT = 'El proveedor de IA tardó demasiado en responder, probá de nuevo.'

type Op = [string, ...unknown[]]
type Opciones = {
  jwtValido?: boolean
  entornoRoto?: boolean
  feature?: { data: unknown; error: unknown }
  cupo?: { data: unknown; error: unknown }
  politica?: { data: unknown; error: unknown }
  credencial?: { data: unknown; error: unknown }
  adaptador?: string
  limiteSegundos?: unknown
  existente?: { data: unknown; error: unknown }
  nueva?: { data: unknown; error: unknown }
  insertUsuario?: unknown
  insertChat?: unknown
  insertFallida?: unknown
  fuente?: { data: unknown; error?: unknown } | null
  puedeLeer?: unknown
  filas?: { data: unknown; error: unknown }
  propuesta?: { data: unknown; error: unknown }
  prepararError?: Error
  limiteHora?: string
  respuestas?: Array<unknown | Error | { ok: false; status: number }>
}

function montar(o: Opciones = {}) {
  const r = {
    admins: 0, clientes: [] as string[], rpcAdmin: [] as [string, unknown][], rpcUsuario: [] as [string, unknown][],
    jwts: [] as string[], consultas: [] as { tabla: string; ops: Op[] }[], inserts: [] as { tabla: string; fila: Record<string, unknown> }[],
    prepararLlamadas: [] as unknown[][], segundos: [] as number[], pedidos: [] as { url: string; init: { headers: Record<string, string>; body: string } }[],
  }
  const cola = [...(o.respuestas ?? [])]
  const resolver = (tabla: string, ops: Op[]) => {
    const primero = ops[0]?.[0]
    if (primero === 'insert') {
      const fila = ops[0][1] as Record<string, unknown>
      r.inserts.push({ tabla, fila })
      if (tabla === 'conversaciones_chat_ia') return o.nueva ?? { data: { id: CONV }, error: null }
      if (fila.estado === 'fallida') return { error: o.insertFallida ?? null }
      return { error: (fila.origen === 'usuario' ? o.insertUsuario : o.insertChat) ?? null }
    }
    if (tabla === 'conversaciones_chat_ia') return o.existente ?? { data: { id: CONV }, error: null }
    if (tabla === 'fuentes_chat_ia') return o.fuente === undefined ? { data: { feature_id: 'inventario' }, error: null } : (o.fuente ?? { data: null, error: null })
    return o.filas ?? { data: [{ sku: 'A', token: 'secreto-fila' }], error: null }
  }
  const constructor = (tabla: string) => {
    const ops: Op[] = []
    r.consultas.push({ tabla, ops })
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'limit', 'insert', 'maybeSingle', 'single']) q[m] = (...a: unknown[]) => { ops.push([m, ...a]); return q }
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolver(tabla, ops)).then(ok, ko)
    return q
  }
  const politicaBase = { politica_id: 'p1', contrato_id: 'c1', perfil_principal_id: 'perfil-1', limite_intentos: 1, limite_segundos: o.limiteSegundos ?? 60, perfil_fallback_id: null }
  const deps: Deps = {
    crearAdmin: () => {
      r.admins++
      if (o.entornoRoto) throw new Error('supabaseUrl is required.')
      return {
        auth: { getUser: async (jwt: string) => { r.jwts.push(jwt); return o.jwtValido === false ? { data: null, error: { message: 'jwt' } } : { data: { user: { id: 'u1' } }, error: null } } },
        rpc: async (nombre: string, args: Record<string, unknown>) => {
          r.rpcAdmin.push([nombre, args])
          if (nombre === 'resolver_politica_ia') return o.politica ?? { data: [politicaBase], error: null }
          if (nombre === 'consumir_cupo_ia') return o.cupo ?? { data: [{ se_consumio: true, usos_actuales: 1, segundos_hasta_reinicio: 1800 }], error: null }
          return o.credencial ?? { data: [{ clave: 'clave-proveedor-secreta', adaptador: o.adaptador ?? 'anthropic', proveedor_codigo: o.adaptador === 'openai' ? 'openai' : 'anthropic', modelo_id: 'modelo-x' }], error: null }
        },
      }
    },
    crearCliente: (jwt) => {
      r.clientes.push(jwt)
      return {
        rpc: async (nombre: string, args: Record<string, unknown>) => {
          r.rpcUsuario.push([nombre, args])
          if (nombre === 'tiene_feature_publica') return o.feature ?? { data: true, error: null }
          if (nombre === 'puede_chat_leer_funcionalidad') return { data: o.puedeLeer ?? true, error: null }
          return o.propuesta ?? { data: { propuesta: true }, error: null }
        },
        from: constructor,
      }
    },
    prepararInvocacion: ((...a: unknown[]) => {
      r.prepararLlamadas.push(a)
      if (o.prepararError) throw o.prepararError
      return { mensaje: (a[2] as { mensaje: string }).mensaje }
    }) as Deps['prepararInvocacion'],
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
    ahora: () => AHORA,
    limiteHora: () => o.limiteHora,
    systemPrompt: 'PROMPT-DE-PRUEBA',
  }
  return { deps, r }
}

const pedir = (cuerpo: unknown, { metodo = 'POST', auth = 'Bearer jwt-1' as string | null } = {}) =>
  new Request('https://f.test/chat-ia-responder', {
    method: metodo,
    headers: auth === null ? {} : { Authorization: auth },
    body: metodo === 'POST' ? (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  })

const textoAnthropic = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })
const usoAnthropic = (...bloques: Array<{ id: string; name: string; input: Record<string, unknown> }>) => ({
  stop_reason: 'tool_use', content: [{ type: 'text', text: 'pienso' }, ...bloques.map((b) => ({ type: 'tool_use', ...b }))],
})
const textoOpenAI = (content: string | null) => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })
const usoOpenAI = (...llamadas: Array<{ id: string; name: string; arguments: string }>) => ({
  choices: [{ message: { content: null, tool_calls: llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.name, arguments: l.arguments } })) }, finish_reason: 'tool_calls' }],
})
const llamar = async (opciones: Opciones, cuerpo: unknown = { mensaje: 'hola' }, req?: Request) => {
  const { deps, r } = montar(opciones)
  const res = await manejar(req ?? pedir(cuerpo), deps)
  return { res, r, json: await res.clone().json().catch(() => null) as Record<string, unknown> | null }
}
const mensajesGuardados = (r: ReturnType<typeof montar>['r']) => r.inserts.filter((i) => i.tabla === 'mensajes_chat_ia').map((i) => i.fila)
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

  it('sin Authorization (o vacío) responde 403 sin validar JWT', async () => {
    for (const auth of [null, '']) {
      const { res, r, json } = await llamar({}, { mensaje: 'hola' }, pedir({ mensaje: 'hola' }, { auth }))
      assert.equal(res.status, 403)
      assert.deepEqual(json, { error: 'No autorizado' })
      assert.deepEqual(r.jwts, [])
      assert.deepEqual(r.clientes, [])
    }
  })

  it('un «Bearer» sin token (el encabezado se recorta) no se acepta: llega como JWT inválido y responde 403', async () => {
    const { res, r } = await llamar({ jwtValido: false }, { mensaje: 'hola' }, pedir({ mensaje: 'hola' }, { auth: 'Bearer ' }))
    assert.equal(res.status, 403)
    assert.deepEqual(r.jwts, ['Bearer'])
    assert.deepEqual(r.clientes, [])
  })

  it('un JWT inválido responde 403 y no crea el cliente del usuario ni llama al proveedor', async () => {
    const { res, r, json } = await llamar({ jwtValido: false })
    assert.equal(res.status, 403)
    assert.deepEqual(json, { error: 'No autorizado' })
    assert.deepEqual(r.jwts, ['jwt-1'])
    assert.deepEqual(r.clientes, [])
    assert.equal(r.pedidos.length, 0)
  })

  it('el prefijo Bearer es insensible a mayúsculas y el JWT se pasa tal cual', async () => {
    const { r } = await llamar({ respuestas: [textoAnthropic('ok')] }, { mensaje: 'hola' }, pedir({ mensaje: 'hola' }, { auth: 'bearer jwt-xyz' }))
    assert.deepEqual(r.jwts, ['jwt-xyz'])
    assert.deepEqual(r.clientes, ['jwt-xyz'])
  })

  it('el cliente admin se crea antes de autenticar (un entorno roto propaga el error, como antes)', async () => {
    const { deps } = montar({ entornoRoto: true })
    await assert.rejects(() => manejar(pedir({ mensaje: 'hola' }), deps), /supabaseUrl is required/)
  })
})

describe('validación de entrada', () => {
  it('JSON inválido responde 400 antes de crear el cliente del usuario', async () => {
    const { res, r, json } = await llamar({}, 'no es json')
    assert.equal(res.status, 400)
    assert.deepEqual(json, { error: 'Cuerpo inválido: se esperaba JSON.' })
    assert.deepEqual(r.clientes, [])
  })

  it('rechaza mensaje ausente, vacío, no texto o demasiado largo y conversacion_id que no es UUID', async () => {
    const casos: Array<[unknown, string]> = [
      [{}, 'Falta "mensaje".'],
      [{ mensaje: '   ' }, 'Falta "mensaje".'],
      [{ mensaje: 5 }, 'Falta "mensaje".'],
      [{ mensaje: 'x'.repeat(4001) }, 'El mensaje admite hasta 4000 caracteres.'],
      [{ mensaje: 'x', conversacion_id: 'no-uuid' }, '"conversacion_id" inválido.'],
    ]
    for (const [cuerpo, error] of casos) {
      const { res, r, json } = await llamar({}, cuerpo)
      assert.equal(res.status, 400)
      assert.deepEqual(json, { error })
      assert.equal(r.pedidos.length, 0)
      assert.deepEqual(r.rpcUsuario, [])
    }
  })
})

describe('funcionalidad, cuota y política (antes de gastar crédito)', () => {
  it('sin la funcionalidad chat-ia responde 403 y usa el cliente del usuario (no el admin)', async () => {
    const { res, r, json } = await llamar({ feature: { data: false, error: null } })
    assert.equal(res.status, 403)
    assert.deepEqual(json, { error: 'El Chat IA no está habilitado para tu organización.' })
    assert.deepEqual(r.rpcUsuario, [['tiene_feature_publica', { p_feature_id: 'chat-ia' }]])
    assert.deepEqual(r.rpcAdmin, [])
  })

  it('un error al verificar la funcionalidad responde 503, lo registra sin filtrar el detalle al cliente', async () => {
    const { res, json } = await llamar({ feature: { data: null, error: { message: 'detalle-interno-db' } } })
    assert.equal(res.status, 503)
    assert.deepEqual(json, { error: 'No se pudo verificar la funcionalidad del chat.' })
    assert.equal(errores.length, 1)
    assert.doesNotMatch(JSON.stringify(json), /detalle-interno-db/)
  })

  it('consume un uso del cupo persistente del usuario para chat-ia (30 por hora por defecto) con el cliente admin', async () => {
    const { r, res } = await llamar({ respuestas: [textoAnthropic('ok')] })
    assert.equal(res.status, 200)
    assert.deepEqual(r.rpcAdmin.filter(([n]) => n === 'consumir_cupo_ia'), [['consumir_cupo_ia', { p_usuario: 'u1', p_funcionalidad: 'chat-ia', p_limite: 30 }]])
    assert.equal(r.consultas.some((c) => c.tabla === 'mensajes_chat_ia' && c.ops[0][0] === 'select'), false, 'ya no se cuenta sobre mensajes_chat_ia (el usuario puede borrarlos)')
  })

  it('el tope sale de CHAT_IA_LIMITE_HORA y un valor inválido vuelve a 30', async () => {
    const a = await llamar({ limiteHora: '3', respuestas: [textoAnthropic('ok')] })
    assert.equal((a.r.rpcAdmin.find(([n]) => n === 'consumir_cupo_ia')![1] as { p_limite: number }).p_limite, 3)
    const b = await llamar({ limiteHora: 'abc', respuestas: [textoAnthropic('ok')] })
    assert.equal((b.r.rpcAdmin.find(([n]) => n === 'consumir_cupo_ia')![1] as { p_limite: number }).p_limite, 30)
  })

  it('cupo agotado: 429 con Retry-After y mensaje claro, sin crear conversación, sin guardar nada y sin llamar al proveedor', async () => {
    const { res, r, json } = await llamar({ cupo: { data: [{ se_consumio: false, usos_actuales: 30, segundos_hasta_reinicio: 1234 }], error: null } })
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '1234')
    assert.deepEqual(json, { error: 'Superaste el límite de mensajes por hora. Probá de nuevo más tarde.' })
    assert.equal(r.pedidos.length, 0)
    assert.equal(r.inserts.length, 0)
    assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia', 'obtener_clave_perfil_ia', 'consumir_cupo_ia'])
  })

  it('cupo agotado con conversacion_id propia: 429 sin guardar el mensaje ni crear nada', async () => {
    const { res, r } = await llamar({ cupo: { data: [{ se_consumio: false, usos_actuales: 30, segundos_hasta_reinicio: 10 }], error: null } }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 429)
    assert.equal(r.inserts.length, 0)
    assert.equal(r.pedidos.length, 0)
  })

  it('un fallo del cupo deja log [cupo-ia] con la funcionalidad, sin el id del usuario ni el texto de la petición, y el cliente recibe el mismo 503', async () => {
    const privado = 'mensaje-privado-xyz'
    for (const modo of ['error', 'lanza', 'rechaza']) {
      errores.length = 0
      const { deps, r } = montar({ cupo: { data: null, error: { message: 'fallo para u1 en db', code: 'XX000' } } })
      if (modo !== 'error') {
        const admin = deps.crearAdmin()
        deps.crearAdmin = () => ({ ...admin, rpc: (n: string, a: Record<string, unknown>) => {
          if (n !== 'consumir_cupo_ia') return admin.rpc(n, a)
          if (modo === 'lanza') throw new Error('red caída u1')
          return Promise.reject(new Error('red caída u1'))
        } })
      }
      const res = await manejar(pedir({ mensaje: privado }), deps)
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { error: 'No se pudo verificar tu cuota de uso.' })
      assert.equal(errores.length, 1)
      assert.match(String(errores[0][0]), /^\[cupo-ia\]/)
      assert.equal((errores[0][1] as { funcionalidad: string }).funcionalidad, 'chat-ia')
      assert.doesNotMatch(JSON.stringify(errores), /u1|mensaje-privado-xyz/)
      // Un error devuelto por la RPC se imprime saneado ([usuario]); una excepción lanzada o rechazada solo deja el nombre.
      assert.equal((errores[0][1] as { error: string }).error, modo === 'error' ? 'XX000 fallo para [usuario] en db' : 'Error')
      assert.equal(r.pedidos.length, 0)
    }
  })

  it('el usuario del cupo sale del JWT validado, aunque el cuerpo traiga otro usuario_id o user_id', async () => {
    const { r } = await llamar({ respuestas: [textoAnthropic('ok')] }, { mensaje: 'hola', usuario_id: 'otro', user_id: 'otro', p_usuario: 'otro' })
    const llamadas = r.rpcAdmin.filter(([n]) => n === 'consumir_cupo_ia')
    assert.equal(llamadas.length, 1)
    assert.equal((llamadas[0][1] as { p_usuario: string }).p_usuario, 'u1')
    assert.deepEqual(r.inserts.find((i) => i.tabla === 'conversaciones_chat_ia')?.fila, { usuario_id: 'u1' })
  })

  it('si la RPC del cupo lanza o rechaza la promesa responde 503 controlado, sin proveedor ni escrituras', async () => {
    for (const modo of ['lanza', 'rechaza']) {
      const { deps, r } = montar({ respuestas: [textoAnthropic('ok')] })
      const admin = deps.crearAdmin()
      deps.crearAdmin = () => ({ ...admin, rpc: (nombre: string, args: Record<string, unknown>) => {
        if (nombre !== 'consumir_cupo_ia') return admin.rpc(nombre, args)
        if (modo === 'lanza') throw new Error('detalle-interno-red')
        return Promise.reject(new Error('detalle-interno-red'))
      } })
      const res = await manejar(pedir({ mensaje: 'hola' }), deps)
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { error: 'No se pudo verificar tu cuota de uso.' })
      assert.equal(r.pedidos.length, 0)
      assert.equal(r.inserts.length, 0)
    }
  })

  it('el header Retry-After del 429 es el entero hacia arriba de los segundos hasta el reinicio (entre 1 y 3600) y 3600 si no se entiende', async () => {
    const casos: Array<[unknown, string]> = [[1, '1'], [0.5, '1'], [1.2, '2'], [59.01, '60'], [3600, '3600'], [null, '3600'], ['Infinity', '3600'], [0, '3600']]
    for (const [segundos, esperado] of casos) {
      const { res, r } = await llamar({ cupo: { data: [{ se_consumio: false, usos_actuales: 30, segundos_hasta_reinicio: segundos }], error: null } })
      assert.equal(res.status, 429)
      assert.equal(res.headers.get('Retry-After'), esperado, `segundos=${String(segundos)}`)
      assert.equal(r.pedidos.length, 0)
    }
  })

  it('un error al consumir el cupo responde 503 sin dejar pasar ni llamar al proveedor', async () => {
    for (const cupo of [{ data: null, error: { message: 'detalle-interno-db' } }, { data: [], error: null }, { data: null, error: null }, { data: [{ se_consumio: 'si' }], error: null }]) {
      const { res, r, json } = await llamar({ cupo })
      assert.equal(res.status, 503)
      assert.deepEqual(json, { error: 'No se pudo verificar tu cuota de uso.' })
      assert.equal(res.headers.get('Retry-After'), null)
      assert.equal(r.pedidos.length, 0)
      assert.equal(r.inserts.length, 0)
    }
  })

  it('el cupo se consume DESPUÉS de los chequeos de funcionalidad, conversación y política (una petición inválida no gasta cupo)', async () => {
    const sinFeature = await llamar({ feature: { data: false, error: null } })
    const sinConv = await llamar({ existente: { data: null, error: null } }, { mensaje: 'hola', conversacion_id: CONV })
    const sinPolitica = await llamar({ politica: { data: [], error: null } })
    const mensajeLargo = await llamar({}, { mensaje: 'x'.repeat(4001) })
    const sinMensaje = await llamar({}, {})
    for (const { r } of [sinFeature, sinConv, sinPolitica, mensajeLargo, sinMensaje]) {
      assert.equal(r.rpcAdmin.some(([n]) => n === 'consumir_cupo_ia'), false)
      assert.equal(r.pedidos.length, 0)
    }
  })

  it('el mensaje de más de 4000 caracteres se rechaza con 400 antes de la funcionalidad, el cupo y el proveedor; 4000 pasa', async () => {
    const largo = await llamar({}, { mensaje: 'x'.repeat(4001) })
    assert.equal(largo.res.status, 400)
    assert.deepEqual(largo.json, { error: 'El mensaje admite hasta 4000 caracteres.' })
    assert.deepEqual(largo.r.rpcUsuario, [])
    const justo = await llamar({ respuestas: [textoAnthropic('ok')] }, { mensaje: 'x'.repeat(4000) })
    assert.equal(justo.res.status, 200)
  })

  it('sin política aprobada (error o vacía) responde 503 y no resuelve credencial', async () => {
    for (const politica of [{ data: [], error: null }, { data: null, error: null }, { data: [{ politica_id: 'p' }], error: { message: 'x' } }]) {
      const { res, r, json } = await llamar({ politica })
      assert.equal(res.status, 503)
      assert.match(String(json?.error), /falta una política aprobada para "chat-ia-leer"/)
      assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia'])
      assert.deepEqual(r.rpcAdmin[0], ['resolver_politica_ia', { p_codigo: 'chat-ia-leer' }])
      assert.equal(r.inserts.length, 0)
    }
  })
})

describe('conversación y mensaje del usuario', () => {
  it('sin conversacion_id crea una a nombre del usuario autenticado y guarda el mensaje', async () => {
    const { res, r, json } = await llamar({ respuestas: [textoAnthropic('listo')] })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'listo' })
    assert.deepEqual(r.inserts[0], { tabla: 'conversaciones_chat_ia', fila: { usuario_id: 'u1' } })
    assert.deepEqual(mensajesGuardados(r), [
      { conversacion_id: CONV, origen: 'usuario', contenido: 'hola' },
      { conversacion_id: CONV, origen: 'chat', contenido: 'listo' },
    ])
  })

  it('sin conversacion_id no consulta la existencia de ninguna conversación (solo crea la nueva)', async () => {
    const { r } = await llamar({ respuestas: [textoAnthropic('ok')] })
    assert.equal(r.consultas.some((c) => c.tabla === 'conversaciones_chat_ia' && c.ops[0][0] === 'select' && c.ops.some((o) => o[0] === 'maybeSingle')), false)
    assert.equal(r.inserts.filter((i) => i.tabla === 'conversaciones_chat_ia').length, 1)
  })

  it('con conversacion_id propia la reusa sin crear otra', async () => {
    const { res, r } = await llamar({ respuestas: [textoAnthropic('ok')] }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 200)
    assert.equal(r.inserts.some((i) => i.tabla === 'conversaciones_chat_ia'), false)
    const q = r.consultas.find((c) => c.tabla === 'conversaciones_chat_ia')!
    assert.deepEqual(q.ops.map((o) => o[0]), ['select', 'eq', 'maybeSingle'])
    assert.deepEqual(q.ops[1], ['eq', 'id', CONV])
  })

  it('una conversación inexistente o ajena (RLS no devuelve fila) responde 404 antes del proveedor', async () => {
    const { res, r, json } = await llamar({ existente: { data: null, error: null } }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 404)
    assert.deepEqual(json, { error: 'La conversación no existe.' })
    assert.equal(r.pedidos.length, 0)
    assert.deepEqual(r.rpcAdmin, [])
    assert.equal(mensajesGuardados(r).length, 0)
  })

  it('un error al verificar la conversación responde 503', async () => {
    const { res } = await llamar({ existente: { data: null, error: { message: 'x' } } }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 503)
  })

  it('no poder crear la conversación responde 500; no poder guardar el mensaje responde 500', async () => {
    const a = await llamar({ nueva: { data: null, error: { message: 'rls' } } })
    assert.equal(a.res.status, 500)
    assert.deepEqual(a.json, { error: 'No se pudo crear la conversación.' })
    const b = await llamar({ insertUsuario: { message: 'rls' } })
    assert.equal(b.res.status, 500)
    assert.deepEqual(b.json, { error: 'No se pudo guardar tu mensaje.' })
    assert.equal(a.r.pedidos.length + b.r.pedidos.length, 0)
  })
})

describe('preparación de la invocación y credencial', () => {
  it('pasa contrato, política aprobada, mensaje, 0 intentos y el reloj inyectado a prepararInvocacion', async () => {
    const { r } = await llamar({ respuestas: [textoAnthropic('ok')] })
    const [contrato, politica, entrada, intentos, fecha] = r.prepararLlamadas[0] as [Record<string, unknown>, Record<string, unknown>, unknown, number, Date]
    assert.equal(contrato.codigo, 'chat-ia-leer')
    assert.equal(contrato.claveAislamientoOrganizacion, 'organizacion_id')
    assert.deepEqual(politica, { id: 'p1', contratoId: 'c1', perfilPrincipalId: 'perfil-1', estado: 'aprobada', limiteIntentos: 1, limiteSegundos: 60, perfilFallbackId: null })
    assert.deepEqual(entrada, { mensaje: 'hola' })
    assert.equal(intentos, 0)
    assert.equal(fecha.getTime(), AHORA)
  })

  it('si prepararInvocacion rechaza responde 400 SIN consumir cupo, sin escribir nada y sin llamar al proveedor ni resolver credencial', async () => {
    const { res, r, json } = await llamar({ prepararError: new Error('LIMITE_INTENTOS_IA') })
    assert.equal(res.status, 400)
    assert.deepEqual(json, { error: 'LIMITE_INTENTOS_IA' })
    assert.equal(r.inserts.length, 0)
    assert.equal(r.pedidos.length, 0)
    assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia'])
  })

  it('un rechazo de configuración con conversacion_id propia la devuelve en el cuerpo, sigue sin consumir cupo ni escribir', async () => {
    const { res, r, json } = await llamar({ prepararError: new Error('LIMITE_INTENTOS_IA') }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 400)
    assert.deepEqual(json, { conversacion_id: CONV, error: 'LIMITE_INTENTOS_IA' })
    assert.equal(r.inserts.length, 0)
    assert.equal(r.rpcAdmin.some(([n]) => n === 'consumir_cupo_ia'), false)
  })

  it('un error no estándar de prepararInvocacion se informa como ENTRADA_IA_INVALIDA', async () => {
    const { deps } = montar()
    deps.prepararInvocacion = (() => { throw 'texto' }) as unknown as Deps['prepararInvocacion']
    const res = await manejar(pedir({ mensaje: 'hola' }), deps)
    assert.equal(res.status, 400)
    assert.equal((await res.json() as { error: string }).error, 'ENTRADA_IA_INVALIDA')
  })

  it('sin credencial responde 500 con mensaje fijo, sin filtrar la clave', async () => {
    for (const credencial of [{ data: [], error: null }, { data: [{ clave: 'k' }], error: { message: 'detalle-secreto' } }]) {
      const { res, json, r } = await llamar({ credencial })
      assert.equal(res.status, 500)
      assert.deepEqual(json, { error: 'No se pudo resolver la credencial del proveedor de IA.' })
      assert.doesNotMatch(JSON.stringify(json), /detalle-secreto/)
      assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia', 'obtener_clave_perfil_ia'])
      assert.deepEqual(r.rpcAdmin[1], ['obtener_clave_perfil_ia', { p_perfil_id: 'perfil-1' }])
      assert.equal(r.inserts.length, 0)
    }
  })

  it('los rechazos de configuración (500 y 501) dejan log de servidor con el motivo, sin clave ni contenido del mensaje', async () => {
    const privado = 'mensaje-privado-xyz'
    const a = await llamar({ credencial: { data: [{ clave: 'clave-proveedor-secreta' }], error: { message: 'detalle-secreto' } } }, { mensaje: privado })
    assert.equal(a.res.status, 500)
    assert.deepEqual(errores.map((e) => e[0]), ['[chat-ia-responder] configuración de la plataforma: credencial_no_disponible'])
    errores.length = 0
    const b = await llamar({ adaptador: 'gemini' }, { mensaje: privado })
    assert.equal(b.res.status, 501)
    assert.deepEqual(errores.map((e) => e[0]), ['[chat-ia-responder] configuración de la plataforma: adaptador_no_soportado:gemini'])
    assert.doesNotMatch(JSON.stringify(errores), /clave-proveedor-secreta|detalle-secreto|mensaje-privado-xyz|u1/)
  })

  it('el log de configuración es de una línea y acota el adaptador a 64 caracteres (sin saneo, un adaptador hostil falsificaría el log)', async () => {
    const adaptador = `x\n[chat-ia-responder] FAKE\r\u2028\u0000${'A'.repeat(200)}`
    const { res } = await llamar({ adaptador })
    assert.equal(res.status, 501)
    assert.equal(errores.length, 1)
    const linea = String(errores[0][0])
    assert.equal(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/.test(linea), false)
    assert.match(linea, /^\[chat-ia-responder\] configuración de la plataforma: adaptador_no_soportado:x \[chat-ia-responder\] FAKE/)
    assert.ok(linea.length - '[chat-ia-responder] configuración de la plataforma: adaptador_no_soportado:'.length <= 64)
  })

  it('un fallo de red del proveedor con una clave en la URL o en la cause deja solo el nombre del error en el log', async () => {
    const error = new TypeError('fetch failed: https://api.x/y?apikey=SECRETO', { cause: new Error('Bearer SECRETO') })
    const { res } = await llamar({ respuestas: [error] })
    assert.equal(res.status, 502)
    assert.deepEqual(errores, [['chat-ia-responder: fallo al invocar proveedor', 'TypeError']])
    assert.doesNotMatch(JSON.stringify(errores), /SECRETO|api\.x/)
  })

  it('con otro stop_reason (end_turn, max_tokens) y bloques tool_use NO se ejecuta ninguna herramienta: se responde el texto', async () => {
    for (const stop_reason of ['end_turn', 'max_tokens', 'stop_sequence']) {
      const { res, r, json } = await llamar({
        respuestas: [{ stop_reason, content: [{ type: 'text', text: 'listo' }, { type: 'tool_use', id: 't1', name: 'ejecutar', input: { rpc: 'ajustar_stock', parametros: { sku: 'A' }, descripcion: 'Ajustar' } }, { type: 'tool_use', id: 't2', name: 'leer', input: { vista: 'v' } }] }],
      })
      assert.equal(res.status, 200, stop_reason)
      assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'listo' }, stop_reason)
      assert.equal(r.pedidos.length, 1, stop_reason)
      assert.equal(r.rpcUsuario.some(([n]) => n === 'proponer_accion_chat_ia' || n === 'puede_chat_leer_funcionalidad'), false, stop_reason)
      assert.equal(r.consultas.some((c) => c.tabla === 'fuentes_chat_ia'), false, stop_reason)
    }
  })

  it('un error hostil del proveedor (getter o Proxy que lanza) sigue dando el 502 previsto, sin lanzar desde el catch', async () => {
    const conGetter = (campo: string) => Object.defineProperty(new Error('x'), campo, { get() { throw new Error('getter') } })
    const hostiles: Error[] = [conGetter('name'), conGetter('message'), conGetter('code'), new Proxy(new Error('x'), { get() { throw new Error('proxy') } })]
    for (const h of hostiles) {
      errores.length = 0
      const { res, json } = await llamar({ respuestas: [h] })
      assert.equal(res.status, 502)
      assert.deepEqual(json, { conversacion_id: CONV, error: ERROR_PROVEEDOR })
    }
  })

  it('CADA console.error del chat fija su contenido: sin mensajes de red ni claves (proveedor 1.ª y 2.ª llamada en ambos adaptadores, inesperado, persistencia, conversación)', async () => {
    const red = () => new TypeError('fetch failed https://x.y/?apikey=SECRETO Bearer SECRETO', { cause: new Error('Bearer SECRETO') })
    const lecturaAnthropic = usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v' } })
    const lecturaOpenAI = usoOpenAI({ id: 'c1', name: 'leer', arguments: '{"vista":"v"}' })
    const proveedor = 'chat-ia-responder: fallo al invocar proveedor'
    const casos: Array<[string, Opciones, unknown[][]]> = [
      ['anthropic, 1.ª llamada', { respuestas: [red()] }, [[proveedor, 'TypeError']]],
      ['anthropic, 2.ª llamada', { respuestas: [lecturaAnthropic, red()] }, [[proveedor, 'TypeError']]],
      ['openai, 1.ª llamada', { adaptador: 'openai', respuestas: [red()] }, [[proveedor, 'TypeError']]],
      ['openai, 2.ª llamada', { adaptador: 'openai', respuestas: [lecturaOpenAI, red()] }, [[proveedor, 'TypeError']]],
      ['error inesperado', { respuestas: [{ stop_reason: 'end_turn', get content() { throw new Error('Bearer SECRETO https://x.y/?apikey=SECRETO') } }] }, [['chat-ia-responder: error inesperado', 'Error']]],
      ['crear la conversación', { nueva: { data: null, error: { code: '42501', message: 'rls Bearer SECRETO' } } }, [['chat-ia-responder: no se pudo crear la conversación', '42501', 'rls Bearer [token]']]],
      ['crear la conversación sin detalle', { nueva: { data: null, error: null } }, [['chat-ia-responder: no se pudo crear la conversación', '', 'undefined']]],
      ['guardar el mensaje del usuario', { insertUsuario: { message: 'rls Bearer SECRETO' } }, [['chat-ia-responder: no se pudo guardar el mensaje del usuario']]],
      ['guardar la respuesta', { insertChat: { message: 'rls Bearer SECRETO' }, respuestas: [textoAnthropic('ok')] }, [['chat-ia-responder: no se pudo guardar la respuesta del chat']]],
    ]
    for (const [nombre, opciones, esperado] of casos) {
      errores.length = 0
      const { res } = await llamar(opciones)
      assert.ok(res.status >= 500, nombre)
      assert.deepEqual(errores, esperado, nombre)
      assert.doesNotMatch(JSON.stringify(errores), /SECRETO|x\.y/, nombre)
    }
  })

  it('el error inesperado deja solo nombre y código, no el mensaje', async () => {
    const { res } = await llamar({ respuestas: [{ stop_reason: 'end_turn' }] })
    assert.equal(res.status, 500)
    assert.deepEqual(errores, [['chat-ia-responder: error inesperado', 'TypeError']])
  })

  it('los demás logs con datos variables también salen en una línea y acotados (verificación de funcionalidad y fallo del proveedor)', async () => {
    const a = await llamar({ feature: { data: null, error: { message: `boom\n[chat-ia-responder] FAKE Bearer SECRETO${'z'.repeat(500)}` } } })
    assert.equal(a.res.status, 503)
    assert.equal(/[\r\n]/.test(String(errores[0][1])), false)
    assert.doesNotMatch(String(errores[0][1]), /SECRETO/)
    assert.ok(String(errores[0][1]).length <= 300)
    errores.length = 0
    await llamar({ respuestas: [new Error(`caída\n[chat-ia-responder] FAKE${'z'.repeat(500)}`)] })
    assert.equal(errores.length, 1)
    assert.equal(/[\r\n]/.test(String(errores[0][1])), false)
    assert.ok(String(errores[0][1]).length <= 300)
  })

  it('los rechazos del cliente o de estado no dejan log de servidor: 403 sin sesión, 400 de validación, 404, 403 de funcionalidad, 503 de política y 429', async () => {
    const casos: Array<[number, () => Promise<unknown>]> = [
      [403, () => llamar({ jwtValido: false })],
      [403, () => llamar({}, { mensaje: 'hola' }, pedir({ mensaje: 'hola' }, { auth: null }))],
      [400, () => llamar({}, undefined, pedir(undefined, { metodo: 'GET' }))],
      [400, () => llamar({}, { mensaje: '' })],
      [400, () => llamar({}, { mensaje: 'x'.repeat(4001) })],
      [400, () => llamar({}, { mensaje: 'hola', conversacion_id: 'no-uuid' })],
      [400, () => llamar({}, 'no es json')],
      [404, () => llamar({ existente: { data: null, error: null } }, { mensaje: 'hola', conversacion_id: CONV })],
      [403, () => llamar({ feature: { data: false, error: null } })],
      [503, () => llamar({ politica: { data: [], error: null } })],
      [429, () => llamar({ cupo: { data: [{ se_consumio: false, segundos_hasta_reinicio: 5 }], error: null } })],
    ]
    for (const [estado, ejecutar] of casos) {
      errores.length = 0
      const { res } = await ejecutar() as { res: Response }
      assert.equal(res.status, estado)
      assert.deepEqual(errores, [], `estado ${estado}`)
    }
  })

  it('un error al verificar la conversación (503) deja log con código y mensaje redactado, sin proveedor ni cupo', async () => {
    const { res, r, json } = await llamar({ existente: { data: null, error: { code: '57014', message: 'timeout Bearer SECRETO' } } }, { mensaje: 'hola', conversacion_id: CONV })
    assert.equal(res.status, 503)
    assert.deepEqual(json, { error: 'No se pudo verificar la conversación.' })
    assert.deepEqual(errores, [['chat-ia-responder: no se pudo verificar la conversación', '57014', 'timeout Bearer [token]']])
    assert.equal(r.pedidos.length, 0)
    assert.equal(r.rpcAdmin.some(([n]) => n === 'consumir_cupo_ia'), false)
  })

  it('prepararInvocacion: solo los códigos de política/perfil mal configurados dejan log; los errores del cliente no', async () => {
    for (const codigo of ['POLITICA_IA_INACTIVA', 'LIMITE_INTENTOS_IA_INVALIDO', 'LIMITE_TIEMPO_IA_INVALIDO', 'LIMITE_INTENTOS_IA']) {
      errores.length = 0
      const { res } = await llamar({ prepararError: new Error(codigo) }, { mensaje: 'mensaje-privado-xyz' })
      assert.equal(res.status, 400)
      assert.deepEqual(errores.map((e) => e[0]), [`[chat-ia-responder] configuración de la plataforma: politica_invalida:${codigo}`])
      assert.doesNotMatch(JSON.stringify(errores), /mensaje-privado-xyz|u1/)
    }
    for (const codigo of ['ENTRADA_IA_FUERA_DE_ESQUEMA', 'ORGANIZACION_IA_NO_AUTORIZADA', 'ENTRADA_IA_INVALIDA']) {
      errores.length = 0
      const { res, json } = await llamar({ prepararError: new Error(codigo) })
      assert.equal(res.status, 400)
      assert.deepEqual(json, { error: codigo })
      assert.deepEqual(errores, [])
    }
  })

  it('un adaptador distinto de anthropic/openai responde 501 y no llama al proveedor', async () => {
    const { res, json, r } = await llamar({ adaptador: 'gemini' })
    assert.equal(res.status, 501)
    assert.equal(json?.error, 'El chat todavía no soporta el adaptador "gemini" — solo Anthropic y OpenAI por ahora.')
    assert.equal(r.pedidos.length, 0)
    assert.equal(r.inserts.length, 0)
    assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia', 'obtener_clave_perfil_ia'])
  })

  it('el tope de espera al proveedor sale de la política y nunca pasa de 90 s', async () => {
    const casos: Array<[unknown, number]> = [[30, 30], [600, 90], [0, 60], ['x', 60], [null, 60]]
    for (const [limite, esperado] of casos) {
      const { r } = await llamar({ limiteSegundos: limite, respuestas: [textoAnthropic('ok')] })
      assert.deepEqual(r.segundos, [esperado], `limite ${String(limite)}`)
    }
  })
})

describe('ciclo Anthropic', () => {
  it('texto simple: una sola llamada con prompt, herramientas, tope de tokens y cabeceras del proveedor', async () => {
    const { res, r, json } = await llamar({ respuestas: [textoAnthropic('Hola, ¿en qué te ayudo?')] })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Hola, ¿en qué te ayudo?' })
    assert.equal(r.pedidos.length, 1)
    assert.equal(r.pedidos[0].url, 'https://api.anthropic.com/v1/messages')
    assert.equal(r.pedidos[0].init.headers['x-api-key'], 'clave-proveedor-secreta')
    const cuerpo = cuerpoProveedor(r)
    assert.equal(cuerpo.model, 'modelo-x')
    assert.equal(cuerpo.max_tokens, MAX_TOKENS_RESPUESTA)
    assert.equal(cuerpo.system, 'PROMPT-DE-PRUEBA')
    assert.deepEqual(cuerpo.tools.map((t: { name: string }) => t.name), ['leer', 'ejecutar'])
    assert.deepEqual(cuerpo.messages, [{ role: 'user', content: 'hola' }])
  })

  it('respuesta sin bloque de texto usa el mensaje por defecto', async () => {
    const { json } = await llamar({ respuestas: [{ stop_reason: 'end_turn', content: [] }] })
    assert.equal(json?.respuesta, SIN_RESPUESTA)
  })

  it('tool_use de leer: ejecuta la consulta con el cliente del usuario y manda el resultado marcado como no confiable', async () => {
    const { res, r, json } = await llamar({
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock', filtros: { sku: 'A' } } }), textoAnthropic('Hay stock')],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Hay stock' })
    assert.equal(r.pedidos.length, 2)
    const consulta = r.consultas.find((c) => c.tabla === 'v_stock')!
    assert.deepEqual(consulta.ops, [['select', '*'], ['limit', 51], ['eq', 'sku', 'A']])
    assert.deepEqual(r.rpcUsuario.find(([n]) => n === 'puede_chat_leer_funcionalidad'), ['puede_chat_leer_funcionalidad', { p_feature_id: 'inventario' }])
    const seg = cuerpoProveedor(r, 1)
    assert.equal(seg.messages.length, 3)
    assert.equal(seg.messages[1].role, 'assistant')
    assert.equal(seg.messages[2].role, 'user')
    const tr = seg.messages[2].content[0]
    assert.equal(tr.type, 'tool_result')
    assert.equal(tr.tool_use_id, 't1')
    assert.match(tr.content, /DATO externo no confiable/)
    assert.match(tr.content, /"sku":"A"/)
    // sanitizarDato quita columnas con nombre de secreto antes de que salgan hacia el tercero.
    assert.doesNotMatch(tr.content, /secreto-fila|token/)
  })

  it('resuelve todas las herramientas del turno, con un tool_result por cada tool_use y un tope por turno', async () => {
    const bloques = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, name: 'leer', input: { vista: 'v_stock' } }))
    const { r } = await llamar({ respuestas: [usoAnthropic(...bloques), textoAnthropic('fin')] })
    const resultados = cuerpoProveedor(r, 1).messages[2].content
    assert.deepEqual(resultados.map((x: { tool_use_id: string }) => x.tool_use_id), ['t0', 't1', 't2', 't3', 't4'])
    assert.match(resultados[4].content, /DEMASIADAS_HERRAMIENTAS_EN_UN_TURNO/)
    assert.equal(r.consultas.filter((c) => c.tabla === 'v_stock').length, 4)
  })

  it('ejecutar crea una propuesta por RPC como el usuario, responde propuesta:true y NO guarda mensaje ni llama de nuevo al proveedor', async () => {
    const { res, r, json } = await llamar({
      respuestas: [usoAnthropic({ id: 't1', name: 'ejecutar', input: { rpc: 'ajustar_stock', parametros: { sku: 'A' }, descripcion: 'Ajustar' } })],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, propuesta: true })
    assert.equal(r.pedidos.length, 1)
    const [nombre, args] = r.rpcUsuario.find(([n]) => n === 'proponer_accion_chat_ia')! as [string, Record<string, unknown>]
    assert.equal(nombre, 'proponer_accion_chat_ia')
    assert.equal(args.p_conversacion_id, CONV)
    assert.equal(args.p_rpc, 'ajustar_stock')
    assert.deepEqual(args.p_parametros, { sku: 'A' })
    assert.match(String(args.p_descripcion), /^Acción: ajustar_stock\nParámetros: {"sku":"A"}\nDescripción del asistente \(no verificada\): Ajustar$/)
    assert.deepEqual(r.rpcAdmin.map(([n]) => n), ['resolver_politica_ia', 'obtener_clave_perfil_ia', 'consumir_cupo_ia'])
    assert.deepEqual(mensajesGuardados(r), [{ conversacion_id: CONV, origen: 'usuario', contenido: 'hola' }])
  })

  it('ejecutar rechazado por la RPC (o sin rpc/descripcion) guarda y devuelve el rechazo, sin segunda llamada', async () => {
    for (const [input, propuesta] of [
      [{ rpc: 'x', descripcion: 'd' }, { data: { propuesta: false }, error: null }],
      [{ rpc: 'x', descripcion: 'd' }, { data: null, error: { message: 'no' } }],
      [{ descripcion: 'd' }, { data: { propuesta: true }, error: null }],
      [{ rpc: 'x' }, { data: { propuesta: true }, error: null }],
    ] as Array<[Record<string, unknown>, { data: unknown; error: unknown }]>) {
      const { res, r, json } = await llamar({ propuesta, respuestas: [usoAnthropic({ id: 't1', name: 'ejecutar', input })] })
      assert.equal(res.status, 200)
      assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Esa acción no está disponible para tu organización.' })
      assert.equal(r.pedidos.length, 1)
      assert.equal(mensajesGuardados(r).at(-1)?.contenido, 'Esa acción no está disponible para tu organización.')
    }
  })

  it('leer devuelve errores fijos: fuente inexistente, sin permiso, filtros inválidos, error de lectura y herramienta desconocida', async () => {
    const casos: Array<[Opciones, Record<string, unknown>, string, string]> = [
      [{ fuente: null }, { vista: 'v' }, 'leer', 'FUENTE_NO_DISPONIBLE'],
      [{ puedeLeer: false }, { vista: 'v' }, 'leer', 'FUENTE_NO_DISPONIBLE'],
      [{}, { vista: 'v', filtros: { 'a;b': 1 } }, 'leer', 'FILTROS_INVALIDOS'],
      [{ filas: { data: null, error: { message: 'detalle-db' } } }, { vista: 'v' }, 'leer', 'ERROR_AL_LEER'],
      [{}, {}, 'leer', 'FUENTE_NO_DISPONIBLE'],
      [{}, {}, 'borrar', 'HERRAMIENTA_DESCONOCIDA'],
    ]
    for (const [opciones, input, name, codigo] of casos) {
      const { r } = await llamar({ ...opciones, respuestas: [usoAnthropic({ id: 't1', name, input }), textoAnthropic('fin')] })
      const contenido = cuerpoProveedor(r, 1).messages[2].content[0].content as string
      assert.match(contenido, new RegExp(codigo), codigo)
      assert.doesNotMatch(contenido, /detalle-db/)
    }
  })

  it('leer pide solo las columnas permitidas de fuentes_chat_ia.columnas y consulta ese campo', async () => {
    const { r } = await llamar({
      fuente: { data: { feature_id: 'inventario', columnas: ['sku', 'stock_disponible'] }, error: null },
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock', filtros: { sku: 'A' } } }), textoAnthropic('fin')],
    })
    assert.deepEqual(r.consultas.find((c) => c.tabla === 'fuentes_chat_ia')!.ops[0], ['select', 'feature_id, columnas'])
    assert.deepEqual(r.consultas.find((c) => c.tabla === 'v_stock')!.ops, [['select', 'sku,stock_disponible'], ['limit', 51], ['eq', 'sku', 'A']])
  })

  it('leer con columnas definidas admite filtros solo sobre columnas permitidas', async () => {
    const { r } = await llamar({
      fuente: { data: { feature_id: 'inventario', columnas: ['sku', 'nombre'] }, error: null },
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock', filtros: { sku: 'A', nombre: 'x' } } }), textoAnthropic('fin')],
    })
    assert.deepEqual(r.consultas.find((c) => c.tabla === 'v_stock')!.ops, [['select', 'sku,nombre'], ['limit', 51], ['eq', 'sku', 'A'], ['eq', 'nombre', 'x']])
  })

  it('leer con columnas definidas rechaza filtros sobre una columna no autorizada sin consultar la vista (no es un oráculo)', async () => {
    const { r } = await llamar({
      fuente: { data: { feature_id: 'inventario', columnas: ['sku'] }, error: null },
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock', filtros: { sku: 'A', costo: 10 } } }), textoAnthropic('fin')],
    })
    assert.match(cuerpoProveedor(r, 1).messages[2].content[0].content as string, /FILTROS_INVALIDOS/)
    assert.equal(r.consultas.some((c) => c.tabla === 'v_stock'), false)
  })

  it('leer con columnas NULL admite cualquier filtro válido (comportamiento anterior)', async () => {
    const { r } = await llamar({
      fuente: { data: { feature_id: 'inventario', columnas: null }, error: null },
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock', filtros: { costo: 10 } } }), textoAnthropic('fin')],
    })
    assert.deepEqual(r.consultas.find((c) => c.tabla === 'v_stock')!.ops, [['select', '*'], ['limit', 51], ['eq', 'costo', 10]])
  })

  it('leer con columnas NULL conserva select * (fuentes existentes)', async () => {
    const { r } = await llamar({
      fuente: { data: { feature_id: 'inventario', columnas: null }, error: null },
      respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock' } }), textoAnthropic('fin')],
    })
    assert.deepEqual(r.consultas.find((c) => c.tabla === 'v_stock')!.ops[0], ['select', '*'])
  })

  it('leer con columnas inválidas falla cerrado sin consultar la vista', async () => {
    for (const columnas of [[], ['sku;drop table x'], 'sku', ['*']]) {
      const { r } = await llamar({
        fuente: { data: { feature_id: 'inventario', columnas }, error: null },
        respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v_stock' } }), textoAnthropic('fin')],
      })
      assert.match(cuerpoProveedor(r, 1).messages[2].content[0].content as string, /FUENTE_NO_DISPONIBLE/, JSON.stringify(columnas))
      assert.equal(r.consultas.some((c) => c.tabla === 'v_stock'), false)
    }
  })

  it('leer acota las filas al tope y avisa al modelo', async () => {
    const filas = Array.from({ length: 51 }, (_, i) => ({ n: i }))
    const { r } = await llamar({ filas: { data: filas, error: null }, respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v' } }), textoAnthropic('fin')] })
    const contenido = cuerpoProveedor(r, 1).messages[2].content[0].content as string
    assert.match(contenido, /"truncado":true/)
    assert.match(contenido, /Hay más de 50 resultados/)
    assert.equal((contenido.match(/"n":/g) ?? []).length, 50)
  })

  it('un stop_reason tool_use sin bloques tool_use cae al texto final', async () => {
    const { json, r } = await llamar({ respuestas: [{ stop_reason: 'tool_use', content: [{ type: 'text', text: 'solo texto' }] }] })
    assert.equal(json?.respuesta, 'solo texto')
    assert.equal(r.pedidos.length, 1)
  })

  it('un solo ciclo de herramientas: una segunda petición de herramienta no se vuelve a resolver', async () => {
    const { json, r } = await llamar({ respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v' } }), usoAnthropic({ id: 't2', name: 'leer', input: { vista: 'v' } })] })
    assert.equal(r.pedidos.length, 2)
    assert.equal(json?.respuesta, 'pienso')
  })

  it('un error HTTP o de red del proveedor responde 502 con mensaje fijo, guarda fallida y no filtra la clave ni el detalle', async () => {
    const fallos: unknown[] = [{ ok: false, status: 500 }, new Error('ECONNRESET clave-proveedor-secreta')]
    for (const fallo of fallos) {
      const { res, json, r } = await llamar({ respuestas: [fallo] })
      assert.equal(res.status, 502)
      assert.deepEqual(json, { conversacion_id: CONV, error: ERROR_PROVEEDOR })
      assert.deepEqual(mensajesGuardados(r).at(-1), { conversacion_id: CONV, origen: 'chat', contenido: ERROR_PROVEEDOR, estado: 'fallida' })
      assert.doesNotMatch(JSON.stringify(json), /clave-proveedor-secreta|ECONNRESET/)
    }
  })

  it('un timeout del proveedor (primera o segunda llamada) responde 504 con mensaje claro, guarda fallida y no filtra detalle', async () => {
    const timeout = () => new DOMException('The operation was aborted due to timeout clave-proveedor-secreta', 'TimeoutError')
    for (const respuestas of [[timeout()], [new Error('INVOCACION_PROVEEDOR_IA_TIMEOUT')], [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v' } }), timeout()]]) {
      const { res, json, r } = await llamar({ respuestas })
      assert.equal(res.status, 504)
      assert.deepEqual(json, { conversacion_id: CONV, error: ERROR_TIMEOUT })
      assert.deepEqual(mensajesGuardados(r).at(-1), { conversacion_id: CONV, origen: 'chat', contenido: ERROR_TIMEOUT, estado: 'fallida' })
      assert.doesNotMatch(JSON.stringify(json), /clave-proveedor-secreta/)
    }
  })

  it('un fallo del proveedor en la segunda llamada también responde 502', async () => {
    const { res, json } = await llamar({ respuestas: [usoAnthropic({ id: 't1', name: 'leer', input: { vista: 'v' } }), { ok: false, status: 429 }] })
    assert.equal(res.status, 502)
    assert.equal(json?.error, ERROR_PROVEEDOR)
  })

  it('si no se puede guardar el mensaje de error igual se responde con el status del error', async () => {
    const { res } = await llamar({ insertFallida: { message: 'rls' }, respuestas: [new Error('x')] })
    assert.equal(res.status, 502)
  })

  it('una respuesta con forma inesperada (sin content) cae al 500 genérico, sin filtrar detalles', async () => {
    const { res, json } = await llamar({ respuestas: [{ stop_reason: 'end_turn' }] })
    assert.equal(res.status, 500)
    assert.deepEqual(json, { error: 'No se pudo procesar el mensaje.' })
    assert.equal(errores.length, 1)
  })

  it('si falla guardar la respuesta final responde 500 con conversacion_id', async () => {
    const { res, json } = await llamar({ insertChat: { message: 'rls' }, respuestas: [textoAnthropic('ok')] })
    assert.equal(res.status, 500)
    assert.deepEqual(json, { conversacion_id: CONV, error: 'No se pudo guardar la respuesta del chat.' })
  })
})

describe('ciclo OpenAI', () => {
  it('texto simple: prompt de sistema como mensaje, herramientas envueltas y cabecera Bearer', async () => {
    const { res, r, json } = await llamar({ adaptador: 'openai', respuestas: [textoOpenAI('Hola')] })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Hola' })
    assert.equal(r.pedidos[0].url, 'https://api.openai.com/v1/chat/completions')
    assert.equal(r.pedidos[0].init.headers.Authorization, 'Bearer clave-proveedor-secreta')
    const cuerpo = cuerpoProveedor(r)
    assert.equal(cuerpo.system, undefined)
    assert.equal(cuerpo.max_tokens, MAX_TOKENS_RESPUESTA)
    assert.deepEqual(cuerpo.messages, [{ role: 'system', content: 'PROMPT-DE-PRUEBA' }, { role: 'user', content: 'hola' }])
    assert.deepEqual(cuerpo.tools.map((t: { type: string; function: { name: string } }) => [t.type, t.function.name]), [['function', 'leer'], ['function', 'ejecutar']])
    assert.ok(cuerpo.tools[0].function.parameters)
  })

  it('contenido nulo o sin choices usa el mensaje por defecto', async () => {
    assert.equal((await llamar({ adaptador: 'openai', respuestas: [textoOpenAI(null)] })).json?.respuesta, SIN_RESPUESTA)
    assert.equal((await llamar({ adaptador: 'openai', respuestas: [{ choices: [] }] })).json?.respuesta, SIN_RESPUESTA)
  })

  it('tool_calls de leer: devuelve mensajes role tool con el resultado marcado y vuelve a llamar', async () => {
    const { r, json } = await llamar({
      adaptador: 'openai',
      respuestas: [usoOpenAI({ id: 'c1', name: 'leer', arguments: '{"vista":"v_stock","filtros":{"sku":"A"}}' }, { id: 'c2', name: 'leer', arguments: '{"vista":"v_stock"}' }), textoOpenAI('Hay stock')],
    })
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Hay stock' })
    const msgs = cuerpoProveedor(r, 1).messages
    assert.deepEqual(msgs.map((m: { role: string }) => m.role), ['system', 'user', 'assistant', 'tool', 'tool'])
    assert.equal(msgs[2].content, null)
    assert.equal(msgs[2].tool_calls.length, 2)
    assert.deepEqual(msgs.slice(3).map((m: { tool_call_id: string }) => m.tool_call_id), ['c1', 'c2'])
    assert.match(msgs[3].content, /DATO externo no confiable/)
    assert.doesNotMatch(msgs[3].content, /secreto-fila/)
  })

  it('argumentos inválidos, no objeto o arreglo se tratan como {} (leer sin vista)', async () => {
    for (const args of ['no json', '"texto"', '[1]', 'null']) {
      const { r } = await llamar({ adaptador: 'openai', respuestas: [usoOpenAI({ id: 'c1', name: 'leer', arguments: args }), textoOpenAI('fin')] })
      assert.match(cuerpoProveedor(r, 1).messages[3].content, /FUENTE_NO_DISPONIBLE/, args)
    }
  })

  it('ejecutar crea la propuesta como el usuario y responde propuesta:true', async () => {
    const { res, r, json } = await llamar({
      adaptador: 'openai',
      respuestas: [usoOpenAI({ id: 'c1', name: 'ejecutar', arguments: '{"rpc":"ajustar_stock","parametros":{"sku":"A"},"descripcion":"Ajustar"}' })],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(json, { conversacion_id: CONV, propuesta: true })
    assert.equal(r.pedidos.length, 1)
    assert.equal((r.rpcUsuario.find(([n]) => n === 'proponer_accion_chat_ia')![1] as Record<string, unknown>).p_rpc, 'ajustar_stock')
  })

  it('ejecutar rechazado guarda y devuelve el rechazo', async () => {
    const { json, r } = await llamar({ adaptador: 'openai', propuesta: { data: { propuesta: false }, error: null }, respuestas: [usoOpenAI({ id: 'c1', name: 'ejecutar', arguments: '{"rpc":"x","descripcion":"d"}' })] })
    assert.deepEqual(json, { conversacion_id: CONV, respuesta: 'Esa acción no está disponible para tu organización.' })
    assert.equal(mensajesGuardados(r).at(-1)?.contenido, 'Esa acción no está disponible para tu organización.')
  })

  it('errores del proveedor (HTTP, red) responden 502 fijo sin filtrar secretos', async () => {
    for (const fallo of [{ ok: false, status: 401 }, new Error('boom clave-proveedor-secreta')]) {
      const { res, json, r } = await llamar({ adaptador: 'openai', respuestas: [fallo] })
      assert.equal(res.status, 502)
      assert.deepEqual(json, { conversacion_id: CONV, error: ERROR_PROVEEDOR })
      assert.equal(mensajesGuardados(r).at(-1)?.estado, 'fallida')
      assert.doesNotMatch(JSON.stringify(json), /clave-proveedor-secreta/)
    }
  })

  it('un timeout del proveedor responde 504 en la primera y en la segunda llamada', async () => {
    const timeout = () => new DOMException('timeout', 'TimeoutError')
    for (const respuestas of [[timeout()], [usoOpenAI({ id: 'c1', name: 'leer', arguments: '{"vista":"v"}' }), timeout()]]) {
      const { res, json } = await llamar({ adaptador: 'openai', respuestas })
      assert.equal(res.status, 504)
      assert.deepEqual(json, { conversacion_id: CONV, error: ERROR_TIMEOUT })
    }
  })

  it('un fallo en la segunda llamada responde 502', async () => {
    const { res } = await llamar({ adaptador: 'openai', respuestas: [usoOpenAI({ id: 'c1', name: 'leer', arguments: '{"vista":"v"}' }), new Error('x')] })
    assert.equal(res.status, 502)
  })

  it('si falla guardar la respuesta final responde 500', async () => {
    const { res, json } = await llamar({ adaptador: 'openai', insertChat: { message: 'rls' }, respuestas: [textoOpenAI('ok')] })
    assert.equal(res.status, 500)
    assert.deepEqual(json, { conversacion_id: CONV, error: 'No se pudo guardar la respuesta del chat.' })
  })
})

describe('cableado de index.ts', () => {
  // index.ts corre en Deno y no se puede importar acá: se fija por texto qué cliente se usa para qué.
  const fuente = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  // Falla con un mensaje claro si falta un ancla (slice con índice -1 devolvería texto equivocado sin avisar).
  const bloque = (desde: string, hasta: string) => {
    const i = fuente.indexOf(desde)
    assert.ok(i >= 0, `index.ts: falta el ancla «${desde}»`)
    const j = fuente.indexOf(hasta, i + 1)
    assert.ok(j > i, `index.ts: falta el ancla «${hasta}» después de «${desde}»`)
    return fuente.slice(i, j)
  }
  // Bloque `deps` completo; cada propiedad se busca por regex dentro de él, sin depender del orden.
  const deps = (() => {
    const m = /const deps: Deps = \{([\s\S]*?)\n  \}\n/.exec(fuente)
    assert.ok(m, 'index.ts: falta el bloque `const deps: Deps = { ... }`')
    return m[1]
  })()

  it('la service-role solo aparece en el cliente admin; el cliente del usuario usa anon + el JWT', () => {
    assert.equal((fuente.match(/SERVICE_ROLE/g) ?? []).length, 1)
    assert.match(bloque('crearAdmin:', 'crearCliente:'), /SUPABASE_SERVICE_ROLE_KEY/)
    const usuario = bloque('crearCliente:', 'prepararInvocacion,')
    assert.match(usuario, /SUPABASE_ANON_KEY/)
    assert.match(usuario, /Authorization: `Bearer \$\{jwt\}`/)
    assert.doesNotMatch(usuario, /SERVICE_ROLE/)
  })

  it('las variables de entorno se leen dentro de los closures y el prompt de sistema sigue siendo configurable', () => {
    assert.match(fuente, /limiteHora: \(\) => Deno\.env\.get\('CHAT_IA_LIMITE_HORA'\)/)
    assert.match(fuente, /const SYSTEM_PROMPT = Deno\.env\.get\('CHAT_COMPANION_SYSTEM_PROMPT'\)/)
    assert.match(fuente, /fetchProveedor: \(limiteSegundos\) => fetchConTimeout\(limiteSegundos\)/)
  })

  it('deps pasa el prepararInvocacion real, el reloj real y el prompt configurable, y se delega en manejar', () => {
    assert.match(deps, /^\s+prepararInvocacion,\s*$/m)
    assert.match(deps, /^\s+ahora: \(\) => Date\.now\(\),\s*$/m)
    assert.match(deps, /^\s+systemPrompt: SYSTEM_PROMPT,\s*$/m)
    assert.match(fuente, /^import \{ prepararInvocacion \} from '\.\.\/_shared\/ia\/index\.ts'$/m)
    assert.match(fuente, /^\s+return manejar\(req, deps\)\s*$/m)
  })

  it('handler.ts no lee entorno ni crea clientes, y las acciones solo se proponen por RPC del usuario', () => {
    const handler = readFileSync(new URL('./handler.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(handler, /Deno\.|createClient|SERVICE_ROLE|process\.env/)
    // El admin solo resuelve política y credencial; todo lo demás sale de asUser.
    assert.deepEqual([...handler.matchAll(/admin\.(\w+)/g)].map((m) => m[1]).sort(), ['auth', 'rpc', 'rpc'])
    assert.match(handler, /asUser\.rpc\('proponer_accion_chat_ia'/)
    assert.equal(/admin\.from/.test(handler), false)
    assert.equal(/\.rpc\('ejecutar_accion_chat_ia/.test(handler), false)
  })
})
