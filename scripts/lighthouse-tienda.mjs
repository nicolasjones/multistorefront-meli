#!/usr/bin/env node
// Arnés de Lighthouse para el front público de la tienda (MSF-560 · T050 de F-TDA-17).
//
// Mide el LCP de home, catálogo y ficha de cada tienda con la emulación que fija D9 de la spec
// `tienda-inicio-busqueda-movil` (DevTools «4G lento»: RTT 150 ms, 1,6 Mbps, CPU ×4) y falla
// si la mediana de las corridas supera 3 s (FR-047 / SC-009). Los valores se publican en
// `docs/tienda-movil.md`.
//
// Uso:
//   node scripts/lighthouse-tienda.mjs --url https://tienda.ejemplo.com --producto <id>
//   node scripts/lighthouse-tienda.mjs --url https://tienda.localhost:4300 --servir apps/web/dist
//
// Opciones (o su variable de entorno equivalente):
//   --url <base>        host público de la tienda (obligatorio; se repite: uno por tienda)
//   --pantallas <lista> rutas a medir separadas por coma (por defecto «/», «/catalogo»)
//   --producto <id>     id de producto: agrega «/producto/<id>» a las pantallas (uno, o uno por tienda)
//   --corridas <n>      corridas por pantalla; se publica la mediana (por defecto 3)
//   --umbral <ms>       LCP máximo aceptable (por defecto 3000)
//   --salida <dir>      carpeta de los reportes (por defecto «reports/lighthouse-tienda»)
//   --servir <dir>      sirve ese build estático en local (sin Docker ni stack)
//   --puerto <n>        puerto del servidor local (por defecto 4300)
//   --chrome-flags <f>  flags extra de Chrome
//
// La versión de Lighthouse va fijada (precedente del repo: `@lhci/cli@0.16.0` en el nightly).

import { spawn, execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createSecureServer } from 'node:http2'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGzip } from 'node:zlib'

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

