#!/usr/bin/env node
// Arnés de Lighthouse para el front público de la tienda (MSF-560 · T050 de F-TDA-17).
//
// Mide el LCP de home, catálogo y ficha con la emulación que fija D9 de la spec
// `tienda-inicio-busqueda-movil` (DevTools «4G lento»: RTT 150 ms, 1,6 Mbps, CPU ×4) y falla
// si la mediana de las corridas supera 3 s (FR-047 / SC-009). Los valores se publican en
// `docs/tienda-movil.md`.
//
// Uso:
//   node scripts/lighthouse-tienda.mjs --url https://tienda.ejemplo.com --producto <id>
//   node scripts/lighthouse-tienda.mjs --url http://tienda.localhost:4300 --servir apps/web/dist
//
// Opciones (o su variable de entorno equivalente):
//   --url <base>        host público de la tienda (obligatorio)
//   --pantallas <lista> rutas a medir separadas por coma (por defecto «/», «/catalogo»)
//   --producto <id>     id de producto: agrega «/producto/<id>» a las pantallas
//   --corridas <n>      corridas por pantalla; se publica la mediana (por defecto 3)
//   --umbral <ms>       LCP máximo aceptable (por defecto 3000)
//   --salida <dir>      carpeta de los reportes (por defecto «reports/lighthouse-tienda»)
//   --servir <dir>      sirve ese build estático en local (sin Docker ni stack)
//   --puerto <n>        puerto del servidor local (por defecto 4300)
//   --chrome-flags <f>  flags extra de Chrome
//
// La versión de Lighthouse va fijada (precedente del repo: `@lhci/cli@0.16.0` en el nightly).

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createBrotliCompress, createGzip } from 'node:zlib'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const VERSION_LIGHTHOUSE = '12.8.2'

// Emulación «4G lento» + CPU ×4 de Lighthouse (constantes `mobileSlow4G`): RTT 150 ms,
// 1,6 Mbps de bajada y 4× de CPU. Con `--throttling-method=devtools` Lighthouse los aplica
// con las herramientas de desarrollo de Chrome (no simulados en el propio motor).
export const EMULACION = {
  '--form-factor': 'mobile',
  '--screenEmulation.mobile': 'true',
  '--screenEmulation.width': '412',
  '--screenEmulation.height': '823',
  '--screenEmulation.deviceScaleFactor': '1.75',
  '--throttling-method': 'devtools',
  '--throttling.rttMs': '150',
  '--throttling.throughputKbps': '1638.4',
  '--throttling.requestLatencyMs': '562.5',
  '--throttling.downloadThroughputKbps': '1474.56',
  '--throttling.uploadThroughputKbps': '675',
  '--throttling.cpuSlowdownMultiplier': '4',
}

export const UMBRAL_LCP_MS = 3000
export const PANTALLAS_POR_DEFECTO = ['/', '/catalogo']

// Chrome sin ventana (Lighthouse lo pide así en contenedores) y sin sandbox, igual que la
// configuración de LHCI del repo (`.lighthouserc.json`).
export const FLAGS_CHROME_POR_DEFECTO = '--headless=new --no-sandbox --disable-dev-shm-usage'

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
}

// Tipos que el servidor de producción comprime (el texto del bundle y las fuentes).
const COMPRIMIBLES = /\.(html|js|css|svg|json|woff2?)$/i

// Lee las opciones de la línea de comandos y del entorno.
export function leerOpciones(argv = [], env = {}) {
  const opciones = {
    url: env.TIENDA_LIGHTHOUSE_URL ?? '',
    pantallas: env.TIENDA_LIGHTHOUSE_PANTALLAS ?? PANTALLAS_POR_DEFECTO.join(','),
    producto: env.TIENDA_LIGHTHOUSE_PRODUCTO ?? '',
    corridas: Number(env.TIENDA_LIGHTHOUSE_CORRIDAS ?? 3),
    umbral: Number(env.TIENDA_LIGHTHOUSE_UMBRAL ?? UMBRAL_LCP_MS),
    salida: env.TIENDA_LIGHTHOUSE_SALIDA ?? 'reports/lighthouse-tienda',
    servir: env.TIENDA_LIGHTHOUSE_SERVIR ?? '',
    puerto: Number(env.TIENDA_LIGHTHOUSE_PUERTO ?? 4300),
    chromeFlags: env.TIENDA_LIGHTHOUSE_CHROME_FLAGS
      ? `${FLAGS_CHROME_POR_DEFECTO} ${env.TIENDA_LIGHTHOUSE_CHROME_FLAGS}`
      : FLAGS_CHROME_POR_DEFECTO,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i]
    const valor = argv[i + 1]
    switch (argumento) {
      case '--url': opciones.url = valor; i += 1; break
      case '--pantallas': opciones.pantallas = valor; i += 1; break
      case '--producto': opciones.producto = valor; i += 1; break
      case '--corridas': opciones.corridas = Number(valor); i += 1; break
      case '--umbral': opciones.umbral = Number(valor); i += 1; break
      case '--salida': opciones.salida = valor; i += 1; break
      case '--servir': opciones.servir = valor; i += 1; break
      case '--puerto': opciones.puerto = Number(valor); i += 1; break
      case '--chrome-flags': opciones.chromeFlags = `${FLAGS_CHROME_POR_DEFECTO} ${valor}`; i += 1; break
      default: break
    }
  }
  return opciones
}

