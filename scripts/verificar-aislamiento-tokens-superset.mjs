// Prueba contra un Superset REAL (no corre en `pnpm test`: necesita un Superset con TODOS los tableros importados):
// el guest token de cada tablero NO puede leer los datasets de otros tableros aunque el rol Guest sea uno solo
// (allowlist: `reportes.datasets_permitidos` + regla `rls` `1 = 0` por dataset ajeno, ver `reglasDatasetsAjenos`).
//
// Para CADA reporte de infra/superset/dashboards/*/reportes.json (p. ej. «Inventario · Reposición» y el de
// «(cantidades)», que ven los roles sin `ver_costos`) arma el token con el mismo código que `emitir-acceso-reporte`
// y lo prueba contra CADA dataset ajeno (el de costos, Rentabilidad, Service, Ventas, Consultas...) por cuatro vías:
//   1. POST /api/v1/chart/data        (JSON)
//   2. POST /api/v1/chart/data        (result_format=csv: la exportación)
//   3. GET  /api/v1/datasource/table/{id}/column/{columna}/values/
//   4. POST /api/v1/datasource/samples
// OK = 200 SIN filas, o 403/404 cuando se puede explicar (control positivo sobre el dataset propio: ver `veredicto`).
// Además un CONTROL por tablero: su propio dataset responde 200 (la regla no rompe el
// tablero) y, sin la regla, el mismo token leería el dataset ajeno (muestra que la prueba detecta la fuga).
//
// Solo hace GET (lectura de embebidos y columnas) y POST de consulta/token; no escribe nada en Superset ni en Supabase.
// No imprime credenciales ni tokens: solo códigos HTTP y conteos de filas. Correr SOLO contra un Superset que se pueda
// consultar (local o un entorno de prueba), nunca por defecto contra STG/PROD.
//
// Variables de entorno (todas obligatorias salvo SOLO):
//   SUPERSET_URL                     base de Superset (p. ej. http://localhost:8088)
//   SUPERSET_USERNAME / _PASSWORD    usuario de lectura (solo GET: UUID de embebido y columnas de los datasets)
//   SUPERSET_GUEST_TOKEN_USERNAME / _PASSWORD   la cuenta de servicio de los guest tokens (la de la Edge Function)
//   ORGANIZACION_ID                  UUID de una organización CON datos en los tableros (si no, el control no prueba nada)
//   SOLO                             (opcional) un `dashboard_slug` para probar un solo tablero
// Ejemplo:  pnpm test:superset:aislamiento-tokens   (con las variables exportadas). Detalle: docs/operar-superset.md.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { datasetsPermitidos } from '../infra/superset/datasets-tablero.mjs'
import { clausulaRls, listarDatasets, reglasDatasetsAjenos } from '../supabase/functions/emitir-acceso-reporte/handler.ts'

function requerida(nombre) {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta la variable ${nombre}.`)
  return valor
}

const url = requerida('SUPERSET_URL').replace(/\/$/, '')
const organizacion = requerida('ORGANIZACION_ID')
const solo = process.env.SOLO
const timeout = () => AbortSignal.timeout(20_000)

async function login(usuario, clave) {
  const res = await fetch(`${url}/api/v1/security/login`, {
    method: 'POST',
    signal: timeout(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: clave, provider: 'db', refresh: false }),
  })
  if (!res.ok) throw new Error(`Login en Superset: HTTP ${res.status}.`)
  return (await res.json()).access_token
}

const lectura = await login(requerida('SUPERSET_USERNAME'), requerida('SUPERSET_PASSWORD'))
const servicio = await login(requerida('SUPERSET_GUEST_TOKEN_USERNAME'), requerida('SUPERSET_GUEST_TOKEN_PASSWORD'))
const conServicio = { url, accessToken: servicio, fetch, signal: timeout }

async function getJson(ruta) {
  const res = await fetch(`${url}${ruta}`, { signal: timeout(), headers: { Authorization: `Bearer ${lectura}` } })
  if (!res.ok) throw new Error(`GET ${ruta}: HTTP ${res.status}.`)
  return res.json()
}

const todosLosDatasets = await listarDatasets(conServicio)
if (!todosLosDatasets) {
  throw new Error('No se pudo listar los datasets con la cuenta de servicio (¿tiene can_read Dataset y all_datasource_access?).')
}

const columnasCache = new Map()
async function columnasDe(datasetId) {
  if (!columnasCache.has(datasetId)) {
    const { result } = await getJson(`/api/v1/dataset/${datasetId}`)
    columnasCache.set(datasetId, (result.columns ?? []).map((c) => c.column_name))
  }
  return columnasCache.get(datasetId)
}

async function tokenDe(dashboardUuid, reglas) {
  const res = await fetch(`${url}/api/v1/security/guest_token/`, {
    method: 'POST',
    signal: timeout(),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${servicio}` },
    body: JSON.stringify({
      resources: [{ type: 'dashboard', id: dashboardUuid }],
      // Cláusula global solo por organización (la más débil): si el tablero filtrara también por empresa, el resultado
      // sería vacío por otra causa y la prueba no demostraría nada.
      rls: [{ clause: clausulaRls(organizacion) }, ...reglas],
      user: { username: 'guest' },
    }),
  })
  if (!res.ok) throw new Error(`guest_token: HTTP ${res.status}.`)
  return (await res.json()).token
}

