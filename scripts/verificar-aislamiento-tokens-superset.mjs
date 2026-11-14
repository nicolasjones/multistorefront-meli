// Prueba contra un Superset REAL (no corre en `pnpm test`: necesita un Superset con los tableros de inventario
// importados): un guest token del tablero «Inventario · Productos y stock (cantidades)» NO puede leer el dataset
// con costos (`inventario_productos_stock`) por `/api/v1/chart/data`, aunque el rol Guest sea uno solo.
//
// Usa el mismo código que `emitir-acceso-reporte` (`reglasDatasetsVedados`, `clausulaRls`) para armar las reglas
// `rls` del token y comprueba dos cosas:
//   1. CONTROL: un token del tablero con costos (sin reglas vedadas) SÍ puede consultar ese dataset (200), lo que
//      demuestra que el endpoint y el rol Guest están bien y que el bloqueo no es un error de la prueba.
//   2. AISLAMIENTO: el token del tablero de cantidades, con la regla `1 = 0` del dataset vedado, recibe 403 o
//      cero filas del dataset con costos. (Con la regla `rls` por dataset lo esperable es 200 con cero filas, no 403.)
//
// Uso (solo lectura sobre Superset; no escribe nada):
//   SUPERSET_URL=http://localhost:8088 SUPERSET_GUEST_TOKEN_USERNAME=... SUPERSET_GUEST_TOKEN_PASSWORD=... \
//   DASHBOARD_UUID_CANTIDADES=<uuid de embebido> DASHBOARD_UUID_COSTOS=<uuid de embebido> \
//   ORGANIZACION_ID=<uuid de una organización con productos con costo> \
//   node scripts/verificar-aislamiento-tokens-superset.mjs
// Los UUID de embebido son `reportes.superset_dashboard_uuid` de «Inventario · Productos y stock» y de
// «... (cantidades)». Documentado en docs/operar-superset.md.
import { clausulaRls, reglasDatasetsVedados } from '../supabase/functions/emitir-acceso-reporte/handler.ts'

const DATASET_CON_COSTOS = 'inventario_productos_stock'

function requerida(nombre) {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta la variable ${nombre}.`)
  return valor
}

const url = requerida('SUPERSET_URL').replace(/\/$/, '')
const dashboards = { cantidades: requerida('DASHBOARD_UUID_CANTIDADES'), costos: requerida('DASHBOARD_UUID_COSTOS') }
const organizacion = requerida('ORGANIZACION_ID')
const timeout = () => AbortSignal.timeout(15_000)

const login = await fetch(`${url}/api/v1/security/login`, {
  method: 'POST',
  signal: timeout(),
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: requerida('SUPERSET_GUEST_TOKEN_USERNAME'),
    password: requerida('SUPERSET_GUEST_TOKEN_PASSWORD'),
    provider: 'db',
    refresh: false,
  }),
})
if (!login.ok) throw new Error(`Login en Superset: HTTP ${login.status}.`)
const { access_token: accessToken } = await login.json()

const vedados = await reglasDatasetsVedados([DATASET_CON_COSTOS], { url, accessToken, fetch, signal: timeout })
if (!vedados) {
  throw new Error(`No se pudo resolver el dataset ${DATASET_CON_COSTOS} (¿importado? ¿la cuenta de servicio tiene can_read Dataset y all_datasource_access?).`)
}
const datasetId = vedados[0].dataset

async function tokenDe(dashboardUuid, reglas) {
  const res = await fetch(`${url}/api/v1/security/guest_token/`, {
    method: 'POST',
    signal: timeout(),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      resources: [{ type: 'dashboard', id: dashboardUuid }],
      rls: [{ clause: clausulaRls(organizacion) }, ...reglas],
      user: { username: 'guest' },
    }),
  })
  if (!res.ok) throw new Error(`guest_token: HTTP ${res.status}.`)
  return (await res.json()).token
}

// Pide al dataset con costos las columnas de costo y valor, como lo haría un cliente malicioso con el token.
async function consultarCostos(guestToken) {
  const res = await fetch(`${url}/api/v1/chart/data`, {
    method: 'POST',
    signal: timeout(),
    headers: { 'Content-Type': 'application/json', 'X-GuestToken': guestToken },
    body: JSON.stringify({
      datasource: { id: datasetId, type: 'table' },
      force: true,
      queries: [{ columns: ['producto_nombre', 'costo', 'costo_ars', 'valor_ars'], row_limit: 50, orderby: [] }],
      result_format: 'json',
      result_type: 'full',
    }),
  })
  let filas = null
  if (res.ok) filas = ((await res.json()).result?.[0]?.data ?? []).length
  return { status: res.status, filas }
}

let fallo = false
const comprobar = (condicion, mensaje) => {
  console.log(`${condicion ? 'OK   ' : 'FALLA'} ${mensaje}`)
  if (!condicion) fallo = true
}

const control = await consultarCostos(await tokenDe(dashboards.costos, []))
comprobar(control.status === 200, `control: el token del tablero con costos consulta el dataset (HTTP ${control.status}, ${control.filas} filas)`)
if (control.status === 200 && control.filas === 0) {
  console.log('AVISO la organización no tiene productos con stock: el control no demuestra nada; usá una con datos.')
  fallo = true
}

const aislado = await consultarCostos(await tokenDe(dashboards.cantidades, vedados))
comprobar(
  aislado.status === 403 || (aislado.status === 200 && aislado.filas === 0),
  `aislamiento: el token del tablero de cantidades no lee costos (HTTP ${aislado.status}, ${aislado.filas ?? '-'} filas)`,
)

const sinRegla = await consultarCostos(await tokenDe(dashboards.cantidades, []))
console.log(`INFO  sin la regla vedada, el mismo token leería ${sinRegla.filas ?? '-'} filas (HTTP ${sinRegla.status}): es lo que cierra la regla rls.`)

process.exit(fallo ? 1 : 0)
