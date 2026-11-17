// Pruebas de `indexar-documento` con dependencias simuladas: `node --test supabase/functions/indexar-documento/handler.test.ts`
// (pnpm test:edge:indexar-documento). El handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps, type VersionDoc } from './handler.ts'
import { MAX_FRAGMENTOS, fragmentarTexto, reclamoVigente, nuevoReclamo } from './reglas.ts'

const ID = '11111111-1111-4111-8111-111111111111'
const AHORA = 1_800_000_000_000

// Base en memoria con la semántica real: reclamar es compare-and-swap, marcarFallida solo actúa sobre `procesando`.
function montar(opciones: { texto?: string | null; embeddingsFalla?: boolean; activarFalla?: boolean; descargaFalla?: boolean; activarPermiso?: boolean; version?: Partial<VersionDoc> } = {}) {
  const v: VersionDoc = { id: ID, estado: 'procesando', motivo_error: null, storage_path: 'o/a.txt', nombre: 'a.txt', organizacion_id: 'org-1', ...opciones.version }
  let fragmentos = 0
  let insertados = 0
  const deps: Deps = {
    getUser: async (jwt) => jwt === 'ok' ? { id: 'u1' } : null,
    version: async () => ({ ...v }),
    reclamar: async (_j, _id, previo, reclamo) => {
      if (v.estado !== 'procesando' || v.motivo_error !== previo) return false
      v.motivo_error = reclamo
      return true
    },
    soltar: async (_j, _id, reclamo) => { if (v.estado === 'procesando' && v.motivo_error === reclamo) v.motivo_error = null },
    marcarFallida: async (_j, _id, motivo) => { if (v.estado === 'procesando') { v.estado = 'fallida'; v.motivo_error = motivo } },
    estado: async () => v.estado,
    descargar: async () => opciones.descargaFalla ? null : new Uint8Array([1]),
    extraerTexto: async () => opciones.texto === undefined ? 'hola mundo '.repeat(50) : opciones.texto,
    politica: async () => ({ politica_id: 'p', contrato_id: 'c', perfil_principal_id: 'pf', limite_intentos: 1, limite_segundos: 60, perfil_fallback_id: null }),
    credencial: async () => ({ clave: 'k', proveedor_codigo: 'openai' }),
    validarEntrada: () => undefined,
    embeddings: async (textos) => { if (opciones.embeddingsFalla) throw new Error('openai caído'); return textos.map(() => [0.1]) },
    borrarFragmentos: async () => { fragmentos = 0; return true },
    insertarFragmentos: async (_j, filas) => { fragmentos += filas.length; insertados += filas.length; return true },
    activar: async () => {
      if (opciones.activarPermiso) return 'permiso'
      if (opciones.activarFalla) return 'error'
      if (v.estado !== 'procesando') return 'error'
      v.estado = 'activa'
      return 'ok'
    },
    ahora: () => AHORA,
    id: () => 'abc',
  }
  return { deps, v, fragmentosGuardados: () => fragmentos, insertados: () => insertados }
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