// Lista separada por comas (o repetida en la línea de comandos).
function separar(valor) {
  return String(valor ?? '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
}

// Lee las opciones de la línea de comandos y del entorno.
export function leerOpciones(argv = [], env = {}) {
  const opciones = {
    urls: separar(env.TIENDA_LIGHTHOUSE_URL),
    productos: separar(env.TIENDA_LIGHTHOUSE_PRODUCTO),
    pantallas: env.TIENDA_LIGHTHOUSE_PANTALLAS ?? PANTALLAS_POR_DEFECTO.join(','),
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
      case '--url': opciones.urls.push(...separar(valor)); i += 1; break
      case '--pantallas': opciones.pantallas = valor; i += 1; break
      case '--producto': opciones.productos.push(...separar(valor)); i += 1; break
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

// Errores de uso: sin ellos el arnés mediría cualquier cosa (por ejemplo, cero corridas) y el
// veredicto saldría verde sin medir nada.
export function validarOpciones(opciones) {
  const errores = []
  if (opciones.urls.length === 0) errores.push('falta --url (el host público de la tienda)')
  if (!Number.isInteger(opciones.corridas) || opciones.corridas < 1) {
    errores.push(`--corridas tiene que ser un entero mayor a 0 (viene ${opciones.corridas})`)
  }
  if (!Number.isFinite(opciones.umbral) || opciones.umbral <= 0) {
    errores.push(`--umbral tiene que ser un número mayor a 0 (viene ${opciones.umbral})`)
  }
  if (opciones.productos.length > 1 && opciones.productos.length !== opciones.urls.length) {
    errores.push('--producto tiene que ser uno o uno por tienda (mismo número que --url)')
  }
  if (opciones.servir) {
    for (const url of opciones.urls) {
      const host = new URL(url)
      if (host.protocol !== 'https:' || host.port !== String(opciones.puerto)) {
        errores.push(
          `con --servir la URL tiene que ser https://<host>:${opciones.puerto}/ (la que se midió: ${url})`,
        )
      }
    }
  }
  return errores
}

// Rutas a medir de una tienda: las de la lista más la ficha del producto de esa tienda.
export function pantallasDeTienda(pantallas, producto) {
  const rutas = separar(pantallas)
  if (producto) rutas.push(`/producto/${producto}`)
  return rutas
}

// Las mediciones completas: una por tienda y por ruta.
export function planDeMedicion(opciones) {
  const plan = []
  for (const [indice, url] of opciones.urls.entries()) {
    const producto = opciones.productos.length === 1 ? opciones.productos[0] : opciones.productos[indice]
    const base = url.replace(/\/$/, '')
    for (const ruta of pantallasDeTienda(opciones.pantallas, producto)) {
      plan.push({
        base,
        ruta,
        url: `${base}${ruta}`,
        host: new URL(url).hostname,
        nombre: `${new URL(url).hostname}-${nombrePantalla(ruta)}`,
      })
    }
  }
  return plan
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

// La regla de resolución de Chrome mapea el host de la tienda a 127.0.0.1. Lighthouse parsea
// `--chrome-flags` con yargs (`cli/run.js:parseChromeFlags`): el valor tiene que ir entre comillas
// para que «MAP host 127.0.0.1» llegue a Chrome como UN argumento; sin comillas, yargs lo parte y
// descarta el resto (Chrome recibiría «--host-resolver-rules=MAP», que no mapea nada).
export function reglaDeResolucion(hosts) {
  const reglas = hosts.map((host) => `MAP ${host} 127.0.0.1`).join(',')
  return `--host-resolver-rules="${reglas}"`
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

// Veredicto: falla si alguna pantalla quedó por encima del umbral (o sin medir).
export function evaluar(medianas, umbralMs = UMBRAL_LCP_MS) {
  const superadas = medianas.filter((mediana) => mediana === null || mediana > umbralMs)
  return { ok: superadas.length === 0, superadas }
}

// El log de red de Lighthouse trae las URLs firmadas de Storage (con su token) y las cabeceras de
// sesión. Antes de escribir el reporte se sanEAN: el repo no versiona credenciales.
export function sanearReporte(valor) {
  if (Array.isArray(valor)) return valor.map(sanearReporte)
  if (valor && typeof valor === 'object') {
    const salida = {}
    for (const [clave, dato] of Object.entries(valor)) {
      salida[clave] = /^(authorization|cookie|set-cookie)$/i.test(clave) ? 'REDACTADO' : sanearReporte(dato)
    }
    return salida
  }
  if (typeof valor === 'string') return sanearUrl(valor)
  return valor
}

// Saca de una URL los tokens de acceso (los de las URLs firmadas de Storage).
export function sanearUrl(url) {
  return url.replace(/([?&](?:token|access_token|refresh_token|signature|apikey|api_key)=)[^&#]*/gi, '$1REDACTADO')
}

// Servidor estático mínimo para medir el build local sin Docker: sirve `dist` y cae en
// `index.html` (routing del cliente) para cualquier ruta que no sea un archivo.
//
// Va por HTTPS con HTTP/2, como el proxy de producción (Traefik sirve el front con HTTP/2 y
// HTTP/3): el navegador manda los ~50 requests del bundle por una sola conexión. Con HTTP/1.1
// abriría 6 conexiones por host y, con la latencia emulada (562 ms por request), la cola
// sumaría varios segundos al LCP que en producción no existen.
//
// Comprime como lo hace el servidor de producción (nginx:alpine sirve el front con gzip; no
// trae brotli): sin compresión, el chunk de entrada pesa el triple y la medición «4G lento»
// carga con una penalización que en la vida real no existe. Con brotli (calidad 11) el servidor
// tarda ~350 ms en comprimir un chunk de 180 kB y, como es de un solo hilo, retrasa el resto de
// las respuestas: la medición salía penalizada por el servidor, no por la red.
export function servirBuild(dir, puerto, { tls = false } = {}) {
  const raiz = resolve(dir)
  const servidor = tls ? createSecureServer(certificadoAutofirmado()) : createServer()
  servidor.on('request', (peticion, respuesta) => {
    let ruta
    try {
      ruta = decodeURIComponent((peticion.url ?? '/').split('?')[0])
    } catch {
      respuesta.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      respuesta.end('URL inválida')
      return
    }
    const destino = join(raiz, normalize(ruta).replace(/^(\.\.[/\\])+/, ''))
    const archivo = existsSync(destino) && statSync(destino).isFile() ? destino : join(raiz, 'index.html')
    const tipo = TIPOS[extname(archivo)] ?? 'application/octet-stream'
    const aceptados = String(peticion.headers['accept-encoding'] ?? '')
    const compresion = COMPRIMIBLES.test(archivo) && aceptados.includes('gzip')
      ? { codificacion: 'gzip', flujo: createGzip() }
      : null
    const cabeceras = { 'content-type': tipo, vary: 'accept-encoding' }
    if (compresion) cabeceras['content-encoding'] = compresion.codificacion
    // Mismas cabeceras de caché que el nginx de producción (`apps/web/nginx.conf`): el HTML no se
    // cachea y los assets (que llevan hash) son inmutables.
    cabeceras['cache-control'] = extname(archivo) === '.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable'
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

// Certificado autofirmado para el servidor local: solo sirve para que el navegador acepte el
// TLS del build medido (Chrome corre con `--ignore-certificate-errors`). Vive en el directorio
// temporal y no se versiona.
export function certificadoAutofirmado() {
  const dir = mkdtempSync(join(tmpdir(), 'lighthouse-tienda-'))
  const clave = join(dir, 'clave.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', clave, '-out', cert, '-days', '1', '-subj', '/CN=tienda.local'],
    { stdio: 'ignore' },
  )
  return { key: readFileSync(clave), cert: readFileSync(cert) }
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
      const reporte = sanearReporte(JSON.parse(readFileSync(salida, 'utf8')))
      writeFileSync(salida, JSON.stringify(reporte))
      resolver(reporte)
    })
  })
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2), process.env)
  const errores = validarOpciones(opciones)
  if (errores.length > 0) {
    console.error(`lighthouse-tienda: ${errores.join(' · ')}`)
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
    // mediría otra cosa (el build local no se mediría). El certificado es autofirmado (el del build medido
    // no lo es): Chrome lo acepta con `--ignore-certificate-errors`.
    servidor = await servirBuild(opciones.servir, opciones.puerto, { tls: true })
    chromeFlags = `${chromeFlags} --ignore-certificate-errors ${reglaDeResolucion(opciones.urls.map((url) => new URL(url).hostname))}`.trim()
    console.log(
      `lighthouse-tienda: build local servido en 127.0.0.1:${opciones.puerto} para ${opciones.urls.join(', ')}`,
    )
  }

  const resultados = []
  try {
    for (const medicion of planDeMedicion(opciones)) {
      const muestras = []
      let elemento = 'desconocido'
      for (let corrida = 1; corrida <= opciones.corridas; corrida += 1) {
        const archivo = join(salida, `${medicion.nombre}-${corrida}.json`)
        const reporte = await ejecutarLighthouse(medicion.url, archivo, chromeFlags)
        const { lcpMs, elemento: nodo } = leerLcp(reporte)
        muestras.push(lcpMs)
        elemento = nodo
        console.log(`lighthouse-tienda: ${medicion.url} corrida ${corrida}: LCP ${Math.round(lcpMs)} ms`)
      }
      resultados.push({ ...medicion, muestras, mediana: mediana(muestras), elemento })
    }
  } finally {
    servidor?.close()
  }

  const veredicto = evaluar(resultados.map((r) => r.mediana), opciones.umbral)
  const resumen = [
    '# Lighthouse de la tienda · LCP móvil («4G lento», CPU ×4)',
    '',
    `Host: ${opciones.urls.join(', ')} · corridas por pantalla: ${opciones.corridas} · umbral: ${opciones.umbral} ms (mediana).`,
    `Build: ${opciones.servir ? `servido en local desde ${opciones.servir}` : 'el del host medido'}.`,
    '',
    '| Tienda | Pantalla | Corridas (ms) | Mediana (ms) | Elemento del LCP |',
    '|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.host} | ${r.ruta} | ${r.muestras.map((m) => Math.round(m)).join(', ')} | ${Math.round(r.mediana)} | ${r.elemento} |`),
    '',
    veredicto.ok
      ? 'Veredicto: todas las pantallas por debajo del umbral.'
      : `Veredicto: FALLA — ${veredicto.superadas.length} pantalla(s) sin cumplir el umbral.`,
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
