// Pruebas de `indexar-documento` con dependencias simuladas: `node --test supabase/functions/indexar-documento/handler.test.ts`
// (pnpm test:edge:indexar-documento). El handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RechazoCupo } from '../_shared/cupo-ia.ts'
import { manejar, type Deps, type VersionDoc } from './handler.ts'
import { MAX_FRAGMENTOS, fragmentarTexto, reclamoVigente, nuevoReclamo } from './reglas.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const AHORA = 1_800_000_000_000

// Base en memoria con la semántica real: reclamar es compare-and-swap, marcarFallida solo actúa sobre `procesando`.
function montar(opciones: { texto?: string | null; embeddingsFalla?: boolean; activarFalla?: boolean; descargaFalla?: boolean; activarPermiso?: boolean; version?: Partial<VersionDoc>; featureApagada?: boolean; contextoNull?: boolean; superadmin?: boolean; activarInvalida?: boolean; estadoTrasInvalida?: string | null; activarLaOtra?: boolean; soltarFalla?: boolean; marcarFalla?: boolean; versionAjena?: boolean; rol?: string; sinPermisoEscritura?: boolean; cupo?: RechazoCupo | null } = {}) {
  const orden: string[] = []
  const cupos: string[] = []
  const v: VersionDoc = { subida_por: 'u1', id: ID, estado: 'procesando', motivo_error: null, storage_path: 'o/a.txt', nombre: 'a.txt', organizacion_id: 'org-1', ...opciones.version }
  let fragmentos = 0
  let insertados = 0
  const deps: Deps = {
    getUser: async (jwt) => jwt === 'ok' ? { id: 'u1' } : null,
    feature: async () => ({ data: !opciones.featureApagada, error: null }),
    puedeGestionar: async () => opciones.sinPermisoEscritura !== true,
    contexto: async () => opciones.contextoNull ? null : ({ organizacion_id: 'org-1', rol_efectivo: opciones.rol ?? 'miembro', es_superadmin: opciones.superadmin ?? false }),
    version: async () => opciones.versionAjena ? null : ({ ...v }),
    reclamar: async (_j, _id, previo, reclamo) => {
      if (v.estado !== 'procesando' || v.motivo_error !== previo) return false
      v.motivo_error = reclamo
      return true
    },
    soltar: async (_j, _id, reclamo) => {
      if (opciones.soltarFalla) throw new Error('soltar: boom')
      if (v.estado === 'procesando' && v.motivo_error === reclamo) v.motivo_error = null },
    marcarFallida: async (_j, _id, motivo, reclamo) => {
      if (opciones.activarLaOtra) { v.estado = 'activa'; return false }
      if (opciones.marcarFalla) return false
      if (v.estado === 'procesando' && v.motivo_error === reclamo) { v.estado = 'fallida'; v.motivo_error = motivo; return true }
      return false
    },
    estado: async () => (opciones.estadoTrasInvalida !== undefined && opciones.activarInvalida ? opciones.estadoTrasInvalida : v.estado),
    descargar: async () => opciones.descargaFalla ? null : new Uint8Array([1]),
    extraerTexto: async () => opciones.texto === undefined ? 'hola mundo '.repeat(50) : opciones.texto,
    politica: async () => ({ politica_id: 'p', contrato_id: 'c', perfil_principal_id: 'pf', limite_intentos: 1, limite_segundos: 60, perfil_fallback_id: null }),
    credencial: async () => ({ clave: 'k', proveedor_codigo: 'openai' }),
    validarEntrada: () => undefined,
    consumirCupo: async (usuarioId) => { orden.push('cupo'); cupos.push(usuarioId); return opciones.cupo ?? null },
    embeddings: async (textos) => { orden.push('embeddings'); if (opciones.embeddingsFalla) throw new Error('openai caído'); return textos.map(() => [0.1]) },
    borrarFragmentos: async () => { fragmentos = 0; return true },
    insertarFragmentos: async (_j, filas, reclamo) => { if (!reclamo) throw new Error('falta el reclamo propio'); fragmentos += filas.length; insertados += filas.length; return true },
    activar: async () => {
      if (opciones.activarInvalida) return 'invalida'
      if (opciones.activarPermiso) return 'permiso'
      if (opciones.activarFalla) return 'error'
      if (v.estado !== 'procesando') return 'error'
      v.estado = 'activa'
      return 'ok'
    },
    ahora: () => AHORA,
    id: () => 'abc',
  }
  return { deps, v, orden, cupos, fragmentosGuardados: () => fragmentos, insertados: () => insertados }
}

