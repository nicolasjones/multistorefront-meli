// Arma los videos de evidencia por épica y por historia, sin IA (spec 022).
//
// Toma el manifiesto de `cobertura-e2e.mjs` y los videos `.webm` de los tests y
// produce un MP4 1920x1080 por funcionalidad probada (un test = un video): tarjeta
// de entrada con qué se prueba, el recorrido y tarjeta de cierre con el resultado.
// Una historia (ítem Txxx) puede tener varios videos; no hay un video único de la
// épica: la historia lleva los links de sus videos y la épica los de todas.
// Los textos salen del manifiesto (títulos de tests, tasks.md, estado), nunca de un modelo.
//
// Uso:
//   node scripts/armar-video-evidencia.mjs --manifiesto <cobertura.json> --videos <test-results> \
//        --out <dir> [--epica MSF-136] [--publicar [--proyecto MSF]]
//
// Requiere `ffmpeg` en el PATH y Chromium de Playwright (ya instalado para los E2E).
// Con `--publicar` adjunta el MP4 de cada ítem a la historia hija de la épica cuyo título
// menciona su Txxx (si ninguna lo menciona, a la épica), deja en cada historia un comentario con
// sus links y en la épica UN comentario con los links de todas, agrupados por historia; usa ITSAPLAN_API_URL e ITSAPLAN_API_KEY.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEG_TARJETA = 3
const SEG_TARJETA_CRITERIOS = 6
const SEG_CIERRE = 5

const esc = (t) =>
  String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Limpia el texto de un ítem de tasks.md: saca etiquetas [..] y código. */
