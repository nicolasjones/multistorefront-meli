import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularPlan,
  crearCliente,
  esGate,
  esperaDecision,
  ejecutar,
  fechaVencimiento,
  seleccionarGates,
} from './vencimientos-gates.mjs'

const ETIQUETAS = new Map([
  [738, 'gate'],
  [735, 'decision'],
  [736, 'escala-humano'],
  [601, 'espera-dependencia'],
])
const COLUMNAS = new Map([
  [11, { id: 11, name: 'Backlog', stateType: 'backlog' }],
  [48, { id: 48, name: 'En curso', stateType: 'started' }],
  [51, { id: 51, name: 'Review In DEV', stateType: 'completed' }],
  [58, { id: 58, name: 'Finalizada', stateType: 'completed' }],
])

const item = (extra) => ({
  id: 1,
  identifier: 'MSF-1',
  title: 'Un gate',
  columnId: 48,
  labelIds: [738],
  archived: false,
  dueDate: null,
  ...extra,
})

test('la fecha de vencimiento es el plazo del contrato contado desde que el ítem espera', () => {
  // 24 h después de las 09:00 de Argentina (12:00 UTC) es el día siguiente.
  assert.equal(fechaVencimiento('2026-11-18T12:00:00.000Z'), '2026-11-19')
  // El plazo se cuenta en horas y se redondea al día en la zona del board: 23:00 de
  // Argentina + 24 h sigue siendo el 19, no el 20.
  assert.equal(fechaVencimiento('2026-11-19T02:00:00.000Z'), '2026-11-19')
  // Ni una fecha en UTC ni un día de corrido: 23:00 de Argentina es el 18 local.
  assert.equal(fechaVencimiento('2026-11-18T02:00:00.000Z'), '2026-11-18')
  assert.throws(() => fechaVencimiento('no-es-una-fecha'), /Fecha inválida/)
})

test('un ítem es gate si lleva gate, decision o escala-humano', () => {
  assert.equal(esGate(item({ labelIds: [738] }), ETIQUETAS), true)
  assert.equal(esGate(item({ labelIds: [735] }), ETIQUETAS), true)
  assert.equal(esGate(item({ labelIds: [736] }), ETIQUETAS), true)
  assert.equal(esGate(item({ labelIds: [601] }), ETIQUETAS), false)
  assert.equal(esGate(item({ labelIds: [] }), ETIQUETAS), false)
})

test('un ítem espera decisión mientras no está archivado ni en una columna terminal', () => {
  assert.equal(esperaDecision(item({ columnId: 48 }), COLUMNAS), true)
  assert.equal(esperaDecision(item({ columnId: 11 }), COLUMNAS), true)
  assert.equal(esperaDecision(item({ columnId: 51 }), COLUMNAS), false)
  assert.equal(esperaDecision(item({ columnId: 58 }), COLUMNAS), false)
  assert.equal(esperaDecision(item({ columnId: 48, archived: true }), COLUMNAS), false)
})

test('se seleccionan los gates sin fecha que esperan decisión', () => {
  const items = [
    item({ id: 1, identifier: 'MSF-1' }),
    item({ id: 2, identifier: 'MSF-2', labelIds: [601] }),
    item({ id: 3, identifier: 'MSF-3', columnId: 51 }),
    item({ id: 4, identifier: 'MSF-4', dueDate: '2026-11-19' }),
    item({ id: 5, identifier: 'MSF-5', archived: true }),
    item({ id: 6, identifier: 'MSF-6', labelIds: [735] }),
  ]
  const elegidos = seleccionarGates(items, { etiquetas: ETIQUETAS, columnas: COLUMNAS })
  assert.deepEqual(
    elegidos.map((i) => i.identifier),
    ['MSF-1', 'MSF-6'],
  )
})