const pedir = (deps: Deps, body: unknown = { version_id: ID }, jwt: string | null = 'ok') =>
  manejar(new Request('http://x/', { method: 'POST', headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(body) }), deps)

describe('indexar-documento', () => {
  it('indexa y activa la versión', async () => {
    const m = montar()
    const res = await pedir(m.deps)
    assert.equal(res.status, 200)
    assert.equal(m.v.estado, 'activa')
    assert.ok(m.fragmentosGuardados() > 0)
  })

  it('dos invocaciones simultáneas: la segunda recibe 409 y la versión activa no queda fallida ni duplicada', async () => {
    const m = montar()
    const [a, b] = await Promise.all([pedir(m.deps), pedir(m.deps)])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal(m.v.estado, 'activa')
    assert.equal(m.insertados(), m.fragmentosGuardados())
  })

  it('una versión ya activa no se vuelve a procesar ni se marca fallida', async () => {
    const m = montar({ version: { estado: 'activa' } })
    assert.equal((await pedir(m.deps)).status, 409)
    assert.equal(m.v.estado, 'activa')
  })

  it('un reclamo abandonado (vencido) se puede retomar; uno vigente no', async () => {
    const vencido = montar({ version: { motivo_error: nuevoReclamo(AHORA - 11 * 60_000, 'x') } })
    assert.equal((await pedir(vencido.deps)).status, 200)
    const vigente = montar({ version: { motivo_error: nuevoReclamo(AHORA - 60_000, 'x') } })
    assert.equal((await pedir(vigente.deps)).status, 409)
  })

  it('un fallo transitorio del proveedor deja la versión reintentable y el reintento funciona', async () => {
    const m = montar({ embeddingsFalla: true })
    const res = await pedir(m.deps)
    assert.equal(res.status, 502)
    assert.equal(m.v.estado, 'procesando')
    assert.equal(m.v.motivo_error, null)
    assert.equal(m.fragmentosGuardados(), 0)
    const reintento = montar()
    assert.equal((await pedir(reintento.deps)).status, 200)
  })

  it('una descarga fallida también es reintentable', async () => {
    const m = montar({ descargaFalla: true })
    assert.equal((await pedir(m.deps)).status, 502)
    assert.equal(m.v.estado, 'procesando')
  })

  it('un documento sin texto queda fallida con un mensaje claro', async () => {
    const m = montar({ texto: '   ' })
    const res = await pedir(m.deps)
    assert.equal(res.status, 422)
    assert.equal(m.v.estado, 'fallida')
  })

  it('un documento con demasiados fragmentos queda fallida sin llamar al proveedor', async () => {
    const m = montar({ texto: 'palabra '.repeat(400_000) })
    let llamadas = 0
    const original = m.deps.embeddings
    m.deps.embeddings = async (t, k) => { llamadas++; return original(t, k) }
    const res = await pedir(m.deps)
    assert.equal(res.status, 422)
    assert.match((await res.json() as { error: string }).error, new RegExp(String(MAX_FRAGMENTOS)))
    assert.equal(llamadas, 0)
    assert.equal(m.v.estado, 'fallida')
  })

  it('si activar falla porque otra invocación ya la activó, responde éxito sin marcar fallida', async () => {
    const m = montar()
    m.deps.activar = async () => { m.v.estado = 'activa'; return 'error' }
    const res = await pedir(m.deps)
    assert.equal(res.status, 200)
    assert.equal(m.v.estado, 'activa')
  })

  it('un rechazo de permisos al activar (42501) deja la versión fallida con un 403 claro, no procesando colgada', async () => {
    const m = montar({ activarPermiso: true })
    const res = await pedir(m.deps)
    assert.equal(res.status, 403)
    assert.equal(m.v.estado, 'fallida')
    assert.match(m.v.motivo_error ?? '', /permiso/)
    assert.equal(m.fragmentosGuardados(), 0)
  })

  it('un fallo transitorio al activar sí queda reintentable', async () => {
    const m = montar({ activarFalla: true })
    assert.equal((await pedir(m.deps)).status, 502)
    assert.equal(m.v.estado, 'procesando')
    assert.equal(m.v.motivo_error, null)
  })

  describe('autorización previa', () => {
    // Espías sobre todo lo costoso o destructivo: ninguna debe ejecutarse si la autorización falla.
    function espiar(m: ReturnType<typeof montar>) {
      const llamadas: string[] = []
      for (const nombre of ['reclamar', 'descargar', 'embeddings', 'borrarFragmentos', 'insertarFragmentos', 'marcarFallida', 'soltar', 'activar'] as const) {
        const original = m.deps[nombre] as (...a: unknown[]) => unknown
        ;(m.deps as Record<string, unknown>)[nombre] = (...a: unknown[]) => { llamadas.push(nombre); return original(...a) }
      }
      return llamadas
    }
    const sinPermiso = { error: 'No tenés permiso para indexar este documento.' }

    it('un miembro que no subió la versión ni es administrador recibe 403 y no se hace nada costoso ni destructivo', async () => {
      const m = montar({ version: { subida_por: 'otro-usuario' } })
      const llamadas = espiar(m)
      const res = await pedir(m.deps)
      assert.equal(res.status, 403)
      assert.deepEqual(await res.json(), sinPermiso)
      assert.deepEqual(llamadas, [])
      assert.equal(m.v.estado, 'procesando')
      assert.equal(m.v.motivo_error, null)
    })

    it('versión inexistente o de otra organización: el MISMO 403, sin revelar existencia', async () => {
      const ajena = montar({ versionAjena: true })
      const llamadas = espiar(ajena)
      const res = await pedir(ajena.deps)
      assert.equal(res.status, 403)
      assert.deepEqual(await res.json(), sinPermiso)
      assert.deepEqual(llamadas, [])
    })

    it('un administrador de esa organización que no subió la versión sí la indexa', async () => {
      const m = montar({ version: { subida_por: 'otro-usuario' }, rol: 'administrador' })
      assert.equal((await pedir(m.deps)).status, 200)
      assert.equal(m.v.estado, 'activa')
    })

    it('un administrador de OTRA organización no pasa', async () => {
      const m = montar({ version: { subida_por: 'otro-usuario', organizacion_id: 'org-2' }, rol: 'administrador' })
      assert.equal((await pedir(m.deps)).status, 403)
      assert.equal(m.v.estado, 'procesando')
    })

    it('un superadmin que además es administrador real queda fuera (criterio conservador intencional)', async () => {
      const m = montar({ version: { subida_por: 'otro-usuario' }, rol: 'administrador', superadmin: true })
      assert.equal((await pedir(m.deps)).status, 403)
      assert.equal(m.v.estado, 'procesando')
    })

    it('sin contexto (error del RPC): quien no subió recibe 503 fail-closed; quien subió sigue', async () => {
      const ajeno = montar({ version: { subida_por: 'otro-usuario' }, contextoNull: true })
      const llamadas = espiar(ajeno)
      assert.equal((await pedir(ajeno.deps)).status, 503)
      assert.deepEqual(llamadas, [])
      assert.equal((await pedir(montar({ contextoNull: true }).deps)).status, 200)
    })

    it('el 403 de sin permiso, de funcionalidad apagada y de versión inexistente tienen el mismo cuerpo', async () => {
      const cuerpos = await Promise.all([
        montar({ version: { subida_por: 'otro-usuario' } }),
        montar({ featureApagada: true }),
        montar({ versionAjena: true }),
      ].map(async (m) => await (await pedir(m.deps)).text()))
      assert.equal(new Set(cuerpos).size, 1)
    })

    it('quien subió la versión la indexa', async () => {
      assert.equal((await pedir(montar().deps)).status, 200)
    })

    it('con la funcionalidad apagada, 403 sin tocar nada; si no se puede verificar, 503', async () => {
      const apagada = montar({ featureApagada: true })
      const llamadas = espiar(apagada)
      assert.equal((await pedir(apagada.deps)).status, 403)
      assert.deepEqual(llamadas, [])
      const rota = montar()
      rota.deps.feature = async () => ({ data: null, error: { message: 'x' } })
      assert.equal((await pedir(rota.deps)).status, 503)
    })
  })

  it('22023 al activar (versión ya procesada, ajena o inexistente) es un 409 no reintentable, sin marcar fallida', async () => {
    const m = montar({ activarInvalida: true })
    const res = await pedir(m.deps)
    assert.equal(res.status, 409)
    assert.equal(m.v.estado, 'procesando')
    assert.equal(m.v.motivo_error, null)
  })

  it('22023: borra los fragmentos de este intento y responde 409 (o 404 si la versión ya no existe), sin reintento', async () => {
    const m = montar({ activarInvalida: true })
    assert.equal((await pedir(m.deps)).status, 409)
    assert.equal(m.fragmentosGuardados(), 0)
    const inexistente = montar({ activarInvalida: true })
    const leer = inexistente.deps.version
    let lecturas = 0
    inexistente.deps.version = async (...a) => (++lecturas > 2 ? null : leer(...a))
    assert.equal((await pedir(inexistente.deps)).status, 404)
  })

  it('22023 con la versión ya activa por otra invocación: 200 idempotente y NO borra fragmentos', async () => {
    const m = montar({ activarInvalida: true })
    const activar = m.deps.activar
    m.deps.activar = async (...a) => { const r = await activar(...a); m.v.estado = 'activa'; return r }
    let borrados = 0
    const original = m.deps.borrarFragmentos
    m.deps.borrarFragmentos = async (...a) => { borrados++; return original(...a) }
    const antes = borrados
    const res = await pedir(m.deps)
    assert.equal(res.status, 200)
    assert.equal(borrados, antes + 1, 'solo el borrado previo a insertar; ninguno tras el 22023')
  })

  it('todo borrado de fragmentos lleva el reclamo propio (el SQL decide la propiedad en la misma transacción)', async () => {
    const m = montar({ embeddingsFalla: true })
    const reclamos: string[] = []
    m.deps.borrarFragmentos = async (_j, _id, reclamo) => { reclamos.push(reclamo); return true }
    await pedir(m.deps)
    assert.ok(reclamos.length > 0)
    assert.ok(reclamos.every((r) => r === m.v.motivo_error || r.startsWith('indexando:')), `reclamos: ${reclamos}`)
    const ok = montar()
    const vistos: string[] = []
    ok.deps.borrarFragmentos = async (_j, _id, reclamo) => { vistos.push(reclamo); return true }
    await pedir(ok.deps)
    assert.deepEqual(vistos.map((r) => r.startsWith('indexando:')), [true])
  })

  it('si otra invocación retomó la versión (reclamo distinto), no se borran sus fragmentos y se responde ocupado', async () => {
    const m = montar({ embeddingsFalla: true })
    const embeddings = m.deps.embeddings
    m.deps.embeddings = async (...a) => { m.v.motivo_error = 'indexando:otra'; return embeddings(...a) }
    let borrados = 0
    const original = m.deps.borrarFragmentos
    m.deps.borrarFragmentos = async (...a) => { borrados++; return original(...a) }
    await pedir(m.deps)
    assert.equal(borrados, 0)
    assert.equal(m.v.motivo_error, 'indexando:otra')
  })

  it('si borrarFragmentos lanza en una rama reintentable, el candado se suelta igual', async () => {
    const m = montar({ embeddingsFalla: true })
    m.deps.borrarFragmentos = async () => { throw new Error('boom') }
    const errores = console.error
    console.error = () => {}
    try {
      const res = await pedir(m.deps)
      assert.equal(res.status, 502)
    } finally { console.error = errores }
    assert.equal(m.v.motivo_error, null)
  })

  it('un rol de solo lectura que figura como autor recibe el MISMO 403 que una versión ajena, antes de reclamar', async () => {
    const consulta = montar({ sinPermisoEscritura: true })
    let reclamos = 0
    const reclamar = consulta.deps.reclamar
    consulta.deps.reclamar = async (...args) => { reclamos++; return reclamar(...args) }
    const res = await pedir(consulta.deps)
    assert.equal(res.status, 403)
    assert.equal(reclamos, 0, 'no llega a reclamar la versión')
    const ajena = await pedir(montar({ versionAjena: true }).deps)
    assert.deepEqual(await res.json(), await ajena.json())
    const ocupada = montar()
    ocupada.deps.reclamar = async () => false
    assert.equal((await pedir(ocupada.deps)).status, 409, 'con permiso, 0 filas sí es «ocupado»')
  })

  it('el 409 distingue el candado vigente (ocupado) de lo que ya no se puede procesar (no_procesable)', async () => {
    const ocupado = montar({ version: { motivo_error: nuevoReclamo(AHORA - 60_000, 'x') } })
    assert.equal(((await (await pedir(ocupado.deps)).json()) as { codigo: string }).codigo, 'ocupado')
    const invalida = montar({ activarInvalida: true })
    assert.equal(((await (await pedir(invalida.deps)).json()) as { codigo: string }).codigo, 'no_procesable')
    const procesada = montar({ version: { estado: 'reemplazada' } })
    assert.equal(((await (await pedir(procesada.deps)).json()) as { codigo: string }).codigo, 'no_procesable')
  })

  describe('invariante: nunca se borran fragmentos de una versión activa', () => {
    function contarBorrados(m: ReturnType<typeof montar>) {
      const c = { n: 0 }
      const original = m.deps.borrarFragmentos
      m.deps.borrarFragmentos = async (...a) => { c.n++; return original(...a) }
      return c
    }

    it('(a) la versión se activa durante el proveedor: 200 ya_activa y no se borra ni se inserta nada', async () => {
      const m = montar()
      const c = contarBorrados(m)
      const embeddings = m.deps.embeddings
      m.deps.embeddings = async (...a) => { const r = await embeddings(...a); m.v.estado = 'activa'; return r }
      const res = await pedir(m.deps)
      assert.equal(res.status, 200)
      assert.equal(((await res.json()) as { ya_activa?: boolean }).ya_activa, true)
      assert.equal(c.n, 0)
      assert.equal(m.insertados(), 0)
    })

    it('(b) activar devuelve invalida con la versión ya activa: 200 ya_activa y no se borra tras el 22023', async () => {
      const m = montar({ activarInvalida: true })
      const c = contarBorrados(m)
      // `estado()` ciego: aísla el guard basado en la relectura de la versión (el de `yaActiva` queda neutralizado).
      m.deps.estado = async () => 'procesando'
      const activar = m.deps.activar
      m.deps.activar = async (...a) => { const r = await activar(...a); m.v.estado = 'activa'; return r }
      const antes = m.insertados()
      const res = await pedir(m.deps)
      assert.equal(res.status, 200)
      assert.equal(c.n, 1, 'solo el borrado previo al insert; ninguno tras el 22023')
      assert.equal(m.insertados() - antes > 0, true)
    })

    it('(c) dejarFallida con la versión activa durante la extracción: 200 ya_activa, sin marcar ni borrar', async () => {
      const m = montar({ texto: '   ' })
      const c = contarBorrados(m)
      m.deps.estado = async () => 'procesando'
      const extraer = m.deps.extraerTexto
      m.deps.extraerTexto = async (...a) => { const r = await extraer(...a); m.v.estado = 'activa'; return r }
      const res = await pedir(m.deps)
      assert.equal(res.status, 200)
      assert.equal(m.v.estado, 'activa')
      assert.equal(c.n, 0)
    })
  })

  it('22023 con la versión procesando de OTRA invocación: no borra, suelta con el reclamo propio y responde 409', async () => {
    const m = montar({ activarInvalida: true })
    const soltados: string[] = []
    const soltar = m.deps.soltar
    m.deps.soltar = async (j, id, reclamo) => { soltados.push(reclamo); return soltar(j, id, reclamo) }
    const activar = m.deps.activar
    m.deps.activar = async (...a) => { const r = await activar(...a); m.v.motivo_error = 'indexando:otra'; return r }
    let borrados = 0
    const original = m.deps.borrarFragmentos
    m.deps.borrarFragmentos = async (...a) => { borrados++; return original(...a) }
    const res = await pedir(m.deps)
    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { codigo: string }).codigo, 'no_procesable', 'no es «ocupado»: reintentar repetiría el mismo 409')
    assert.equal(borrados, 1, 'solo el previo al insert')
    assert.equal(soltados.length, 1)
    assert.match(soltados[0], /^indexando:\d+:abc$/)
    assert.equal(m.v.motivo_error, 'indexando:otra', 'no libera el candado de la otra invocación')
  })

  it('si la versión desaparece justo antes del borrado previo al insert, responde 404 (no 409) sin gastar el insert', async () => {
    const m = montar()
    const leer = m.deps.version
    let lecturas = 0
    m.deps.version = async (...a) => (++lecturas >= 2 ? null : leer(...a))
    const res = await pedir(m.deps)
    assert.equal(res.status, 404)
    assert.equal(m.insertados(), 0)
  })

  it('marcarFallida recibe el reclamo propio; si otra invocación retomó la versión antes, no marca ni borra ni libera su candado', async () => {
    // El reclamo que se pasa es el que el handler escribió en la versión (no uno cualquiera).
    const propio = montar({ texto: '   ' })
    const recibidos: string[] = []
    const original = propio.deps.marcarFallida
    let reclamoVigente = ''
    const reclamar = propio.deps.reclamar
    propio.deps.reclamar = async (j, id, previo, reclamo) => { reclamoVigente = reclamo; return reclamar(j, id, previo, reclamo) }
    propio.deps.marcarFallida = async (j, id, motivo, reclamo) => { recibidos.push(reclamo); return original(j, id, motivo, reclamo) }
    assert.equal((await pedir(propio.deps)).status, 422)
    assert.deepEqual(recibidos, [reclamoVigente])

    // Otra invocación toma la versión entre la relectura de propiedad y el update condicional (el mock cambia el candado
    // justo antes de aplicar el update, que compara el reclamo como lo hace la consulta real).
    const m = montar({ texto: '   ' })
    let borrados = 0
    const borrar = m.deps.borrarFragmentos
    m.deps.borrarFragmentos = async (...a) => { borrados++; return borrar(...a) }
    const marcar = m.deps.marcarFallida
    m.deps.marcarFallida = async (...a) => { m.v.motivo_error = 'indexando:otra'; return marcar(...a) }
    const res = await pedir(m.deps)
    assert.equal(res.status, 502)
    assert.equal(m.v.estado, 'procesando', 'no se marcó fallida la versión que ahora es de otra invocación')
    assert.equal(m.v.motivo_error, 'indexando:otra', 'no se liberó el candado ajeno')
    assert.equal(borrados, 0)
  })

  it('un rechazo de la política de IA guarda un texto fijo, no el código interno', async () => {
    const m = montar()
    m.deps.validarEntrada = () => { throw new Error('POLITICA_IA_INACTIVA') }
    const res = await pedir(m.deps)
    assert.equal(res.status, 422)
    const cuerpo = JSON.stringify(await res.json())
    assert.doesNotMatch(cuerpo, /POLITICA_IA_INACTIVA/)
    assert.doesNotMatch(m.v.motivo_error ?? '', /POLITICA_IA_INACTIVA/)
    assert.equal(m.v.estado, 'fallida')
  })

  it('una versión que desaparece durante el procesamiento responde 404 (no 409 ocupado) al fallar', async () => {
    const m = montar({ texto: '   ' })
    const extraer = m.deps.extraerTexto
    const leer = m.deps.version
    let desaparecida = false
    m.deps.extraerTexto = async (...a) => { const r = await extraer(...a); desaparecida = true; return r }
    m.deps.version = async (...a) => (desaparecida ? null : leer(...a))
    assert.equal((await pedir(m.deps)).status, 404)
  })

  it('carrera: si marcarFallida no aplica porque otra invocación ya la activó, no borra nada y responde 200 idempotente', async () => {
    const m = montar({ texto: '   ', activarLaOtra: true })
    let borrados = 0
    const original = m.deps.borrarFragmentos
    m.deps.borrarFragmentos = async (...a) => { borrados++; return original(...a) }
    const res = await pedir(m.deps)
    assert.equal(res.status, 200)
    assert.equal(m.v.estado, 'activa')
    assert.equal(borrados, 0)
  })

  it('si soltar también falla en la rama 502, no lanza y deja rastro en el log', async () => {
    const m = montar({ texto: '   ', marcarFalla: true, soltarFalla: true })
    const errores: unknown[][] = []
    const original = console.error
    console.error = (...a: unknown[]) => { errores.push(a) }
    try {
      const res = await pedir(m.deps)
      assert.equal(res.status, 502)
    } finally { console.error = original }
    assert.ok(errores.some((e) => String(e[0]).includes('no se pudo soltar el candado')))
  })

  it('los logs de indexar-documento dejan solo nombre y código: un fallo de fetch con una clave no la filtra', async () => {
    const casos: Array<[string, (m: ReturnType<typeof montar>) => void, number, string]> = [
      ['fallo de embeddings', (m) => { m.deps.embeddings = async () => { throw new TypeError('fetch failed: https://api.x/y?apikey=SECRETO', { cause: new Error('Bearer SECRETO') }) } }, 502, 'TypeError'],
      ['entrada rechazada por la política de IA', (m) => { m.deps.validarEntrada = () => { throw new Error('POLITICA_IA_INACTIVA') } }, 200, 'Error POLITICA_IA_INACTIVA'],
      ['no se pudo soltar el candado, vence solo en 10 minutos', (m) => { m.deps.embeddings = async () => { throw new Error('caído') }; m.deps.soltar = async () => { throw new Error('soltar: 42501 clave sk-abcdefghijSECRETO') } }, 502, 'Error'],
      ['error inesperado', (m) => { m.deps.activar = async () => { throw new RangeError('boom SECRETO') } }, 500, 'RangeError'],
    ]
    for (const [prefijo, preparar, , esperado] of casos) {
      const m = montar({})
      preparar(m)
      const errores: unknown[][] = []
      const original = console.error
      console.error = (...a: unknown[]) => { errores.push(a) }
      try { await pedir(m.deps) } finally { console.error = original }
      const log = errores.find((e) => String(e[0]).includes(prefijo))
      assert.ok(log, `falta el log «${prefijo}»`)
      assert.equal(log[1], esperado)
      assert.doesNotMatch(JSON.stringify(errores), /SECRETO|api\.x|sk-abc/)
    }
  })

  it('cada log de error de indexar-documento deja solo nombre y código (lectura del contexto y los tres borrados de fragmentos)', async () => {
    const espiar = async (m: ReturnType<typeof montar>) => {
      const errores: unknown[][] = []
      const original = console.error
      console.error = (...a: unknown[]) => { errores.push(a) }
      try { await pedir(m.deps) } finally { console.error = original }
      return errores
    }
    const secreto = () => new Error('falló con Bearer SECRETO https://x.y/?apikey=SECRETO')
    const a = montar({ version: { subida_por: 'otro' } })
    a.deps.contexto = async () => { throw secreto() }
    const b = montar({ embeddingsFalla: true })
    b.deps.borrarFragmentos = async () => { throw secreto() }
    const c = montar({ texto: '   ' })
    c.deps.borrarFragmentos = async () => { throw secreto() }
    const d = montar({ activarInvalida: true })
    let llamadas = 0
    const borrar = d.deps.borrarFragmentos
    d.deps.borrarFragmentos = async (...args) => { if (++llamadas >= 2) throw secreto(); return borrar(...args) }
    const casos: Array<[string, ReturnType<typeof montar>]> = [['no se pudo leer el contexto', a], ['no se pudieron borrar los fragmentos', b], ['no se pudieron borrar los fragmentos', c], ['no se pudieron borrar los fragmentos', d]]
    for (const [prefijo, m] of casos) {
      const errores = await espiar(m)
      const log = errores.find((e) => String(e[0]).includes(prefijo))
      assert.ok(log, `falta el log «${prefijo}»`)
      assert.equal(log[1], 'Error')
      assert.doesNotMatch(JSON.stringify(errores), /SECRETO|x\.y/)
    }
  })

  it('un error hostil (getter o Proxy que lanza) en el flujo no rompe la respuesta prevista ni soltar el candado', async () => {
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    const hostiles: unknown[] = [{ get name() { throw new Error('x') } }, { get message() { throw new Error('x') } }, new Proxy({}, { get() { throw new Error('x') } }), revocable.proxy]
    for (const h of hostiles) {
      // Embeddings falla de forma hostil y además soltar el candado también lanza algo hostil: la respuesta sigue siendo el 502 reintentable.
      const m = montar({})
      m.deps.embeddings = async () => { throw h }
      m.deps.soltar = async () => { throw h }
      m.deps.borrarFragmentos = async () => { throw h }
      const original = console.error
      console.error = () => {}
      let res: Response | undefined
      try { res = await pedir(m.deps) } finally { console.error = original }
      assert.equal(res?.status, 502)
      // Un error inesperado hostil (activar lanza) responde el 500 previsto.
      const n = montar({})
      n.deps.activar = async () => { throw h }
      n.deps.soltar = async () => { throw h }
      console.error = () => {}
      try { res = await pedir(n.deps) } finally { console.error = original }
      assert.equal(res?.status, 500)
    }
  })

  it('no lee el contexto si quien invoca subió la versión; si la lectura lanza y no subió, 503', async () => {
    const subio = montar()
    let lecturas = 0
    subio.deps.contexto = async () => { lecturas++; return null }
    assert.equal((await pedir(subio.deps)).status, 200)
    assert.equal(lecturas, 0)
    const ajeno = montar({ version: { subida_por: 'otro-usuario' } })
    ajeno.deps.contexto = async () => { throw new Error('boom') }
    assert.equal((await pedir(ajeno.deps)).status, 503)
  })

  it('si no se puede registrar la versión fallida, se suelta el candado y responde 502 reintentable', async () => {
    const m = montar({ texto: '   ', marcarFalla: true })
    const res = await pedir(m.deps)
    assert.equal(res.status, 502)
    assert.equal(m.v.estado, 'procesando')
    assert.equal(m.v.motivo_error, null)
  })

  it('valida sesión y version_id', async () => {
    const m = montar()
    assert.equal((await pedir(m.deps, { version_id: ID }, null)).status, 403)
    assert.equal((await pedir(m.deps, { version_id: ID }, 'malo')).status, 403)
    assert.equal((await pedir(m.deps, { version_id: 'x' })).status, 400)
  })
})