export function textoItem(texto) {
  return String(texto ?? '')
    .replace(/^(\s*\[[^\]]*\])+\s*/, '')
    .replace(/`/g, '')
    .split(/\.\s|\n/)[0]
    .trim()
    .replace(/^(.{140}).+$/, '$1…')
}

/** Qué funcionalidad prueba un test: el título sin archivo ni etiqueta [EPICA:TASK]. */
export function tituloTest(test) {
  // Todo lo que sigue a la última etiqueta `[...]` (de tareas o de escenarios).
  const t = String(test ?? '').replace(/^.*\]\s*/, '').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Agrupa las evidencias de una épica por ítem (Txxx) → historias del video. */
export function planEpica(manifiesto, epica) {
  const evs = manifiesto.evidencias.filter((e) => e.epica === epica && e.video)
  if (evs.length === 0) return null
  const porItem = new Map()
  for (const e of evs) {
    const item = e.items?.[0]
    // Una tarea etiquetada `[F-STK-02][US1] …` cuelga de su historia; las de cierre, de su Txxx.
    const deTarea = String(item?.texto ?? '').match(/^\[(F-[A-Z]+-\d+)\]/)?.[1]
    const id = e.historia ?? deTarea ?? item?.id ?? 'sin-item'
    if (!porItem.has(id)) porItem.set(id, { id, texto: e.historia ? e.historiaTitulo : textoItem(item?.texto), tests: [] })
    porItem.get(id).tests.push(e)
  }
  const historias = [...porItem.values()].map((h) => ({ ...h, pasados: h.tests.filter((t) => t.estado === 'pasado').length }))
  const tests = evs.length
  const pasados = evs.filter((e) => e.estado === 'pasado').length
  return {
    epica,
    nombre: evs[0].specTitulo?.split('·').pop()?.trim() || evs[0].epicaNombre,
    componente: evs[0].componente,
    spec: evs[0].spec,
    fecha: String(manifiesto.fecha ?? '').slice(0, 10),
    runId: manifiesto.run_id,
    historias,
    tests,
    pasados,
    sinCubrir: (manifiesto.sin_cubrir ?? []).filter((s) => s.epica === epica).length,
  }
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden;background:#070b16;color:#f6f8ff;font-family:system-ui,'Segoe UI',sans-serif}
body{position:relative;background:radial-gradient(1200px 700px at 78% -10%,rgba(79,124,255,.22),transparent 60%),radial-gradient(900px 600px at 8% 110%,rgba(56,217,169,.12),transparent 60%),#070b16}
body::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(154,167,194,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(154,167,194,.055) 1px,transparent 1px);background-size:64px 64px}
.top{position:absolute;left:76px;right:76px;top:54px;display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;gap:16px;align-items:center;font-weight:800;font-size:22px}
.mark{width:44px;height:44px;border-radius:13px;background:linear-gradient(145deg,#6b93ff,#355cff 60%,#7a4dff);display:grid;place-items:center;font-size:18px}
.tag{font-size:14px;color:#9aa7c2;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(154,167,194,.18);padding:9px 14px;border-radius:999px}
main{position:absolute;left:76px;right:76px;top:50%;transform:translateY(-50%)}
.eyebrow{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#4f7cff;font-weight:700}
h1{font-size:128px;line-height:.98;letter-spacing:-.04em;margin-top:26px;font-weight:800}
h1.m{font-size:92px}
.sub{font-size:36px;color:#c7d2ea;margin-top:22px;line-height:1.3;max-width:1500px}
.badge{display:inline-flex;gap:12px;align-items:center;margin-top:40px;padding:14px 20px;border-radius:999px;border:1px solid rgba(56,217,169,.28);background:rgba(56,217,169,.08);color:#b9f5e2;font-size:22px}
.dot{width:10px;height:10px;border-radius:50%;background:#38d9a9}
.stats{display:flex;gap:26px;margin-top:48px}
.stat{min-width:250px;padding:26px 30px;border-radius:16px;background:rgba(13,21,38,.72);border:1px solid rgba(154,167,194,.18)}
.stat b{display:block;font-size:56px;letter-spacing:-.04em}
.stat.ok b{color:#38d9a9}.stat.warn b{color:#ffb454}
.stat span{color:#9aa7c2;font-size:20px}
ul{list-style:none;margin-top:36px;font-size:28px;color:#c7d2ea;line-height:1.7}
li::before{content:"✓ ";color:#38d9a9;font-weight:800}
`

/** HTML de una tarjeta de una historia. tipo: 'epica' | 'historia' | 'cierre'. */
export function htmlTarjeta(tipo, plan, historia) {
  const cuerpo = {
    epica: `<div class="eyebrow">${esc(plan.epica)} · ${esc(plan.componente ?? '')}</div>
      <h1>${esc(plan.nombre)}</h1>
      <div class="sub">Cómo se prueba lo que se construyó.</div>
      <div class="badge"><span class="dot"></span><b>${plan.tests} test${plan.tests === 1 ? '' : 's'} E2E</b> · ${plan.historias.length} ${plan.historias.length === 1 ? 'recorrido' : 'recorridos'} · ${esc(plan.fecha)}</div>`,
    historia: `<div class="eyebrow">${esc(plan.epica)} · ${esc(historia.id)} · Funcionalidad ${esc(historia.n)} de ${esc(historia.de)}</div>
      <h1 class="m">${esc(historia.titulo)}</h1>
      <div class="sub">${esc(historia.texto)}</div>
      ${historia.criterios?.length ? `<ul>${historia.criterios.slice(0, 6).map((c) => `<li>Escenario ${esc(c.n)} · ${esc(String(c.texto).replace(/^Given\s+/i, 'Dado ').replace(/,?\s*When\s+/i, ', cuando ').replace(/,?\s*Then\s+/i, ', entonces ').replace(/^(.{210}).+$/, '$1…'))}</li>`).join('')}</ul>` : ''}`,
    cierre: `<div class="eyebrow">${esc(plan.epica)} · ${esc(historia.id)} · Resultado</div>
      <h1 class="m">${historia.estado === 'pasado' ? 'Probado, no prometido.' : 'La prueba falló.'}</h1>
      <div class="stats">
        <div class="stat ${historia.estado === 'pasado' ? 'ok' : 'warn'}"><b>${historia.estado === 'pasado' ? 'Pasó' : 'Falló'}</b><span>${esc(historia.titulo)}</span></div>
        <div class="stat"><b>${esc(plan.fecha)}</b><span>fecha de la corrida</span></div>
      </div>`,
  }[tipo]
  return `<!doctype html><html lang="es"><meta charset="utf-8"><style>${CSS}</style><body>
    <div class="top"><div class="brand"><div class="mark">M</div>MSF · evidencia de producto</div><div class="tag">SDLC · ${esc(plan.epica)}</div></div>
    <main>${cuerpo}</main></body></html>`
}

/** Argumentos de ffmpeg: concatena clips (cada uno ya normalizado) en un MP4 con audio mudo. */
export function argsConcat(listaArchivo, salida) {
  return ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listaArchivo, '-c', 'copy', '-movflags', '+faststart', salida]
}

const NORMALIZAR = ['-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p']
const CODEC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k']

