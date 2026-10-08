#!/usr/bin/env node
// Verificación real de punta a punta de la analítica embebida (spec 007)
// contra un stack levantado: Supabase + Edge Functions + Superset. Sigue el
// mismo camino que el SDK embebido en el navegador de Refine, sin
// credenciales admin de Superset:
//
//   1. login en Supabase con un usuario real y lista de public.reportes
//      visible por RLS;
//   2. emitir-acceso-reporte por cada reporte → guest token;
//   3. GET /embedded/<uuid> con el Referer del origen de Refine: es el
//      chequeo de allow_domain_list que hace Superset al cargar el iframe (403
//      si el origen no está permitido). De su bootstrap sale el dashboard_id;
//   4. con el guest token: charts del dashboard y POST /api/v1/chart/data
//      por cada uno, armado desde el form_data guardado del chart.
//
// Nunca imprime tokens. Sale con código 1 si falla cualquier paso.
//
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY (o SUPABASE_PUBLISHABLE_KEY),
// VERIFICAR_EMAIL, VERIFICAR_PASSWORD, WEB_ORIGIN (default
// http://localhost:$WEB_PORT). Ver docs/operar-superset.md.

const env = process.env
const supabaseUrl = env.SUPABASE_URL ?? `http://127.0.0.1:${env.SUPABASE_API_PORT ?? '8100'}`
const apikey = env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY
const webOrigin = env.WEB_ORIGIN ?? `http://localhost:${env.WEB_PORT ?? '3100'}`
const email = env.VERIFICAR_EMAIL
const password = env.VERIFICAR_PASSWORD
const timeoutMs = 20_000

if (!apikey || !email || !password) {
  console.error('Faltan SUPABASE_ANON_KEY (o SUPABASE_PUBLISHABLE_KEY), VERIFICAR_EMAIL o VERIFICAR_PASSWORD.')
  process.exit(2)
}

async function pedir(url, opciones = {}) {
  const res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(timeoutMs) })
  const texto = await res.text()
  let cuerpo = texto
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    // HTML (página /embedded) o texto plano.
  }
  return { status: res.status, ok: res.ok, cuerpo }
}

function resumen(cuerpo) {
  return (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)).slice(0, 160)
}

// Réplica mínima de lo que el frontend arma desde form_data: solo métricas y
// columnas ya guardadas en el chart. Superset rechaza a un guest que pida
// algo distinto de lo guardado (chequeo de form_data adulterado).
function consultaDelChart(formData, dashboardId, chartId) {
  const metricas = formData.metrics ?? (formData.metric ? [formData.metric] : [])
  const columnas = metricas.length
    ? []
    : formData.all_columns?.length
      ? formData.all_columns
      : (formData.groupby ?? formData.columns ?? [])
  const [datasetId, datasetTipo] = String(formData.datasource).split('__')
  return {
    datasource: { id: Number(datasetId), type: datasetTipo },
    form_data: { ...formData, dashboardId, slice_id: chartId },
    queries: [{ metrics: metricas, columns: columnas, row_limit: 5 }],
    result_format: 'json',
    result_type: 'full',
  }
}

const fallos = []
const falla = (msg) => {
  fallos.push(msg)
  console.log(`  FALLA ${msg}`)
}

const login = await pedir(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
if (!login.ok) {
  console.error(`Login en Supabase: ${login.status} ${resumen(login.cuerpo)}`)
  process.exit(1)
}
const auth = { apikey, authorization: `Bearer ${login.cuerpo.access_token}` }

const reportes = await pedir(`${supabaseUrl}/rest/v1/reportes?select=id,nombre&order=nombre`, { headers: auth })
if (!reportes.ok || !Array.isArray(reportes.cuerpo) || reportes.cuerpo.length === 0) {
  console.error(`Sin reportes visibles para ${email}: ${reportes.status} ${resumen(reportes.cuerpo)}`)
  process.exit(1)
}
console.log(`Origen de Refine: ${webOrigin} · ${reportes.cuerpo.length} reportes`)

for (const reporte of reportes.cuerpo) {
  console.log(`\n# ${reporte.nombre}`)
  const acceso = await pedir(`${supabaseUrl}/functions/v1/emitir-acceso-reporte`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ reporte_id: reporte.id }),
  }).catch((error) => ({ status: 0, ok: false, cuerpo: error.message }))
  if (!acceso.ok) {
    falla(`emitir-acceso-reporte: ${acceso.status} ${resumen(acceso.cuerpo)}`)
    continue
  }
  console.log('  emitir-acceso-reporte: 200')
  const { guest_token: guestToken, superset_url: supersetUrl, dashboard_uuid: uuid } = acceso.cuerpo

  const embebido = await pedir(`${supersetUrl}/embedded/${uuid}?uiConfig=1`, {
    headers: { Referer: `${webOrigin}/reportes` },
  })
  if (!embebido.ok) {
    falla(`/embedded/${uuid} con Referer ${webOrigin}: ${embebido.status} (¿origen fuera de allow_domain_list?)`)
    continue
  }
  const bootstrap = /data-bootstrap="([^"]*)"/.exec(embebido.cuerpo)?.[1]?.replaceAll('&#34;', '"').replaceAll('&amp;', '&')
  const dashboardId = bootstrap ? JSON.parse(bootstrap).embedded?.dashboard_id : undefined
  if (!dashboardId) {
    falla(`/embedded/${uuid}: el bootstrap no trae embedded.dashboard_id`)
    continue
  }
  console.log(`  /embedded: 200 (dashboard ${dashboardId})`)

  const guest = { 'X-GuestToken': guestToken }
  const charts = await pedir(`${supersetUrl}/api/v1/dashboard/${dashboardId}/charts`, { headers: guest })
  if (!charts.ok) {
    falla(`charts del dashboard ${dashboardId}: ${charts.status} ${resumen(charts.cuerpo)}`)
    continue
  }
  for (const chart of charts.cuerpo.result) {
    const datos = await pedir(`${supersetUrl}/api/v1/chart/data`, {
      method: 'POST',
      headers: { ...guest, 'content-type': 'application/json' },
      body: JSON.stringify(consultaDelChart(chart.form_data, dashboardId, chart.id)),
    })
    if (!datos.ok) {
      falla(`chart ${chart.id} "${chart.slice_name}": ${datos.status} ${resumen(datos.cuerpo)}`)
      continue
    }
    const filas = datos.cuerpo.result.map((q) => q.rowcount).join('/')
    console.log(`  chart ${chart.id} "${chart.slice_name}": 200, ${filas} filas`)
  }
}

console.log(fallos.length ? `\n${fallos.length} fallos` : '\nTodo OK')
process.exit(fallos.length ? 1 : 0)
