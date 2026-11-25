#!/usr/bin/env node
// Vencimientos de los gates del tracker (It's a Plan).
//
// El contrato de vitalidad le da al gate humano un vencimiento de 24 h, pero ese
// vencimiento no está escrito en el ítem: el board guarda la fecha de vencimiento
// (`dueDate`) y los gates la tenían vacía. Esta herramienta le pone a cada gate que
// espera decisión la fecha en que esa decisión vence (24 h desde que el ítem recibió por
// última vez una etiqueta de gate que sigue puesta, que es cuando el watchdog empieza a contarlo; sin esa
// entrada en el historial, desde que entró a su columna), para que el tablero muestre el
// plazo y se pueda ver qué
// decisión está vencida.
//
// Uso:
//   node scripts/vencimientos-gates.mjs                 # simulación: no escribe nada
//   node scripts/vencimientos-gates.mjs --aplicar       # pone la fecha en el board
//   node scripts/vencimientos-gates.mjs --proyecto MSF
//
// Necesita `ITSAPLAN_API_KEY` (clave personal del tracker, nunca en el repo).
import { fileURLToPath } from 'node:url'

/** Etiquetas del tracker que marcan un ítem que espera una decisión. */
const ETIQUETAS_GATE = ['gate', 'decision', 'escala-humano']
/** Plazo del gate humano según el contrato de vitalidad. */
const HORAS_PLAZO = 24
/** Zona del board: la fecha de vencimiento se expresa en esta zona (UTC-3, sin horario de verano). */
const ZONA = 'America/Argentina/Buenos_Aires'
const PROYECTO_POR_DEFECTO = 'MSF'
const URL_POR_DEFECTO = 'https://api.plan.agenmatica.com'
/** Máximo de ítems por lectura: la API no pagina (ignora `offset`/`page`) y corta en 500,
 *  así que a partir de este límite la lectura quedaría incompleta y hay que avisar en vez
 *  de callar. */
const LIMITE_POR_LECTURA = 500

/** Fecha (YYYY-MM-DD) de un instante, en la zona del board. */
function fechaEnZona(instante, zona = ZONA) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

// El proyecto se interpola en la ruta de la API (`/projects/${proyecto}`): sólo su clave.
const PROYECTO_VALIDO = /^[A-Za-z0-9_-]+$/

export function esProyectoValido(proyecto) {
  return typeof proyecto === 'string' && PROYECTO_VALIDO.test(proyecto)
}

/**
 * Fecha de vencimiento del gate: el plazo del contrato (24 h) contado desde que el
 * ítem empezó a esperar la decisión. El tracker guarda fecha y no hora, así que el
 * plazo se redondea al día.
 * @param {string} desde instante ISO en que el ítem empezó a esperar
 * @param {number} horas plazo en horas
 * @param {string} zona
 * @returns {string} YYYY-MM-DD
 */
export function fechaVencimiento(desde, horas = HORAS_PLAZO, zona = ZONA) {
  const instante = new Date(desde)
  if (Number.isNaN(instante.getTime())) throw new Error(`Fecha inválida: ${desde}`)
  return fechaEnZona(new Date(instante.getTime() + horas * 3600 * 1000), zona)
}

/** ¿El ítem lleva alguna de las etiquetas de gate? */
export function esGate(item, etiquetas) {
  return (item.labelIds ?? []).some((id) => ETIQUETAS_GATE.includes(etiquetas.get(id)))
}

/**
 * ¿El ítem sigue esperando una decisión? Los archivados y los que ya llegaron a una
 * columna terminal del flujo (stateType `completed`) ya no esperan.
 */
export function esperaDecision(item, columnas) {
  if (item.archived) return false
  return columnas.get(item.columnId)?.stateType !== 'completed'
}

/**
 * Gates que esperan decisión y no tienen fecha de vencimiento.
 * @param {object[]} items ítems del board
 * @param {{etiquetas: Map<number,string>, columnas: Map<number,object>}} tablero
 */
export function seleccionarGates(items, { etiquetas, columnas }) {
  return items.filter(
    (item) => esGate(item, etiquetas) && esperaDecision(item, columnas) && !item.dueDate,
  )
}

/**
 * Instante en que el ítem recibió por última vez una etiqueta de gate que sigue puesta: es
 * cuando el watchdog lo empieza a contar como esperando una decisión. Entradas del feed del
 * ítem (`kind: activity`): `label_add` con `payload.to.value` = nombre de la etiqueta. Una
 * etiqueta que se quitó después de agregarla (`label_remove`, `payload.from.value`) ya no
 * cuenta; si el ítem la recibió de nuevo, vale la entrada más nueva.
 * @param {object[]} feed actividad del ítem, en cualquier orden
 * @returns {string|null} instante ISO, o null si el historial no tiene esa entrada
 */