// Rutas a medir: las de la lista más la ficha del producto, si viene.
export function pantallasAMedir(opciones) {
  const rutas = opciones.pantallas.split(',').map((ruta) => ruta.trim()).filter(Boolean)
  if (opciones.producto) rutas.push(`/producto/${opciones.producto}`)
  return rutas
}

// Mediana (el repo usa la mediana porque una sola corrida es ruido).
export function mediana(numeros) {
  if (numeros.length === 0) return null
  const ordenados = [...numeros].sort((a, b) => a - b)
  const medio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2
}

// Comando de Lighthouse con la emulación móvil de D9.
export function comandoLighthouse({ url, salida, chromeFlags = '' }) {
  const argumentos = [
    'dlx', `lighthouse@${VERSION_LIGHTHOUSE}`, url,
    '--output=json',
    `--output-path=${salida}`,
    '--only-categories=performance',
    '--quiet',
  ]
  for (const [clave, valor] of Object.entries(EMULACION)) argumentos.push(`${clave}=${valor}`)
  if (chromeFlags) argumentos.push(`--chrome-flags=${chromeFlags}`)
  return argumentos
}

// LCP (ms) y elemento responsable de un reporte de Lighthouse.
export function leerLcp(reporte) {
  const auditoria = reporte?.audits?.['largest-contentful-paint']
  if (!auditoria || typeof auditoria.numericValue !== 'number') {
    throw new Error('El reporte de Lighthouse no trae la auditoría largest-contentful-paint')
  }
  const items = reporte?.audits?.['largest-contentful-paint-element']?.details?.items ?? []
  const nodo = items[0]?.items?.[0]?.node
  return {
    lcpMs: auditoria.numericValue,
    elemento: typeof nodo?.snippet === 'string' ? nodo.snippet.replace(/\s+/g, ' ').trim() : 'desconocido',
  }
}

// Veredicto: falla si alguna pantalla quedó por encima del umbral.
export function evaluar(medianas, umbralMs = UMBRAL_LCP_MS) {
  const flojas = medianas.filter((mediana) => mediana !== null && mediana > umbralMs)
  return { ok: flojas.length === 0, superadas: flojas }
}

// Servidor estático mínimo para medir el build local sin Docker: sirve `dist` y cae en
// `index.html` (routing del cliente) para cualquier ruta que no sea un archivo.
//
// Comprime como lo hace el servidor de producción (nginx/Caddy sirven el front con gzip o
// brotli): sin compresión, el chunk de entrada pesa 833 kB en vez de 242 kB y la medición
// «4G lento» carga con una penalización que en la vida real no existe.
export function servirBuild(dir, puerto) {
  const raiz = resolve(dir)
  const servidor = createServer((peticion, respuesta) => {
    const ruta = decodeURIComponent((peticion.url ?? '/').split('?')[0])
    const destino = join(raiz, normalize(ruta).replace(/^(\.\.[/\\])+/, ''))
    const archivo = existsSync(destino) && statSync(destino).isFile() ? destino : join(raiz, 'index.html')
    const tipo = TIPOS[extname(archivo)] ?? 'application/octet-stream'
    const aceptados = String(peticion.headers['accept-encoding'] ?? '')
    const compresion = COMPRIMIBLES.test(archivo)
      ? aceptados.includes('br') ? { codificacion: 'br', flujo: createBrotliCompress() }
        : aceptados.includes('gzip') ? { codificacion: 'gzip', flujo: createGzip() }
        : null
      : null
    const cabeceras = { 'content-type': tipo, vary: 'accept-encoding' }
    if (compresion) cabeceras['content-encoding'] = compresion.codificacion
    respuesta.writeHead(200, cabeceras)
    if (compresion) {
      compresion.flujo.pipe(respuesta)
      createReadStream(archivo).pipe(compresion.flujo)
    } else {
      createReadStream(archivo).pipe(respuesta)
    }
  })
  return new Promise((resolver) => {
    servidor.listen(puerto, '127.0.0.1', () => resolver(servidor))
  })
}