const conGuest = (guestToken, extra = {}) => ({ signal: timeout(), headers: { 'X-GuestToken': guestToken, 'Content-Type': 'application/json' }, ...extra })

// Cada vía devuelve { status, filas } (filas = null si no hubo cuerpo útil).
async function viaChartData(guestToken, dataset, columnas, formato) {
  const res = await fetch(`${url}/api/v1/chart/data`, conGuest(guestToken, {
    method: 'POST',
    body: JSON.stringify({
      datasource: { id: dataset.id, type: 'table' },
      force: true,
      queries: [{ columns: columnas.slice(0, 5), row_limit: 50, orderby: [] }],
      result_format: formato,
      result_type: 'full',
    }),
  }))
  if (!res.ok) return { status: res.status, filas: null }
  if (formato === 'csv') {
    const texto = await res.text()
    return { status: res.status, filas: Math.max(texto.split('\n').filter((l) => l.trim()).length - 1, 0) }
  }
  return { status: res.status, filas: ((await res.json()).result?.[0]?.data ?? []).length }
}

async function viaValoresDeColumna(guestToken, dataset, columnas) {
  const columna = columnas.find((c) => c !== 'organizacion_id') ?? columnas[0]
  const res = await fetch(`${url}/api/v1/datasource/table/${dataset.id}/column/${encodeURIComponent(columna)}/values/`, conGuest(guestToken))
  if (!res.ok) return { status: res.status, filas: null }
  return { status: res.status, filas: ((await res.json()).result ?? []).length }
}

async function viaSamples(guestToken, dataset) {
  const res = await fetch(`${url}/api/v1/datasource/samples?datasource_id=${dataset.id}&datasource_type=table`, conGuest(guestToken, { method: 'POST', body: '{}' }))
  if (!res.ok) return { status: res.status, filas: null }
  return { status: res.status, filas: ((await res.json()).result?.data ?? []).length }
}

const sinFuga = ({ status, filas }) => status === 403 || status === 404 || (status === 200 && filas === 0)

// Un 403/404 NO se toma como «sin fuga» sin explicar de dónde viene. Cada vía se prueba también sobre un dataset PROPIO
// del tablero (control positivo):
//   - el propio da 200  -> la vía está habilitada para el rol Guest; el ajeno debe dar 200 SIN filas (la regla rls
//                          anuló los datos) o 403/404 (se informa que no es por permiso, porque el propio sí responde).
//   - el propio da 403  -> la vía está cerrada por PERMISO del rol Guest (no por la regla rls): el ajeno también da 403
//                          y se informa así; la regla es solo defensa en profundidad para esa vía.
// En Superset 6.1 `column/values` exige `can_get_column_values` y `samples` exige `can_samples` sobre Datasource; el rol
// Guest de configurar_embebido.py no los tiene, así que se espera 403 de permiso. Si algún día se otorgan, la regla rls
// sigue aplicando (`values_for_column` usa `get_sqla_row_level_filters`, que incluye las reglas del guest token).
function veredicto(via, ajeno, propio) {
  if (propio.status === 200) {
    return { ok: sinFuga(ajeno), nota: `vía habilitada (el propio da 200); ajeno HTTP ${ajeno.status}, ${ajeno.filas ?? '-'} filas` }
  }
  if (propio.status === 403) {
    return { ok: ajeno.status === 403, nota: `vía cerrada por PERMISO del rol Guest (el propio también da 403), no por la regla rls; ajeno HTTP ${ajeno.status}` }
  }
  return { ok: false, nota: `control positivo inconcluyente: el dataset propio dio HTTP ${propio.status}` }
}