export function ultimaEtiquetaGate(feed) {
  const instanteDe = (it) => {
    const t = new Date(it.createdAt)
    return Number.isNaN(t.getTime()) ? null : t
  }
  const agregada = new Map() // etiqueta -> instante más nuevo en que se agregó
  const quitada = new Map() // etiqueta -> instante más nuevo en que se quitó
  for (const it of feed ?? []) {
    if (it?.kind !== 'activity') continue
    const esAlta = it.action === 'label_add'
    const esBaja = it.action === 'label_remove'
    if (!esAlta && !esBaja) continue
    const nombre = esAlta ? it.payload?.to?.value : it.payload?.from?.value
    if (!ETIQUETAS_GATE.includes(nombre)) continue
    const t = instanteDe(it)
    if (!t) continue
    const mapa = esAlta ? agregada : quitada
    if (!mapa.has(nombre) || t > mapa.get(nombre)) mapa.set(nombre, t)
  }
  let ultimo = null
  for (const [nombre, t] of agregada) {
    const baja = quitada.get(nombre)
    if (baja && baja >= t) continue // se quitó después de agregarla
    if (!ultimo || t > ultimo) ultimo = t
  }
  return ultimo ? ultimo.toISOString() : null
}

/**
 * Plan de cambios: un ítem por gate, con la fecha que le corresponde. El plazo se cuenta
 * desde la última vez que el ítem recibió una etiqueta de gate; sin esa entrada en el
 * historial (o sin lector de historial) cae a `statusSince` y, si falta, a `createdAt`.
 * @param {object[]} candidatos
 * @param {(id:number)=>Promise<object>} detalle detalle del ítem (`statusSince`)
 * @param {(id:number, item:object)=>Promise<object[]>} [actividad] feed de actividad del ítem
 */
export async function calcularPlan(candidatos, detalle, actividad) {
  const plan = []
  for (const item of candidatos) {
    const info = await detalle(item.id)
    const marcado = actividad ? ultimaEtiquetaGate(await actividad(item.id, item)) : null
    const desde = marcado ?? info.statusSince ?? info.createdAt
    plan.push({
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      column: item.columnId,
      dueDate: fechaVencimiento(desde),
    })
  }
  return plan
}

/**
 * Contrasta las dos lecturas del board: cada gate tiene que aparecer en la lectura de
 * su tipo y ningún gate de la lectura por tipo puede faltar en la lectura por etiqueta.
 *
 * La API no pagina: si una lectura vuelve truncada (el tope real de página está por
 * debajo del `limit` pedido) el barrido no se puede dar por completo y no se puede
 * afirmar que no quedan gates sin fecha. Con el contraste, un gate que falta en una de
 * las dos lecturas delata la lectura truncada y el barrido corta antes de escribir.
 *
 * @param {Map<number,object>} gates ítems con etiqueta de gate (lectura por etiqueta)
 * @param {Map<number,object[]>} porTipo ítems por tipo (lectura por tipo)
 * @param {{etiquetas: Map<number,string>}} tablero
 */
export function contrastarBoard(gates, porTipo, { etiquetas }) {
  for (const item of gates.values()) {
    const lote = porTipo.get(item.typeId)
    if (!lote) continue // ítem sin tipo conocido: no hay lectura con la que contrastarlo
    if (!lote.some((otro) => otro.id === item.id)) {
      throw new Error(
        `El gate ${item.identifier} (id ${item.id}) no aparece en la lectura de su tipo ` +
          `${item.typeId}: el board se leyó incompleto y el barrido no puede afirmar ` +
          `que no quedan gates sin fecha.`,
      )
    }
  }
  for (const [tipoId, lote] of porTipo) {
    const delTipo = lote.filter((otro) => esGate(otro, etiquetas))
    const faltan = delTipo.filter((otro) => !gates.has(otro.id))
    if (faltan.length) {
      throw new Error(
        `La lectura del tipo ${tipoId} tiene ${delTipo.length} gates y ${faltan.length} no ` +
          `están en la lectura por etiqueta (por ejemplo ${faltan[0].identifier}): el board ` +
          `se leyó incompleto y el barrido no puede afirmar que no quedan gates sin fecha.`,
      )
    }
  }
}