function ejecutarLighthouse(url, salida, chromeFlags) {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn('pnpm', comandoLighthouse({ url, salida, chromeFlags }), {
      cwd: RAIZ,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let error = ''
    hijo.stderr.on('data', (trozo) => { error += trozo.toString() })
    hijo.on('error', rechazar)
    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        rechazar(new Error(`Lighthouse terminó con código ${codigo}: ${error.trim().split('\n').slice(-5).join(' ')}`))
        return
      }
      resolver(JSON.parse(readFileSync(salida, 'utf8')))
    })
  })
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2), process.env)
  if (!opciones.url) {
    console.error('lighthouse-tienda: falta --url (el host público de la tienda).')
    process.exitCode = 1
    return
  }

  const salida = resolve(RAIZ, opciones.salida)
  mkdirSync(salida, { recursive: true })

  let chromeFlags = opciones.chromeFlags
  let servidor = null
  if (opciones.servir) {
    // La regla de resolución de Chrome mapea el host a 127.0.0.1; el puerto lo pone la URL. Por eso la URL
    // tiene que traer el puerto del servidor local: si no, el navegador se iría al host real de Internet y
    // mediría otra cosa (el build local no se mediría).
    const url = new URL(opciones.url)
    if (url.protocol !== 'http:' || url.port !== String(opciones.puerto)) {
      throw new Error(
        `Con --servir la URL tiene que ser http://<host>:${opciones.puerto}/ (la que se midió: ${opciones.url}). ` +
          'El navegador resuelve ese host a 127.0.0.1 y usa el puerto de la URL.',
      )
    }
    servidor = await servirBuild(opciones.servir, opciones.puerto)
    const regla = `--host-resolver-rules=MAP ${url.hostname} 127.0.0.1`
    chromeFlags = `${chromeFlags} ${regla}`.trim()
    console.log(`lighthouse-tienda: build local servido en 127.0.0.1:${opciones.puerto} para el host ${url.hostname}`)
  }

  const rutas = pantallasAMedir(opciones)
  const resultados = []
  try {
    for (const ruta of rutas) {
      const muestras = []
      let elemento = 'desconocido'
      for (let corrida = 1; corrida <= opciones.corridas; corrida += 1) {
        const archivo = join(salida, `${nombrePantalla(ruta)}-${corrida}.json`)
        const reporte = await ejecutarLighthouse(`${opciones.url.replace(/\/$/, '')}${ruta}`, archivo, chromeFlags)
        const { lcpMs, elemento: nodo } = leerLcp(reporte)
        muestras.push(lcpMs)
        elemento = nodo
        console.log(`lighthouse-tienda: ${ruta} corrida ${corrida}: LCP ${Math.round(lcpMs)} ms`)
      }
      resultados.push({ ruta, muestras, mediana: mediana(muestras), elemento })
    }
  } finally {
    servidor?.close()
  }

  const veredicto = evaluar(resultados.map((r) => r.mediana), opciones.umbral)
  const resumen = [
    '# Lighthouse de la tienda · LCP móvil («4G lento», CPU ×4)',
    '',
    `Host: ${opciones.url} · corridas por pantalla: ${opciones.corridas} · umbral: ${opciones.umbral} ms (mediana).`,
    '',
    '| Pantalla | Corridas (ms) | Mediana (ms) | Elemento del LCP |',
    '|---|---|---|---|',
    ...resultados.map((r) => `| ${r.ruta} | ${r.muestras.map((m) => Math.round(m)).join(', ')} | ${Math.round(r.mediana)} | ${r.elemento} |`),
    '',
    veredicto.ok ? 'Veredicto: todas las pantallas por debajo del umbral.' : `Veredicto: FALLA — ${veredicto.superadas.length} pantalla(s) por encima del umbral.`,
    '',
  ].join('\n')
  writeFileSync(join(salida, 'resumen.md'), resumen)
  console.log(resumen)
  if (!veredicto.ok) process.exitCode = 1
}

function nombrePantalla(ruta) {
  const limpio = ruta.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return limpio || 'home'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
