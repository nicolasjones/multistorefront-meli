import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { escrituraFragmentos, type FilaFragmento } from './fragmentos.ts'

const fila = (orden: number, extra: Partial<FilaFragmento> = {}): FilaFragmento => ({ version_id: 'v1', organizacion_id: 'org-1', texto: 't', embedding: '[0]', orden, ...extra })

function montar(version: { organizacion_id: string } | null, errorEn?: 'delete' | 'insert', noDueno = false, noDuenoAlInsertar = false) {
  const registro: Array<{ op: string; filtros?: Array<[string, string]>; n?: number; reclamo?: string; organizacionId?: string }> = []
  const servicio = {
    borrar: async (versionId: string, organizacionId: string, reclamo: string) => {
      registro.push({ op: 'delete', filtros: [['version_id', versionId], ['organizacion_id', organizacionId], ['reclamo', reclamo]] })
      return { data: !noDueno, error: errorEn === 'delete' ? { code: 'x' } : null }
    },
    insertar: async (_versionId: string, organizacionId: string, reclamo: string, filas: unknown[]) => {
      registro.push({ op: 'insert', n: filas.length, reclamo, organizacionId })
      return { data: !noDuenoAlInsertar, error: errorEn === 'insert' ? 'x' : null }
    },
  }
  return { registro, ...escrituraFragmentos(servicio, async () => version, 2) }
}

describe('escritura de fragmentos con el cliente de servicio', () => {
  it('borra filtrando por version_id, organizacion_id de la versión que el usuario ve y el reclamo propio', async () => {
    const m = montar({ organizacion_id: 'org-1' })
    assert.equal(await m.borrarFragmentos('jwt', 'v1', 'rec-1'), true)
    assert.deepEqual(m.registro, [{ op: 'delete', filtros: [['version_id', 'v1'], ['organizacion_id', 'org-1'], ['reclamo', 'rec-1']] }])
  })
  it('si la base dice que la versión ya no es de este reclamo (activa o retomada) devuelve false', async () => {
    assert.equal(await montar({ organizacion_id: 'org-1' }, undefined, true).borrarFragmentos('jwt', 'v1', 'rec-1'), false)
  })
  it('no toca nada si el usuario no ve la versión (inexistente, ajena o sin acceso)', async () => {
    const m = montar(null)
    assert.equal(await m.borrarFragmentos('jwt', 'v1', 'rec-1'), false)
    assert.equal(await m.insertarFragmentos('jwt', [fila(0)], 'rec-1'), false)
    assert.deepEqual(m.registro, [])
  })
  it('inserta por lotes solo si todas las filas son de la misma versión y de su organización', async () => {
    const m = montar({ organizacion_id: 'org-1' })
    assert.equal(await m.insertarFragmentos('jwt', [fila(0), fila(1), fila(2)], 'rec-1'), true)
    assert.deepEqual(m.registro.map((r) => r.n), [2, 1])
  })
  it('cada lote se inserta con el reclamo propio y la organización de la versión que el usuario ve (la base re-verifica la propiedad)', async () => {
    const m = montar({ organizacion_id: 'org-1' })
    assert.equal(await m.insertarFragmentos('jwt', [fila(0), fila(1), fila(2)], 'rec-9'), true)
    assert.deepEqual(m.registro.map((r) => [r.reclamo, r.organizacionId]), [['rec-9', 'org-1'], ['rec-9', 'org-1']])
  })
  it('si la base dice que la versión ya no es de este reclamo (retomada o activa) devuelve false y no sigue con más lotes', async () => {
    const m = montar({ organizacion_id: 'org-1' }, undefined, false, true)
    assert.equal(await m.insertarFragmentos('jwt', [fila(0), fila(1), fila(2)], 'rec-1'), false)
    assert.equal(m.registro.length, 1)
  })
  it('rechaza filas de otra versión o de otra organización sin escribir ninguna', async () => {
    const m = montar({ organizacion_id: 'org-1' })
    assert.equal(await m.insertarFragmentos('jwt', [fila(0), fila(1, { version_id: 'v2' })], 'rec-1'), false)
    assert.equal(await m.insertarFragmentos('jwt', [fila(0, { organizacion_id: 'org-2' })], 'rec-1'), false)
    assert.deepEqual(m.registro, [])
  })
  it('un error de la base devuelve false; sin filas es verdadero sin tocar la base', async () => {
    assert.equal(await montar({ organizacion_id: 'org-1' }, 'delete').borrarFragmentos('jwt', 'v1', 'rec-1'), false)
    assert.equal(await montar({ organizacion_id: 'org-1' }, 'insert').insertarFragmentos('jwt', [fila(0)], 'rec-1'), false)
    const vacio = montar({ organizacion_id: 'org-1' })
    assert.equal(await vacio.insertarFragmentos('jwt', [], 'rec-1'), true)
    assert.deepEqual(vacio.registro, [])
  })
})