/** Cliente mínimo de la API del tracker. */
export function crearCliente(fetchImpl, { url = URL_POR_DEFECTO, clave = '' } = {}) {
  const base = url.replace(/\/+$/, '')
  const pedir = async (ruta, init = {}) => {
    const r = await fetchImpl(`${base}${ruta}`, {
      ...init,
      headers: { 'x-api-key': clave, ...init.headers },
    })
    if (!r.ok) throw new Error(`ItsAPlan ${ruta}: ${r.status} ${(await r.text()).slice(0, 300)}`)
    return r.json()
  }
  return {
    get: (ruta) => pedir(ruta),
    listar: async (ruta) => {
      const datos = await pedir(ruta)
      return Array.isArray(datos) ? datos : (datos?.data ?? [])
    },
    // Sólo `dueDate`: mandar `labelIds` en el PATCH reemplazaría las etiquetas del ítem.
    patch: (ruta, cuerpo) =>
      pedir(ruta, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
      }),
  }
}

/**
 * Lee el board de dos maneras independientes: por etiqueta de gate (lectura chica: sólo
 * los gates) y por tipo de ítem (lectura grande: todo el tipo). Los archivados no se
 * leen: la regla ya los descarta y sólo consumen el tope de la lectura.
 * @param {{listar: (ruta:string)=>Promise<object[]>}} api
 * @param {{proyecto: string, meta: object}} contexto
 */
async function leerBoard(api, { proyecto, meta }) {
  const etiquetasGate = meta.labels.filter((l) => ETIQUETAS_GATE.includes(l.name))
  if (!etiquetasGate.length) {
    throw new Error(
      `El proyecto ${proyecto} no tiene ninguna etiqueta de gate (${ETIQUETAS_GATE.join(', ')}): ` +
        `no se puede leer el board.`,
    )
  }
  const gates = new Map()
  for (const etiqueta of etiquetasGate) {
    const lote = await api.listar(
      `/projects/${proyecto}/issues?labelIds=${etiqueta.id}&limit=${LIMITE_POR_LECTURA}`,
    )
    if (lote.length >= LIMITE_POR_LECTURA) {
      throw new Error(
        `La etiqueta "${etiqueta.name}" tiene ${lote.length} ítems y la API no pagina más: ` +
          `no se puede saber si quedan gates sin fecha.`,
      )
    }
    for (const item of lote) gates.set(item.id, item)
  }
  const porTipo = new Map()
  let leidos = 0
  for (const tipo of meta.issueTypes) {
    const lote = await api.listar(
      `/projects/${proyecto}/issues?typeId=${tipo.id}&limit=${LIMITE_POR_LECTURA}`,
    )
    if (lote.length >= LIMITE_POR_LECTURA) {
      throw new Error(
        `El tipo ${tipo.name} (id ${tipo.id}) tiene ${lote.length} ítems y la API no pagina ` +
          `más: el barrido quedaría incompleto.`,
      )
    }
    porTipo.set(tipo.id, lote)
    leidos += lote.length
  }
  // Falso verde: si las dos lecturas vienen vacías (la API cambió la forma de la
  // respuesta, el filtro dejó de matchear o el board no tiene ítems), el barrido
  // terminaría con «0 de 0 gates esperando decisión» y salida 0, sin poder afirmar
  // que no quedan gates sin fecha. Se corta antes de calcular el plan.
  if (leidos === 0 && gates.size === 0) {
    throw new Error(
      `El board de ${proyecto} no devolvió ningún ítem (la lectura por etiqueta y la ` +
        `lectura por tipo vinieron vacías): la API cambió la forma de la respuesta o el ` +
        `filtro dejó de matchear, y el barrido no puede afirmar que no quedan gates sin fecha.`,
    )
  }
  return { gates, porTipo, leidos }
}

/** Tope de páginas del feed por ítem (100 entradas por página). */
export const PAGINAS_FEED = 20

/**
 * Feed de actividad de un ítem, paginado por cursor (viene del más nuevo al más viejo).
 * Un error de la API se propaga (el barrido corta antes de escribir). Si el feed supera el
 * tope de páginas se avisa con el identificador del ítem y se sigue con lo leído: el plan
 * puede caer a `statusSince`.
 * @param {{get: (ruta:string)=>Promise<object>}} api
 * @param {{id:number, identifier?:string}} item
 * @param {(mensaje:string)=>void} avisar
 */
export async function leerActividad(api, item, avisar = console.warn) {
  const items = []
  let cursor = null
  for (let i = 0; i < PAGINAS_FEED; i++) {
    const q = `?limit=100${cursor ? `&cursor=${encodeURIComponent(JSON.stringify(cursor))}` : ''}`
    const pagina = await api.get(`/issues/${item.id}/feed${q}`)
    items.push(...(pagina?.items ?? []))
    cursor = pagina?.nextCursor
    if (!cursor) return items
  }
  avisar(
    `Aviso: el feed de ${item.identifier ?? item.id} supera ${PAGINAS_FEED} páginas; ` +
      `se usa lo leído y, si falta la etiqueta de gate, statusSince.`,
  )
  return items
}

