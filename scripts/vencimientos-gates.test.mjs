import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularPlan,
  contrastarBoard,
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
  typeId: 12,
  labelIds: [738],
  archived: false,
  dueDate: null,
  statusSince: '2026-11-14T18:52:03.189Z',
  ...extra,
})

/**
 * Stub del tracker: responde la lectura por etiqueta, la lectura por tipo y el detalle,
 * y registra las escrituras. `topeTipo`/`topeEtiqueta` recortan la respuesta para
 * simular que la API truncó una lectura.
 */
function crearStub(items, { topeTipo = null, topeEtiqueta = null, fallaPatchEn = null } = {}) {
  const llamadas = []
  const meta = {
    labels: [...ETIQUETAS].map(([id, name]) => ({ id, name })),
    columns: [...COLUMNAS.values()],
    issueTypes: [{ id: 12, name: 'Historia' }],
  }
  const fetchStub = async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const params = new URLSearchParams(search)
    llamadas.push({ url, init })
    if (init.method === 'PATCH') {
      const id = Number(pathname.split('/').pop())
      if (id === fallaPatchEn) return { ok: false, status: 500, text: async () => 'boom' }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    if (pathname === '/projects/MSF') {
      return { ok: true, status: 200, json: async () => meta }
    }
    if (pathname === '/projects/MSF/issues') {
      const etiqueta = params.get('labelIds')
      const tipo = params.get('typeId')
      const lote = etiqueta
        ? items.filter((i) => i.labelIds.includes(Number(etiqueta)))
        : items.filter((i) => String(i.typeId) === tipo)
      const recortado = etiqueta ? topeEtiqueta : topeTipo
      return {
        ok: true,
        status: 200,
        json: async () => (recortado ? lote.slice(0, recortado) : lote),
      }
    }
    if (pathname.startsWith('/issues/')) {
      const id = Number(pathname.split('/').pop())
      const encontrado = items.find((i) => i.id === id)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          statusSince: encontrado?.statusSince ?? null,
          createdAt: encontrado?.statusSince ?? null,
        }),
      }
    }
    throw new Error(`URL sin stub: ${url}`)
  }
  return { fetchStub, llamadas }
}

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
  const items = [
    item({ id: 1, identifier: 'MSF-1' }),
    item({ id: 2, identifier: 'MSF-2', dueDate: '2026-11-19' }),
    item({ id: 3, identifier: 'MSF-3', columnId: 51 }),
    item({ id: 4, identifier: 'MSF-4', labelIds: [601] }),
  ]
  const { fetchStub, llamadas } = crearStub(items)

  const simulado = await ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' })
  assert.deepEqual(
    simulado.plan.map((p) => [p.identifier, p.dueDate]),
    [['MSF-1', '2026-11-15']],
  )
  assert.equal(simulado.gates, 3)
  assert.equal(simulado.leidos, 4)
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

test('un gate sin tipo también entra en el barrido', async () => {
  const { fetchStub, llamadas } = crearStub([item({ id: 9, identifier: 'MSF-9', typeId: null })])
  const { plan } = await ejecutar({
    fetchImpl: fetchStub,
    url: 'https://tracker.test',
    clave: 'x',
    aplicar: true,
  })
  assert.deepEqual(
    plan.map((p) => p.identifier),
    ['MSF-9'],
  )
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 1)
})

test('una lectura por tipo truncada corta el barrido antes de escribir', async () => {
  // El tipo tiene 450 ítems y la API devuelve sólo 400: los 20 gates del final no
  // llegan. Sin el contraste, el barrido declararía «0 gates sin fecha» con 20 gates
  // sin fecha (el falso verde que la guarda tiene que evitar).
  const items = [
    ...Array.from({ length: 430 }, (_, i) =>
      item({ id: i + 1, identifier: `MSF-${i + 1}`, labelIds: [601] }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      item({ id: 431 + i, identifier: `MSF-G${i + 1}`, labelIds: [738] }),
    ),
  ]
  const { fetchStub, llamadas } = crearStub(items, { topeTipo: 400 })
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no aparece en la lectura de su tipo/,
  )
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 0)
})

test('una lectura por etiqueta truncada corta el barrido antes de escribir', async () => {
  const items = [
    item({ id: 1, identifier: 'MSF-1' }),
    item({ id: 2, identifier: 'MSF-2', labelIds: [738] }),
  ]
  const { fetchStub, llamadas } = crearStub(items, { topeEtiqueta: 1 })
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no están en la lectura por etiqueta/,
  )
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 0)
})

test('un tipo con el tope de ítems corta el barrido: la API no pagina y el resultado sería incompleto', async () => {
  const items = Array.from({ length: 500 }, (_, i) =>
    item({ id: i + 1, identifier: `MSF-${i + 1}`, labelIds: [601] }),
  )
  const { fetchStub } = crearStub(items)
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no pagina más/,
  )
})

test('una etiqueta de gate en el tope corta el barrido: no se puede saber si faltan gates', async () => {
  const items = Array.from({ length: 500 }, (_, i) =>
    item({ id: i + 1, identifier: `MSF-${i + 1}`, labelIds: [738] }),
  )
  const { fetchStub } = crearStub(items)
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no pagina más/,
  )
})

test('un PATCH que falla deja registrado qué ítems escribió la corrida', async () => {
  const items = [
    item({ id: 1, identifier: 'MSF-1' }),
    item({ id: 2, identifier: 'MSF-2', labelIds: [735] }),
  ]
  const { fetchStub, llamadas } = crearStub(items, { fallaPatchEn: 2 })
  const escritos = []
  await assert.rejects(
    () =>
      ejecutar({
        fetchImpl: fetchStub,
        url: 'https://tracker.test',
        clave: 'x',
        aplicar: true,
        alAplicar: (p) => escritos.push(`${p.identifier} (id ${p.id}) ${p.dueDate}`),
      }),
    /ItsAPlan \/issues\/2: 500 boom/,
  )
  // El ítem 1 quedó con fecha en el board: la salida tiene que decir cuál fue, para
  // que la reversión se pueda aplicar con precisión.
  assert.deepEqual(escritos, ['MSF-1 (id 1) 2026-11-15'])
  const parches = llamadas.filter((c) => c.init.method === 'PATCH')
  assert.equal(parches.length, 2)
})

test('el contraste corta si un gate de una lectura no está en la otra', () => {
  const gates = new Map([[1, item({ id: 1, identifier: 'MSF-1', typeId: 12 })]])
  const porTipo = new Map([[12, [item({ id: 2, identifier: 'MSF-2', typeId: 12 })]]])
  assert.throws(
    () => contrastarBoard(gates, porTipo, { etiquetas: ETIQUETAS }),
    /no aparece en la lectura de su tipo/,
  )
  assert.throws(
    () => contrastarBoard(new Map(), porTipo, { etiquetas: ETIQUETAS }),
    /no están en la lectura por etiqueta/,
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