export function argsClipDeVideo(entrada, salida) {
  return ['-y', '-v', 'error', '-i', entrada, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', ...NORMALIZAR, ...CODEC, salida]
}

export function argsClipDeImagen(png, segundos, salida) {
  return ['-y', '-v', 'error', '-loop', '1', '-t', String(segundos), '-i', png, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', ...NORMALIZAR, ...CODEC, salida]
}

const ffmpeg = (args) => execFileSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })

async function abrirChromium() {
  const require = createRequire(resolve('apps/web/package.json'))
  const { chromium } = require('@playwright/test')
  return chromium.launch()
}

async function renderTarjeta(browser, html, png) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.setContent(html)
  await page.screenshot({ path: png })
  await page.close()
}

function unir(clips, salida, tmp) {
  const lista = join(tmp, `lista-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(lista, clips.map((c) => `file '${c}'`).join('\n'))
  ffmpeg(argsConcat(lista, salida))
}

/** Arma un MP4 por test (funcionalidad). Devuelve { videos: [{id, texto, titulo, estado, ruta}] }. */
export async function armarEpica({ plan, dirVideos, out, browser, tmp }) {
  mkdirSync(out, { recursive: true })
  const clip = (nombre) => join(tmp, `${plan.epica}-${nombre}.mp4`)
  const tarjeta = async (tipo, datos, segundos, nombre) => {
    const png = join(tmp, `${plan.epica}-${nombre}.png`)
    await renderTarjeta(browser, htmlTarjeta(tipo, plan, datos), png)
    ffmpeg(argsClipDeImagen(png, segundos, clip(nombre)))
    return clip(nombre)
  }
  const videos = []
  for (const h of plan.historias) {
    for (const [i, t] of h.tests.entries()) {
      const origen = join(dirVideos, t.video)
      if (!existsSync(origen)) {
        // Test OMITIDO (nunca se ejecutó): no hay video que publicar → se salta (no es un error).
        // Un test 'pasado' sin video SÍ es un error real (la evidencia prometida no existe).
        if (t.estado === 'omitido') continue
        throw new Error(`Falta el video de «${t.test}»: ${origen}`)
      }
      const datos = { id: h.id, texto: h.texto, titulo: tituloTest(t.test), estado: t.estado, n: i + 1, de: h.tests.length, criterios: t.criterios ?? [] }
      const clave = `${h.id}-${i + 1}`
      const intro = await tarjeta('historia', datos, datos.criterios.length ? SEG_TARJETA_CRITERIOS : SEG_TARJETA, `intro-${clave}`)
      const cierre = await tarjeta('cierre', datos, SEG_TARJETA, `cierre-${clave}`)
      ffmpeg(argsClipDeVideo(origen, clip(clave)))
      const ruta = join(out, `${plan.epica}-${clave}.mp4`)
      unir([intro, clip(clave), cierre], ruta, tmp)
      videos.push({ id: h.id, texto: h.texto, titulo: datos.titulo, estado: t.estado, criterios: (t.criterios ?? []).map((c) => c.n), ruta })
    }
  }
  return { videos }
}

// --- Publicación en ItsAPlan (opcional) --------------------------------------
// API REST de ItsAPlan (docs: <ITSAPLAN_API_URL>/docs): clave personal en `x-api-key`,
// issue por número en `/projects/{key}/issues/{n}` y subida multipart en
// `/issues/{id}/attachments`.

async function itsaplan(ruta, init = {}) {
  const base = (process.env.ITSAPLAN_API_URL || 'https://api.plan.agenmatica.com').replace(/\/+$/, '')
  const r = await fetch(`${base}${ruta}`, { ...init, headers: { 'x-api-key': process.env.ITSAPLAN_API_KEY, ...init.headers } })
  if (!r.ok) throw new Error(`ItsAPlan ${ruta}: ${r.status} ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

/** Hijos de la épica cuyo título menciona el ítem (p. ej. «(T020, T021…)»): ahí cuelga el video de esa historia. */
export function hijoDelItem(hijos, clave) {
  return hijos.find((h) => new RegExp(`\\b${clave}\\b`).test(h.title ?? ''))
}

async function adjuntar(issueId, ruta) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(ruta)], { type: 'video/mp4' }), ruta.split('/').pop())
  return itsaplan(`/issues/${issueId}/attachments`, { method: 'POST', body: form })
}