/**
 * Corre el barrido sobre el board.
 * @param {{fetchImpl?: typeof fetch, proyecto?: string, aplicar?: boolean,
 *   alAplicar?: (item:object)=>void, url?: string, clave?: string}} opciones
 */
export async function ejecutar({
  fetchImpl = fetch,
  proyecto = PROYECTO_POR_DEFECTO,
  aplicar = false,
  alAplicar,
  url = URL_POR_DEFECTO,
  clave = process.env.ITSAPLAN_API_KEY ?? '',
} = {}) {
  if (!esProyectoValido(proyecto)) {
    throw new Error(`Proyecto inválido: «${proyecto}». Se espera la clave (letras, números, «_» o «-»).`)
  }
  const api = crearCliente(fetchImpl, { url, clave })
  const meta = await api.get(`/projects/${proyecto}`)
  const etiquetas = new Map(meta.labels.map((l) => [l.id, l.name]))
  const columnas = new Map(meta.columns.map((c) => [c.id, c]))
  const { gates, porTipo, leidos } = await leerBoard(api, { proyecto, meta })
  contrastarBoard(gates, porTipo, { etiquetas })
  const gatesDelBoard = [...gates.values()]
  // La población de la regla son los gates que **esperan decisión**: los que ya se
  // entregaron (columna terminal) no esperan y no se fechan.
  const esperando = gatesDelBoard.filter((item) => esperaDecision(item, columnas))
  const candidatos = seleccionarGates(esperando, { etiquetas, columnas })
  const plan = await calcularPlan(
    candidatos,
    (id) => api.get(`/issues/${id}`),
    (_id, item) => leerActividad(api, item),
  )
  if (aplicar) {
    for (const p of plan) {
      await api.patch(`/issues/${p.id}`, { dueDate: p.dueDate })
      // Se anota cada ítem apenas se escribe: si un PATCH posterior falla, la salida
      // dice qué quedó puesto y la reversión se puede aplicar con precisión.
      alAplicar?.(p)
    }
  }
  return { plan, gates: gatesDelBoard.length, esperando: esperando.length, leidos, columnas }
}

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * Línea de salida de un ítem aplicado: trae el **id numérico**, que es lo que usa la
 * reversión documentada (`PATCH /issues/<id>` con `{"dueDate": null}`).
 * @param {{identifier:string, id:number, dueDate:string, title:string}} item
 */
export function lineaAplicado(item) {
  return `  aplicado ${item.identifier} (id ${item.id})  vence ${item.dueDate}  ${item.title.slice(0, 60)}`
}

/**
 * Línea de salida del barrido: el denominador son los gates que **esperan decisión**
 * (no los ítems del board, que no son la población de la regla).
 * @param {{proyecto:string, plan:object[], gates:number, esperando:number, leidos:number}} datos
 */
export function lineaResumen({ proyecto, plan, gates, esperando, leidos }) {
  return (
    `Gates sin fecha de vencimiento en ${proyecto}: ${plan.length} de ${esperando} gates ` +
    `esperando decisión (${gates} gates del board, ${leidos} ítems leídos para el contraste).`
  )
}

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const proyecto = arg('proyecto') ?? process.env.ITSAPLAN_PROYECTO ?? PROYECTO_POR_DEFECTO
  if (!esProyectoValido(proyecto)) {
    console.error(`--proyecto / ITSAPLAN_PROYECTO inválido: «${proyecto}». Se espera la clave (^[A-Za-z0-9_-]+$).`)
    process.exit(2)
  }
  if (!process.env.ITSAPLAN_API_KEY) {
    console.error('Falta ITSAPLAN_API_KEY (clave personal del tracker; nunca va en el repo).')
    process.exit(1)
  }
  console.log(`Leyendo el board de ${proyecto}...`)
  const { plan, gates, esperando, leidos, columnas } = await ejecutar({
    proyecto,
    aplicar,
    alAplicar: (p) => console.log(lineaAplicado(p)),
  })
  console.log(lineaResumen({ proyecto, plan, gates, esperando, leidos }))
  if (!aplicar) {
    for (const p of plan) {
      console.log(
        `  ${p.identifier} (id ${p.id})  ${columnas.get(p.column)?.name ?? '?'}  vence ${p.dueDate}  ${p.title.slice(0, 60)}`,
      )
    }
  }
  console.log(
    aplicar
      ? `Fecha puesta en ${plan.length} ítem(s).`
      : `Simulación: no se escribió nada. Repetí con --aplicar para poner la fecha.`,
  )
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Falló el barrido de vencimientos: ${e.message}`)
    process.exit(1)
  })
}
