#!/usr/bin/env node
// Vencimientos de los gates del tracker (It's a Plan).
//
// El contrato de vitalidad le da al gate humano un vencimiento de 24 h, pero ese
// vencimiento no está escrito en el ítem: el board guarda la fecha de vencimiento
// (`dueDate`) y los gates la tenían vacía. Esta herramienta le pone a cada gate que
// espera decisión la fecha en que esa decisión vence (24 h desde que el ítem entró a la
// columna en la que espera), para que el tablero muestre el plazo y se pueda ver qué
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

/** Fecha (YYYY-MM-DD) de un instante, en la zona del board. */
function fechaEnZona(instante, zona = ZONA) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

/**
 * Fecha de vencimiento del gate: el plazo del contrato (24 h) contado desde que el
 * ítem empezó a esperar en su columna. El tracker guarda fecha y no hora, así que el
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
 * Plan de cambios: un ítem por gate, con la fecha que le corresponde.
 * @param {object[]} candidatos
 * @param {(id:number)=>Promise<object>} detalle detalle del ítem (`statusSince`)
 */
export async function calcularPlan(candidatos, detalle) {
  const plan = []
  for (const item of candidatos) {
    const info = await detalle(item.id)
    const desde = info.statusSince ?? info.createdAt
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
 * Corre el barrido sobre el board.
 * @param {{fetchImpl?: typeof fetch, proyecto?: string, aplicar?: boolean, url?: string, clave?: string}} opciones
 */
export async function ejecutar({
  fetchImpl = fetch,
  proyecto = PROYECTO_POR_DEFECTO,
  aplicar = false,
  url = URL_POR_DEFECTO,
  clave = process.env.ITSAPLAN_API_KEY ?? '',
} = {}) {
  const api = crearCliente(fetchImpl, { url, clave })
  const meta = await api.get(`/projects/${proyecto}`)
  const etiquetas = new Map(meta.labels.map((l) => [l.id, l.name]))
  const columnas = new Map(meta.columns.map((c) => [c.id, c]))
  const items = []
  for (const tipo of meta.issueTypes) {
    const lote = await api.listar(
      `/projects/${proyecto}/issues?typeId=${tipo.id}&limit=500&includeArchived=true`,
    )
    for (const item of lote) items.push(item)
  }
  const candidatos = seleccionarGates(items, { etiquetas, columnas })
  const plan = await calcularPlan(candidatos, (id) => api.get(`/issues/${id}`))
  if (aplicar) {
    for (const p of plan) await api.patch(`/issues/${p.id}`, { dueDate: p.dueDate })
  }
  return { plan, total: items.length, columnas }
}

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const proyecto = arg('proyecto') ?? process.env.ITSAPLAN_PROYECTO ?? PROYECTO_POR_DEFECTO
  if (!process.env.ITSAPLAN_API_KEY) {
    console.error('Falta ITSAPLAN_API_KEY (clave personal del tracker; nunca va en el repo).')
    process.exit(1)
  }
  const { plan, total, columnas } = await ejecutar({ proyecto, aplicar })
  console.log(
    `Gates sin fecha de vencimiento en ${proyecto}: ${plan.length} de ${total} ítems del board.`,
  )
  for (const p of plan) {
    console.log(
      `  ${p.identifier} (id ${p.id})  ${columnas.get(p.column)?.name ?? '?'}  vence ${p.dueDate}  ${p.title.slice(0, 60)}`,
    )
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
