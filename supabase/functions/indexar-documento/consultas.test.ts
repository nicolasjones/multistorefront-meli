// Pruebas de las consultas reales de `indexar-documento` con un cliente supabase simulado que registra la cadena de
// llamadas (tabla, operación y cada filtro): `node --test supabase/functions/indexar-documento/consultas.test.ts`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { consultaMarcarFallida, consultaReclamar, consultaSoltar, llamarBorrarFragmentosSiDueno, llamarInsertarFragmentosSiDueno, type Cliente } from './consultas.ts'

type Llamada = [string, ...unknown[]]

// Cada método encadenable devuelve el mismo objeto y deja registro; `rpc` también.
function clienteSimulado() {
  const llamadas: Llamada[] = []
  const cadena: Record<string, unknown> = {}
  for (const m of ['update', 'eq', 'is', 'select']) cadena[m] = (...args: unknown[]) => { llamadas.push([m, ...args]); return cadena }
  const cliente = {
    from: (tabla: string) => { llamadas.push(['from', tabla]); return cadena },
    rpc: (nombre: string, args: Record<string, unknown>) => { llamadas.push(['rpc', nombre, args]); return { data: true, error: null } },
  } as unknown as Cliente
  return { cliente, llamadas }
}

describe('consultaMarcarFallida', () => {
  it('actualiza solo mientras la versión sigue procesando y con el reclamo propio', () => {
    const { cliente, llamadas } = clienteSimulado()
    consultaMarcarFallida(cliente, 'v1', 'motivo', 'rec-1')
    assert.deepEqual(llamadas, [
      ['from', 'versiones_documento'],
      ['update', { estado: 'fallida', motivo_error: 'motivo' }],
      ['eq', 'id', 'v1'],
      ['eq', 'estado', 'procesando'],
      ['eq', 'motivo_error', 'rec-1'],
      ['select', 'id'],
    ])
  })
})

describe('consultaReclamar', () => {
  it('sin motivo previo exige motivo_error nulo', () => {
    const { cliente, llamadas } = clienteSimulado()
    consultaReclamar(cliente, 'v1', null, 'rec-2')
    assert.deepEqual(llamadas, [
      ['from', 'versiones_documento'],
      ['update', { motivo_error: 'rec-2' }],
      ['eq', 'id', 'v1'],
      ['eq', 'estado', 'procesando'],
      ['is', 'motivo_error', null],
      ['select', 'id'],
    ])
  })
  it('con motivo previo exige exactamente ese motivo (compare-and-swap)', () => {
    const { cliente, llamadas } = clienteSimulado()
    consultaReclamar(cliente, 'v1', 'rec-viejo', 'rec-2')
    assert.deepEqual(llamadas.slice(2), [['eq', 'id', 'v1'], ['eq', 'estado', 'procesando'], ['eq', 'motivo_error', 'rec-viejo'], ['select', 'id']])
  })
})

describe('consultaSoltar', () => {
  it('solo suelta el reclamo propio de una versión procesando', () => {
    const { cliente, llamadas } = clienteSimulado()
    consultaSoltar(cliente, 'v1', 'rec-3')
    assert.deepEqual(llamadas, [
      ['from', 'versiones_documento'],
      ['update', { motivo_error: null }],
      ['eq', 'id', 'v1'],
      ['eq', 'estado', 'procesando'],
      ['eq', 'motivo_error', 'rec-3'],
    ])
  })
})

describe('llamarBorrarFragmentosSiDueno', () => {
  it('llama a la función SQL condicional con la versión, la organización y el reclamo, sin borrar por tabla', () => {
    const { cliente, llamadas } = clienteSimulado()
    llamarBorrarFragmentosSiDueno(cliente, 'v1', 'org-1', 'rec-4')
    assert.deepEqual(llamadas, [['rpc', 'borrar_fragmentos_si_dueno', { p_version_id: 'v1', p_organizacion_id: 'org-1', p_reclamo: 'rec-4' }]])
  })
})

describe('llamarInsertarFragmentosSiDueno', () => {
  it('llama a la RPC condicional con la versión, la organización, el reclamo y las filas (sin version_id ni organizacion_id propios)', () => {
    const { cliente, llamadas } = clienteSimulado()
    llamarInsertarFragmentosSiDueno(cliente, 'v1', 'org-1', 'rec-1', [{ texto: 't', embedding: '[0]', orden: 0 }])
    assert.deepEqual(llamadas, [['rpc', 'insertar_fragmentos_si_dueno', { p_version_id: 'v1', p_organizacion_id: 'org-1', p_reclamo: 'rec-1', p_filas: [{ texto: 't', embedding: '[0]', orden: 0 }] }]])
  })
})