describe('reglas de indexación', () => {
  it('fragmenta con solapamiento y reconoce reclamos vigentes', () => {
    assert.equal(fragmentarTexto('a'.repeat(2000)).length, 2)
    assert.equal(reclamoVigente(null, AHORA), false)
    assert.equal(reclamoVigente('No pudimos extraer texto', AHORA), false)
  })
})

describe('indexar-documento · cupo persistente por usuario y hora (lote 92)', () => {
  it('con cupo: se consume UNA vez, con el usuario autenticado, ANTES de los embeddings, y la versión se activa', async () => {
    const m = montar()
    const res = await pedir(m.deps)
    assert.equal(res.status, 200)
    assert.deepEqual(m.cupos, ['u1'])
    assert.deepEqual(m.orden, ['cupo', 'embeddings'])
    assert.equal(m.v.estado, 'activa')
  })

  it('cupo agotado: 429 con Retry-After y el texto literal, sin embeddings, sin fragmentos y con el candado soltado (se reintenta más tarde)', async () => {
    const m = montar({ cupo: { status: 429, error: 'Indexaste demasiados documentos en poco tiempo. Probá de nuevo más tarde.', retryAfter: 1234 } })
    const res = await pedir(m.deps)
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '1234')
    assert.equal(res.headers.get('Access-Control-Expose-Headers'), 'Retry-After', 'el navegador puede leer el Retry-After del 429')
    assert.deepEqual(await res.json(), { error: 'Indexaste demasiados documentos en poco tiempo. Probá de nuevo más tarde.' })
    assert.deepEqual(m.orden, ['cupo'])
    assert.equal(m.insertados(), 0)
    assert.equal(m.v.estado, 'procesando', 'no se marca fallida: es transitorio')
    assert.equal(m.v.motivo_error, null, 'el candado se soltó')
  })

  it('cupo no verificable: 503 sin Retry-After (falla cerrado), sin embeddings y con el candado soltado', async () => {
    const m = montar({ cupo: { status: 503, error: 'No se pudo verificar tu cuota de uso.' } })
    const res = await pedir(m.deps)
    assert.equal(res.status, 503)
    assert.equal(res.headers.get('Retry-After'), null)
    assert.deepEqual(await res.json(), { error: 'No se pudo verificar tu cuota de uso.' })
    assert.deepEqual(m.orden, ['cupo'])
    assert.equal(m.v.estado, 'procesando')
    assert.equal(m.v.motivo_error, null)
  })

  it('un retryAfter ausente o 0 no agrega la cabecera (la constante de espera la fija cupo-ia, no el handler)', async () => {
    for (const retryAfter of [undefined, 0]) {
      const m = montar({ cupo: { status: 429, error: 'x', retryAfter } })
      assert.equal((await pedir(m.deps)).headers.get('Retry-After'), null, String(retryAfter))
    }
  })

  it('un pedido que no llega a los embeddings NO gasta cupo: sin sesión, cuerpo inválido, funcionalidad apagada, sin permiso, versión ajena o procesada, sin texto, sin fragmentos, política, credencial, proveedor y entrada', async () => {
    const casos: [string, () => Promise<{ cupos: string[]; res: Response }>][] = []
    const caso = (nombre: string, opciones: Parameters<typeof montar>[0], preparar?: (m: ReturnType<typeof montar>) => void, body: unknown = { version_id: ID }, jwt: string | null = 'ok') =>
      casos.push([nombre, async () => { const m = montar(opciones); preparar?.(m); return { cupos: m.cupos, res: await pedir(m.deps, body, jwt) } }])
    caso('sin sesión', {}, undefined, { version_id: ID }, null)
    caso('cuerpo inválido', {}, undefined, { version_id: 'x' })
    caso('funcionalidad apagada', { featureApagada: true })
    caso('sin permiso de escritura', { sinPermisoEscritura: true })
    caso('versión ajena', { versionAjena: true })
    caso('versión ya procesada', { version: { estado: 'activa' } })
    caso('sin texto', { texto: '   ' })
    caso('sin política', {}, (m) => { m.deps.politica = async () => null })
    caso('sin credencial', {}, (m) => { m.deps.credencial = async () => null })
    caso('proveedor no soportado', {}, (m) => { m.deps.credencial = async () => ({ clave: 'k', proveedor_codigo: 'otro' }) })
    caso('entrada rechazada por la política', {}, (m) => { m.deps.validarEntrada = () => { throw new Error('POLITICA_IA_INACTIVA') } })
    caso('descarga fallida', { descargaFalla: true })
    for (const [nombre, ejecutar] of casos) {
      const { cupos, res } = await ejecutar()
      assert.notEqual(res.status, 200, nombre)
      assert.deepEqual(cupos, [], nombre)
    }
  })
})