let fallos = 0
let comprobaciones = 0
function comprobar(ok, mensaje) {
  comprobaciones += 1
  if (!ok) fallos += 1
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${mensaje}`)
}

const raiz = path.resolve('infra/superset/dashboards')
for (const directorio of await readdir(raiz)) {
  const { reportes } = JSON.parse(await readFile(path.join(raiz, directorio, 'reportes.json'), 'utf8'))
  for (const reporte of reportes) {
    if (solo && reporte.dashboard_slug !== solo) continue
    const etiqueta = reporte.nombre
    const permitidos = await datasetsPermitidos(path.join(raiz, directorio), reporte)
    const { result } = await getJson(`/api/v1/dashboard/${encodeURIComponent(reporte.dashboard_slug)}/embedded`)
    const reglas = await reglasDatasetsAjenos(permitidos, conServicio)
    if (!reglas) {
      comprobar(false, `${etiqueta}: no se pudo armar la allowlist (¿dataset sin importar?)`)
      continue
    }
    const token = await tokenDe(result.uuid, reglas)
    const tokenSinRegla = await tokenDe(result.uuid, [])

    // CONTROL 1: el tablero sigue leyendo sus propios datasets.
    for (const nombre of permitidos) {
      for (const propio of todosLosDatasets.filter((d) => d.table_name === nombre)) {
        const r = await viaChartData(token, propio, await columnasDe(propio.id), 'json')
        comprobar(r.status === 200, `${etiqueta}: lee su dataset ${nombre} (HTTP ${r.status}, ${r.filas ?? '-'} filas)`)
      }
    }

    // CONTROL 1b: las vías column/values y samples sobre un dataset PROPIO (para saber si un 403 es de permiso).
    const propioDataset = todosLosDatasets.find((d) => permitidos.includes(d.table_name))
    const controles = {
      valores: await viaValoresDeColumna(token, propioDataset, await columnasDe(propioDataset.id)),
      samples: await viaSamples(token, propioDataset),
    }

    // AISLAMIENTO: cada dataset ajeno por las cuatro vías.
    for (const { dataset } of reglas) {
      const objetivo = todosLosDatasets.find((d) => d.id === dataset)
      const columnas = await columnasDe(dataset)
      for (const [via, r] of Object.entries({
        'chart/data json': await viaChartData(token, objetivo, columnas, 'json'),
        'chart/data csv': await viaChartData(token, objetivo, columnas, 'csv'),
      })) {
        comprobar(sinFuga(r), `${etiqueta} -> ${objetivo.table_name} por ${via}: HTTP ${r.status}, ${r.filas ?? '-'} filas`)
      }
      for (const [via, ajeno, propio] of [
        ['column values', await viaValoresDeColumna(token, objetivo, columnas), controles.valores],
        ['samples', await viaSamples(token, objetivo), controles.samples],
      ]) {
        const v = veredicto(via, ajeno, propio)
        comprobar(v.ok, `${etiqueta} -> ${objetivo.table_name} por ${via}: ${v.nota}`)
      }
    }

    // CONTROL 2 (informativo): sin la regla el mismo token leería el primer dataset ajeno con datos: la prueba detecta fugas.
    for (const { dataset } of reglas.slice(0, 5)) {
      const objetivo = todosLosDatasets.find((d) => d.id === dataset)
      const r = await viaChartData(tokenSinRegla, objetivo, await columnasDe(dataset), 'json')
      console.log(`INFO  ${etiqueta}: SIN regla, ${objetivo.table_name} devolvería ${r.filas ?? '-'} filas (HTTP ${r.status})`)
    }
  }
}

console.log(`${comprobaciones - fallos}/${comprobaciones} comprobaciones sin fuga.`)
process.exit(fallos ? 1 : 0)