test('el plan usa desde cuándo espera el ítem y, si falta, cuándo se creó', async () => {
  const plan = await calcularPlan(
    [item({ id: 1, identifier: 'MSF-1' }), item({ id: 2, identifier: 'MSF-2' })],
    async (id) =>
      id === 1
        ? { statusSince: '2026-11-14T18:52:03.189Z' }
        : { statusSince: null, createdAt: '2026-11-16T10:00:00.000Z' },
  )
  assert.deepEqual(
    plan.map((p) => [p.identifier, p.dueDate]),
    [
      ['MSF-1', '2026-11-15'],
      ['MSF-2', '2026-11-17'],
    ],
  )
})

test('el PATCH manda sólo la fecha: mandar etiquetas las reemplazaría', async () => {
  const llamadas = []
  const cliente = crearCliente(
    async (url, init) => {
      llamadas.push({ url, init })
      return { ok: true, status: 200, json: async () => ({}) }
    },
    { url: 'https://tracker.test', clave: 'secreto' },
  )
  await cliente.patch('/issues/7', { dueDate: '2026-11-19' })
  const { url, init } = llamadas[0]
  assert.equal(url, 'https://tracker.test/issues/7')
  assert.equal(init.method, 'PATCH')
  assert.equal(init.headers['x-api-key'], 'secreto')
  assert.deepEqual(JSON.parse(init.body), { dueDate: '2026-11-19' })
})

test('el barrido simula sin escribir y aplica con un PATCH por ítem', async () => {
  const llamadas = []
  const board = {
    '/projects/MSF': {
      labels: [...ETIQUETAS].map(([id, name]) => ({ id, name })),
      columns: [...COLUMNAS.values()],
      issueTypes: [{ id: 12, name: 'Epic' }],
    },
    '/projects/MSF/issues?typeId=12&limit=500&includeArchived=true': [
      item({ id: 1, identifier: 'MSF-1' }),
      item({ id: 2, identifier: 'MSF-2', dueDate: '2026-11-19' }),
      item({ id: 3, identifier: 'MSF-3', columnId: 51 }),
    ],
    '/issues/1': { statusSince: '2026-11-14T18:52:03.189Z' },
  }
  const fetchStub = async (url, init = {}) => {
    llamadas.push({ url, init })
    if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) }
    const { pathname, search } = new URL(url)
    const datos = board[pathname + search]
    if (datos === undefined) throw new Error(`URL sin stub: ${url}`)
    return { ok: true, status: 200, json: async () => datos }
  }

  const simulado = await ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' })
  assert.deepEqual(
    simulado.plan.map((p) => [p.identifier, p.dueDate]),
    [['MSF-1', '2026-11-15']],
  )
  assert.equal(simulado.total, 3)
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 0)

  const aplicado = await ejecutar({
    fetchImpl: fetchStub,
    url: 'https://tracker.test',
    clave: 'x',
    aplicar: true,
  })
  const parches = llamadas.filter((c) => c.init.method === 'PATCH')
  assert.equal(parches.length, 1)
  assert.equal(parches[0].url, 'https://tracker.test/issues/1')
  assert.deepEqual(JSON.parse(parches[0].init.body), { dueDate: '2026-11-15' })
  assert.equal(aplicado.plan.length, 1)
})

test('un tipo con el tope de ítems corta el barrido: la API no pagina y el resultado sería incompleto', async () => {
  const board = {
    '/projects/MSF': {
      labels: [...ETIQUETAS].map(([id, name]) => ({ id, name })),
      columns: [...COLUMNAS.values()],
      issueTypes: [{ id: 12, name: 'Historia' }],
    },
    '/projects/MSF/issues?typeId=12&limit=500&includeArchived=true': Array.from(
      { length: 500 },
      (_, i) => item({ id: i + 1, identifier: `MSF-${i + 1}` }),
    ),
  }
  const fetchStub = async (url) => {
    const { pathname, search } = new URL(url)
    const datos = board[pathname + search]
    if (datos === undefined) throw new Error(`URL sin stub: ${url}`)
    return { ok: true, status: 200, json: async () => datos }
  }
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no pagina más/,
  )
})

test('un error del board no se silencia', async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 500,
    text: async () => 'boom',
  })
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /ItsAPlan .*: 500 boom/,
  )
})