const icono = (estado) => (estado === 'pasado' ? '✅' : '❌')
const lineaVideo = (f) => `- ${icono(f.estado)} ${f.titulo}${f.criterios?.length ? ` (escenarios ${f.criterios.join(', ')})` : ''} → [ver video](${f.url})`

/** Comentario de una historia con los links de sus videos. */
export function comentarioHistoria(id, filas) {
  return `🎬 Videos de la prueba **${id}**\n\n${filas.map(lineaVideo).join('\n')}`
}

/** Comentario de la épica con los links de todos los videos, agrupados por historia. */
export function comentarioEpica(epica, filas, fecha) {
  const porId = new Map()
  for (const f of filas) porId.set(f.id, [...(porId.get(f.id) ?? []), f])
  const bloques = [...porId].map(([id, fs]) => {
    const issue = fs[0].issue ? ` · ${fs[0].issue}` : ''
    return `**${id}** · ${fs[0].texto}${issue}\n${fs.map(lineaVideo).join('\n')}`
  })
  return `🎬 **Videos de prueba de ${epica}** (corrida ${fecha})\n\n${bloques.join('\n\n')}`
}

const comentar = (issueId, body) =>
  itsaplan(`/issues/${issueId}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) })

async function publicar(resumen, proyecto, fecha) {
  const base = (process.env.ITSAPLAN_API_URL || 'https://api.plan.agenmatica.com').replace(/\/+$/, '')
  for (const r of resumen) {
    const seq = r.epica.split('-').pop()
    const epica = await itsaplan(`/projects/${proyecto}/issues/${seq}`)
    const epicaId = epica.id ?? epica.data?.id
    const hijos = (await itsaplan(`/projects/${proyecto}/issues?parentId=${epicaId}&limit=200`)).data ?? []
    const filas = []
    for (const v of r.videos) {
      const hijo = hijoDelItem(hijos, v.id)
      const adjunto = await adjuntar(hijo?.id ?? epicaId, v.ruta)
      const url = adjunto.url?.startsWith('http') ? adjunto.url : `${base}/attachments/${adjunto.id}/raw`
      filas.push({ ...v, url, issueId: hijo?.id, issue: hijo?.identifier })
      console.log(`${r.epica} ${v.id} «${v.titulo}»: adjuntado a ${hijo?.identifier ?? 'la épica (ninguna historia lo menciona)'}`)
    }
    for (const id of new Set(filas.filter((f) => f.issueId).map((f) => f.id))) {
      const propias = filas.filter((f) => f.id === id)
      await comentar(propias[0].issueId, comentarioHistoria(id, propias))
    }
    await comentar(epicaId, comentarioEpica(r.epica, filas, fecha))
    console.log(`${r.epica}: comentario con ${filas.length} link(s) en la épica`)
  }
}

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const manifiestoPath = arg('manifiesto')
  const dirVideos = arg('videos')
  const out = resolve(arg('out') ?? 'videos-evidencia')
  if (!manifiestoPath || !dirVideos) {
    console.error('Uso: armar-video-evidencia.mjs --manifiesto <json> --videos <dir> --out <dir> [--epica MSF-136] [--publicar]')
    process.exit(2)
  }
  const manifiesto = JSON.parse(readFileSync(manifiestoPath, 'utf8'))
  const epicas = arg('epica') ? [arg('epica')] : [...new Set(manifiesto.evidencias.filter((e) => e.video).map((e) => e.epica))]
  const tmp = mkdtempSync(join(tmpdir(), 'video-evidencia-'))
  const browser = await abrirChromium()
  const resumen = []
  try {
    for (const epica of epicas) {
      const plan = planEpica(manifiesto, epica)
      if (!plan) {
        console.log(`${epica}: sin videos, se omite`)
        continue
      }
      const r = await armarEpica({ plan, dirVideos: resolve(dirVideos), out, browser, tmp })
      console.log(`${epica}: ${r.videos.length} video(s), uno por funcionalidad, en ${out}`)
      resumen.push({ epica, videos: r.videos })
    }
  } finally {
    await browser.close()
  }
  writeFileSync(join(out, 'resumen.json'), JSON.stringify(resumen, null, 2))
  if (process.argv.includes('--publicar')) {
    if (!process.env.ITSAPLAN_API_KEY) throw new Error('Falta ITSAPLAN_API_KEY para --publicar')
    await publicar(resumen, arg('proyecto') ?? 'MSF', String(manifiesto.fecha ?? '').slice(0, 10))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
