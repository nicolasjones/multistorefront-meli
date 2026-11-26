// `node --test supabase/functions/chat-ia-responder/guardas.test.ts` (pnpm test:edge:chat-ia-limites).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ErrorPersistencia, MAX_HERRAMIENTAS_POR_TURNO, MENSAJE_MAX, columnasParaSelect, describirPropuesta, excedeLimite, filtrosSeguros, guardarMensaje, limiteConfigurado, rechazoPorCuota, resolverLlamadas, validarEntrada } from './guardas.ts'

describe('validarEntrada', () => {
  it('acepta un mensaje normal con o sin conversación', () => {
    assert.equal(validarEntrada({ mensaje: 'hola' }).ok, true)
    assert.equal(validarEntrada({ mensaje: 'hola', conversacion_id: '11111111-1111-4111-8111-111111111111' }).ok, true)
  })
  it('rechaza mensajes vacíos, enormes o de otro tipo y ids que no son UUID', () => {
    assert.equal(validarEntrada(null).ok, false)
    assert.equal(validarEntrada({ mensaje: '   ' }).ok, false)
    assert.equal(validarEntrada({ mensaje: 5 }).ok, false)
    assert.equal(validarEntrada({ mensaje: 'x'.repeat(MENSAJE_MAX + 1) }).ok, false)
    assert.equal(validarEntrada({ mensaje: 'x', conversacion_id: 'no-uuid' }).ok, false)
    assert.equal(validarEntrada({ mensaje: 'x', conversacion_id: 5 }).ok, false)
  })
})

describe('límite por usuario', () => {
  it('corta al llegar al tope y respeta el valor configurado', () => {
    assert.equal(excedeLimite(59), false)
    assert.equal(excedeLimite(60), true)
    assert.equal(excedeLimite(3, 3), true)
    assert.equal(limiteConfigurado('10'), 10)
    assert.equal(limiteConfigurado('abc'), 60)
    assert.equal(limiteConfigurado(undefined), 60)
    assert.equal(limiteConfigurado('-1'), 60)
  })
})

describe('filtrosSeguros', () => {
  it('deja pasar identificadores y escalares', () => {
    assert.deepEqual(filtrosSeguros({ sku: 'A1', cantidad: 3 }), { ok: true, filtros: { sku: 'A1', cantidad: 3 } })
    assert.deepEqual(filtrosSeguros(undefined), { ok: true, filtros: {} })
  })
  it('rechaza claves raras, valores no escalares, arreglos y demasiados filtros', () => {
    assert.equal(filtrosSeguros({ 'a.b': 1 }).ok, false)
    assert.equal(filtrosSeguros({ 'a;drop': 1 }).ok, false)
    assert.equal(filtrosSeguros({ a: { x: 1 } }).ok, false)
    assert.equal(filtrosSeguros({ a: null }).ok, false)
    assert.equal(filtrosSeguros([1]).ok, false)
    assert.equal(filtrosSeguros(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, 1]))).ok, false)
  })
})

describe('describirPropuesta', () => {
  it('muestra la acción y los parámetros reales junto a la descripción del modelo', () => {
    const t = describirPropuesta('anular_pedido', { id: 7 }, 'Anula el pedido de prueba')
    assert.match(t, /anular_pedido/)
    assert.match(t, /\{"id":7\}/)
    assert.match(t, /Anula el pedido de prueba/)
  })
  it('acota el largo', () => {
    assert.ok(describirPropuesta('r', { a: 'x'.repeat(5000) }, 'd').length <= 1500)
  })
})

describe('guardarMensaje', () => {
  it('lanza ErrorPersistencia si la base rechaza el insert', async () => {
    const cliente = { from: () => ({ insert: async () => ({ error: { message: 'rls' } }) }) }
    await assert.rejects(guardarMensaje(cliente, { contenido: 'x' }), ErrorPersistencia)
  })
  it('no lanza si el insert funciona', async () => {
    const cliente = { from: () => ({ insert: async () => ({ error: null }) }) }
    await guardarMensaje(cliente, { contenido: 'x' })
  })
})

describe('resolverLlamadas', () => {
  const lectura = async (nombre: string) => ({ tipo: 'resultado' as const, valor: { vista: nombre } })

  it('responde CADA llamada del turno, no solo la primera', async () => {
    const r = await resolverLlamadas([
      { id: 'a', name: 'leer', input: {} },
      { id: 'b', name: 'leer', input: {} },
    ], lectura)
    assert.equal(r.tipo, 'resultados')
    if (r.tipo === 'resultados') assert.deepEqual(r.resultados.map((x) => x.id), ['a', 'b'])
  })

  it('una propuesta o un rechazo cortan el turno', async () => {
    const propuesta = await resolverLlamadas([{ id: 'a', name: 'ejecutar', input: {} }, { id: 'b', name: 'leer', input: {} }], async (n) => n === 'ejecutar' ? { tipo: 'propuesta' } : lectura(n))
    assert.deepEqual(propuesta, { tipo: 'propuesta' })
    const rechazo = await resolverLlamadas([{ id: 'a', name: 'ejecutar', input: {} }], async () => ({ tipo: 'rechazo', mensaje: 'no' }))
    assert.deepEqual(rechazo, { tipo: 'rechazo', mensaje: 'no' })
  })

  it('pasado el tope, las llamadas sobrantes igual reciben una respuesta sin ejecutarse', async () => {
    let ejecutadas = 0
    const llamadas = Array.from({ length: MAX_HERRAMIENTAS_POR_TURNO + 2 }, (_, i) => ({ id: `t${i}`, name: 'leer', input: {} }))
    const r = await resolverLlamadas(llamadas, async (n) => { ejecutadas++; return lectura(n) })
    assert.equal(ejecutadas, MAX_HERRAMIENTAS_POR_TURNO)
    if (r.tipo === 'resultados') assert.equal(r.resultados.length, llamadas.length)
  })
})

describe('rechazoPorCuota', () => {
  it('deja pasar bajo el tope, corta con 429 al alcanzarlo y con 503 si no se pudo contar', () => {
    assert.equal(rechazoPorCuota(5, null, 60), null)
    assert.equal(rechazoPorCuota(null, null, 60), null)
    assert.equal(rechazoPorCuota(60, null, 60)?.status, 429)
    assert.equal(rechazoPorCuota(0, { message: 'x' }, 60)?.status, 503)
  })
})

describe('columnasParaSelect', () => {
  it('sin columnas definidas conserva el select * histórico', () => {
    assert.deepEqual(columnasParaSelect(null), { ok: true, seleccion: '*', permitidas: null })
    assert.deepEqual(columnasParaSelect(undefined), { ok: true, seleccion: '*', permitidas: null })
  })
  it('una lista de identificadores simples se pide tal cual', () => {
    assert.deepEqual(columnasParaSelect(['sku', 'nombre_2']), { ok: true, seleccion: 'sku,nombre_2', permitidas: ['sku', 'nombre_2'] })
  })
  it('rechaza (falla cerrado) todo lo que no sea una lista válida de identificadores', () => {
    const invalidos: unknown[] = [[], 'sku', {}, 5, ['sku;drop'], ['Sku'], ['a b'], ['a,b'], ['*'], [''], [1], [null], ['sku', 'sku'], ['a.b'], ['sku)'], Array.from({ length: 51 }, (_, i) => `c${i}`)]
    for (const v of invalidos) assert.deepEqual(columnasParaSelect(v), { ok: false }, JSON.stringify(v))
  })
})
