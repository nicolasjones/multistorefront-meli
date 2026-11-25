import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularPlan,
  contrastarBoard,
  crearCliente,
  esGate,
  esProyectoValido,
  esperaDecision,
  ejecutar,
  fechaVencimiento,
  lineaAplicado,
  lineaResumen,
  seleccionarGates,
  leerActividad,
  PAGINAS_FEED,
  ultimaEtiquetaGate,
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
 * simular que la API truncó una lectura. `etiquetasMeta` reemplaza las etiquetas del
 * proyecto (para simular uno sin etiquetas de gate).
 */
function crearStub(
  items,
  { topeTipo = null, topeEtiqueta = null, fallaPatchEn = null, etiquetasMeta = null, feeds = null, feedFalla = false } = {},
) {
  const llamadas = []
  const meta = {
    labels: etiquetasMeta ?? [...ETIQUETAS].map(([id, name]) => ({ id, name })),
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
    if (/^\/issues\/\d+\/feed$/.test(pathname)) {
      const id = Number(pathname.split('/')[2])
      if (feedFalla) return { ok: false, status: 500, text: async () => 'boom' }
      const feed = feeds?.[id] ?? []
      // `feed` es una lista de entradas o, para paginar, una lista de páginas `{items, nextCursor}`.
      if (feed.length && feed[0].items) {
        const cursor = params.get('cursor')
        const n = cursor ? JSON.parse(cursor).pagina : 0
        return { ok: true, status: 200, json: async () => feed[n] }
      }
      return { ok: true, status: 200, json: async () => ({ items: feed }) }
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

const marca = (nombre, createdAt, extra = {}) => ({
  kind: 'activity',
  action: 'label_add',
  payload: { to: { value: nombre } },
  createdAt,
  ...extra,
})

test('la última etiqueta de gate es la entrada label_add más nueva de una etiqueta de gate', () => {
  assert.equal(ultimaEtiquetaGate([]), null)
  assert.equal(ultimaEtiquetaGate(undefined), null)
  assert.equal(
    ultimaEtiquetaGate([
      marca('gate', '2026-11-18T10:00:00.000Z'),
      marca('decision', '2026-11-20T10:00:00.000Z'),
      marca('flagged', '2026-11-25T10:00:00.000Z'), // no es de gate
      { kind: 'activity', action: 'label_remove', payload: { from: { value: 'gate' } }, createdAt: '2026-11-26T10:00:00.000Z' },
      { kind: 'comment', createdAt: '2026-11-27T10:00:00.000Z' },
      marca('escala-humano', 'no-es-fecha'),
    ]),
    '2026-11-20T10:00:00.000Z',
  )
})

test('el plan ancla en cuando el ítem recibió la etiqueta de gate, no en statusSince (MSF-909)', async () => {
  const plan = await calcularPlan(
    [item({ id: 1, identifier: 'MSF-1' }), item({ id: 2, identifier: 'MSF-2' })],
    async () => ({ statusSince: '2026-11-14T18:52:03.189Z' }),
    async (id) => (id === 1 ? [marca('escala-humano', '2026-11-18T12:00:00.000Z')] : []),
  )
  assert.deepEqual(
    plan.map((p) => [p.identifier, p.dueDate]),
    [
      ['MSF-1', '2026-11-19'], // etiqueta el 18 -> vence el 19 (statusSince daba el 15)
      ['MSF-2', '2026-11-15'], // sin entrada en el historial: cae a statusSince
    ],
  )
})

test('una etiqueta de gate quitada después de agregarla ya no cuenta; si se vuelve a poner, vale la nueva', () => {
  const baja = (nombre, createdAt) => ({ kind: 'activity', action: 'label_remove', payload: { from: { value: nombre } }, createdAt })
  assert.equal(
    ultimaEtiquetaGate([marca('gate', '2026-11-18T10:00:00.000Z'), baja('gate', '2026-11-19T10:00:00.000Z')]),
    null,
  )
  assert.equal(
    ultimaEtiquetaGate([
      marca('gate', '2026-11-18T10:00:00.000Z'),
      baja('gate', '2026-11-19T10:00:00.000Z'),
      marca('gate', '2026-11-20T10:00:00.000Z'),
    ]),
    '2026-11-20T10:00:00.000Z',
  )
  // Quitar una etiqueta no afecta a otra de gate que sigue puesta.
  assert.equal(
    ultimaEtiquetaGate([
      marca('decision', '2026-11-17T10:00:00.000Z'),
      marca('gate', '2026-11-18T10:00:00.000Z'),
      baja('gate', '2026-11-19T10:00:00.000Z'),
    ]),
    '2026-11-17T10:00:00.000Z',
  )
})

test('sólo cuentan las entradas label_add: otra acción con la misma forma de payload se ignora', () => {
  assert.equal(
    ultimaEtiquetaGate([{ kind: 'activity', action: 'field', payload: { to: { value: 'gate' } }, createdAt: '2026-11-20T10:00:00.000Z' }]),
    null,
  )
})

test('ejecutar lee el feed del gate', async () => {
  const gate = item({ id: 1, identifier: 'MSF-1', statusSince: '2026-11-14T18:52:03.189Z' })
  const { fetchStub, llamadas } = crearStub([gate], { feeds: { 1: [marca('gate', '2026-11-18T12:00:00.000Z')] } })
  const { plan } = await ejecutar({ fetchImpl: fetchStub, proyecto: 'MSF' })
  assert.equal(plan[0].dueDate, '2026-11-19')
  assert.ok(llamadas.some((l) => l.url.includes('/issues/1/feed')))
})

test('el feed se pagina por cursor encadenado: la etiqueta más nueva puede estar en la 2.ª página', async () => {
  const gate = item({ id: 1, identifier: 'MSF-1' })
  const paginas = [
    { items: [marca('gate', '2026-11-16T12:00:00.000Z')], nextCursor: { pagina: 1 } },
    { items: [marca('decision', '2026-11-20T12:00:00.000Z')], nextCursor: null },
  ]
  const { fetchStub, llamadas } = crearStub([gate], { feeds: { 1: paginas } })
  const { plan } = await ejecutar({ fetchImpl: fetchStub, proyecto: 'MSF' })
  assert.equal(plan[0].dueDate, '2026-11-21')
  const pedidos = llamadas.filter((l) => l.url.includes('/issues/1/feed'))
  assert.equal(pedidos.length, 2)
  assert.ok(!pedidos[0].url.includes('cursor='))
  assert.equal(JSON.parse(new URL(pedidos[1].url).searchParams.get('cursor')).pagina, 1)
})

test('un error del feed corta el barrido antes de escribir nada', async () => {
  const gate = item({ id: 1, identifier: 'MSF-1' })
  const { fetchStub, llamadas } = crearStub([gate], { feedFalla: true })
  await assert.rejects(() => ejecutar({ fetchImpl: fetchStub, proyecto: 'MSF', aplicar: true }), /feed\?limit=100: 500/)
  assert.equal(llamadas.filter((l) => l.init.method === 'PATCH').length, 0)
})

test('si el feed supera el tope de páginas avisa con el identificador y sigue con lo leído', async () => {
  const api = { get: async () => ({ items: [marca('gate', '2026-11-18T12:00:00.000Z')], nextCursor: { x: 1 } }) }
  const avisos = []
  const items = await leerActividad(api, { id: 7, identifier: 'MSF-7' }, (m) => avisos.push(m))
  assert.equal(items.length, PAGINAS_FEED)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /MSF-7/)
  // Con menos páginas que el tope no avisa.
  const corto = { get: async () => ({ items: [], nextCursor: null }) }
  await leerActividad(corto, { id: 8, identifier: 'MSF-8' }, (m) => avisos.push(m))
  assert.equal(avisos.length, 1)
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
  assert.equal(simulado.esperando, 2)
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

test('una lectura vacía corta el barrido: no se puede afirmar que no quedan gates sin fecha', async () => {
  // La API cambió la forma de la respuesta (`datos?.data ?? []` → `[]`) o el filtro dejó
  // de matchear: las dos lecturas vienen vacías. Sin la guarda, el barrido terminaría
  // con «0 de 0 gates esperando decisión» y salida 0: el mismo falso verde que esta
  // herramienta vino a cerrar.
  const { fetchStub, llamadas } = crearStub([])
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no devolvió ningún ítem/,
  )
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 0)
})

test('un proyecto sin etiquetas de gate corta el barrido: sin ellas no se puede leer el board', async () => {
  const { fetchStub, llamadas } = crearStub([item({ id: 1, identifier: 'MSF-1' })], {
    etiquetasMeta: [{ id: 601, name: 'espera-dependencia' }],
  })
  await assert.rejects(
    () => ejecutar({ fetchImpl: fetchStub, url: 'https://tracker.test', clave: 'x' }),
    /no tiene ninguna etiqueta de gate/,
  )
  assert.equal(llamadas.filter((c) => c.init.method === 'PATCH').length, 0)
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

test('la salida deja el id numérico de cada ítem aplicado y el denominador del barrido', () => {
  // La reversión documentada es `PATCH /issues/<id>` con `{"dueDate": null}`: el id
  // numérico tiene que quedar en la salida, o el operador no sabe qué ítems tocaron la
  // corrida.
  const linea = lineaAplicado({
    identifier: 'MSF-909',
    id: 1145,
    dueDate: '2026-11-15',
    title: '[Auditoría] 23 gates esperando decisión sin fecha de vencimiento',
  })
  assert.match(linea, /aplicado MSF-909 \(id 1145\)/)
  assert.match(linea, /vence 2026-11-15/)

  // El denominador es la población de la regla (los gates que esperan decisión), no los
  // ítems del board: un «de N ítems del board» sería engañoso.
  const resumen = lineaResumen({
    proyecto: 'MSF',
    plan: [{ identifier: 'MSF-909' }],
    gates: 71,
    esperando: 20,
    leidos: 781,
  })
  assert.match(resumen, /Gates sin fecha de vencimiento en MSF: 1 de 20 gates esperando decisión/)
  assert.doesNotMatch(resumen, /de 781 ítems del board/)
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

test('el proyecto se valida (^[A-Za-z0-9_-]+$) antes de armar la ruta de la API', async () => {
  assert.equal(esProyectoValido('MSF'), true)
  assert.equal(esProyectoValido('MSF_2-b'), true)
  for (const malo of ['', '../otro', 'MSF/issues', 'MSF?x=1', 'MSF X', undefined]) {
    assert.equal(esProyectoValido(malo), false, String(malo))
  }
  let llamadas = 0
  await assert.rejects(
    () => ejecutar({ proyecto: '../otro', fetchImpl: async () => { llamadas++ }, url: 'https://tracker.test', clave: 'x' }),
    /Proyecto inválido/,
  )
  assert.equal(llamadas, 0)
})
