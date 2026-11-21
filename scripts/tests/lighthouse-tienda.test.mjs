// MSF-560 · T050 (SC-009): el arnés de Lighthouse de la tienda y su veredicto de LCP.
// El gate no lo ejecuta nadie en el CI: estos tests son lo que lo mantiene vivo (y lo que
// detecta una regresión en la emulación, en la mediana o en el sanitizeo del reporte).
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMULACION,
  PANTALLAS_POR_DEFECTO,
  UMBRAL_LCP_MS,
  comandoLighthouse,
  evaluar,
  leerLcp,
  leerOpciones,
  mediana,
  planDeMedicion,
  reglaDeResolucion,
  sanearReporte,
  sanearUrl,
  servirBuild,
  validarOpciones,
} from '../lighthouse-tienda.mjs'

test('la emulación es la de «4G lento» con CPU ×4 (D9)', () => {
  assert.equal(EMULACION['--form-factor'], 'mobile')
  assert.equal(EMULACION['--throttling-method'], 'devtools')
  assert.equal(EMULACION['--throttling.rttMs'], '150')
  assert.equal(EMULACION['--throttling.throughputKbps'], '1638.4')
  assert.equal(EMULACION['--throttling.cpuSlowdownMultiplier'], '4')
  assert.equal(UMBRAL_LCP_MS, 3000)
})

test('sin argumentos mide home y catálogo de cada tienda, con 3 corridas', () => {
  const opciones = leerOpciones([], {})
  assert.deepEqual(opciones.urls, [])
  assert.equal(opciones.corridas, 3)
  assert.equal(opciones.umbral, UMBRAL_LCP_MS)
  assert.deepEqual(PANTALLAS_POR_DEFECTO, ['/', '/catalogo'])
})

test('la línea de comandos acepta una tienda por --url y un producto por tienda', () => {
  const opciones = leerOpciones(
    ['--url', 'https://uno.ejemplo.com', '--url', 'https://dos.ejemplo.com', '--producto', 'abc', '--producto', 'def'],
    {},
  )
  assert.deepEqual(opciones.urls, ['https://uno.ejemplo.com', 'https://dos.ejemplo.com'])
  assert.deepEqual(opciones.productos, ['abc', 'def'])
})

test('sin --url, sin corridas o con un umbral inválido, el arnés se niega a medir', () => {
  assert.deepEqual(validarOpciones(leerOpciones([], {})), ['falta --url (el host público de la tienda)'])
  assert.ok(validarOpciones(leerOpciones(['--url', 'https://uno.ejemplo.com', '--corridas', '0'], {})).join().includes('--corridas'))
  assert.ok(validarOpciones(leerOpciones(['--url', 'https://uno.ejemplo.com', '--corridas', 'muchas'], {})).join().includes('--corridas'))
  assert.ok(validarOpciones(leerOpciones(['--url', 'https://uno.ejemplo.com', '--umbral', 'NaN'], {})).join().includes('--umbral'))
})

test('un producto por tienda tiene que coincidir con el número de tiendas', () => {
  const opciones = leerOpciones(
    ['--url', 'https://uno.ejemplo.com', '--url', 'https://dos.ejemplo.com', '--producto', 'abc', '--producto', 'def', '--producto', 'ghi'],
    {},
  )
  assert.ok(validarOpciones(opciones).join().includes('--producto'))
})

test('con --servir la URL tiene que traer el puerto del servidor local', () => {
  const opciones = leerOpciones(['--url', 'http://uno.ejemplo.com', '--servir', 'apps/web/dist'], {})
  assert.ok(validarOpciones(opciones).join().includes('--servir'))
  const valido = leerOpciones(['--url', 'https://uno.ejemplo.com:4300', '--servir', 'apps/web/dist'], {})
  assert.deepEqual(validarOpciones(valido), [])
})

test('el plan mide home, catálogo y la ficha de cada tienda', () => {
  const opciones = leerOpciones(
    ['--url', 'https://uno.ejemplo.com', '--url', 'https://dos.ejemplo.com', '--producto', 'abc', '--producto', 'def'],
    {},
  )
  const plan = planDeMedicion(opciones)
  assert.equal(plan.length, 6)
  assert.deepEqual(
    plan.map((m) => m.url),
    [
      'https://uno.ejemplo.com/',
      'https://uno.ejemplo.com/catalogo',
      'https://uno.ejemplo.com/producto/abc',
      'https://dos.ejemplo.com/',
      'https://dos.ejemplo.com/catalogo',
      'https://dos.ejemplo.com/producto/def',
    ],
  )
})

test('un solo producto sirve para todas las tiendas', () => {
  const opciones = leerOpciones(['--url', 'https://uno.ejemplo.com', '--url', 'https://dos.ejemplo.com', '--producto', 'abc'], {})
  const plan = planDeMedicion(opciones)
  assert.equal(plan.length, 6)
  assert.deepEqual(
    plan.filter((m) => m.ruta.startsWith('/producto/')).map((m) => m.url),
    ['https://uno.ejemplo.com/producto/abc', 'https://dos.ejemplo.com/producto/abc'],
  )
})

test('la mediana ordena las muestras y la de una cantidad impar es la del medio', () => {
  assert.equal(mediana([3000, 1000, 2000]), 2000)
  assert.equal(mediana([1000, 3000]), 2000)
  assert.equal(mediana([]), null)
})

test('el veredicto falla con una pantalla por encima del umbral y también si falta medir', () => {
  assert.equal(evaluar([1000, 2000]).ok, true)
  assert.equal(evaluar([1000, UMBRAL_LCP_MS + 1]).ok, false)
  assert.equal(evaluar([1000, null]).ok, false, 'sin medición no se puede certificar el umbral')
})

test('leerLcp saca el LCP y el elemento responsable del reporte', () => {
  const reporte = {
    audits: {
      'largest-contentful-paint': { numericValue: 1234.5 },
      'largest-contentful-paint-element': { details: { items: [{ items: [{ node: { snippet: '<h1>\n  Hola</h1>' } }] }] } },
    },
  }
  assert.deepEqual(leerLcp(reporte), { lcpMs: 1234.5, elemento: '<h1> Hola</h1>' })
  assert.throws(() => leerLcp({ audits: {} }), /largest-contentful-paint/)
})

test('el comando de Lighthouse lleva la emulación de D9', () => {
  const argumentos = comandoLighthouse({ url: 'https://uno.ejemplo.com/', salida: '/tmp/reporte.json' })
  assert.ok(argumentos.includes('--throttling-method=devtools'))
  assert.ok(argumentos.includes('--throttling.cpuSlowdownMultiplier=4'))
  assert.ok(argumentos.includes('--only-categories=performance'))
})

test('la regla de resolución de Chrome va entre comillas: yargs no descarta el resto', () => {
  const regla = reglaDeResolucion(['uno.ejemplo.com', 'dos.ejemplo.com'])
  assert.equal(regla, '--host-resolver-rules="MAP uno.ejemplo.com 127.0.0.1,MAP dos.ejemplo.com 127.0.0.1"')
  const argumentos = comandoLighthouse({ url: 'https://uno.ejemplo.com/', salida: '/tmp/reporte.json', chromeFlags: `--headless=new ${regla}` })
  const flags = argumentos.find((a) => a.startsWith('--chrome-flags='))
  assert.ok(flags.includes('--host-resolver-rules="MAP uno.ejemplo.com 127.0.0.1'), 'la regla tiene que ir citada')
})

test('el reporte se sanea antes de escribirse: nada de tokens ni cabeceras de sesión', () => {
  const url = 'https://supabase.ejemplo.com/storage/v1/object/sign/productos/a.png?token=eyJsecreto'
  const reporte = {
    auditedUrl: url,
    audits: { 'network-requests': { details: { items: [{ url }] } } },
    extra: { authorization: 'Bearer secreto', cookie: 'sesion=secreto' },
  }
  const limpio = sanearReporte(reporte)
  assert.equal(limpio.auditedUrl.includes('eyJsecreto'), false)
  assert.match(limpio.audits['network-requests'].details.items[0].url, /token=REDACTADO/)
  assert.equal(limpio.extra.authorization, 'REDACTADO')
  assert.equal(limpio.extra.cookie, 'REDACTADO')
})

test('sanearUrl no toca las URLs sin token', () => {
  assert.equal(sanearUrl('https://ejemplo.com/catalogo?page=2'), 'https://ejemplo.com/catalogo?page=2')
  assert.match(sanearUrl('https://ejemplo.com/a?token=abc&x=1'), /token=REDACTADO&x=1/)
})

test('el servidor local responde 400 ante una URL mal formada (no se cae el arnés)', async () => {
  const servidor = await servirBuild('apps/web', 0)
  const puerto = servidor.address().port
  try {
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/%zz`)
    assert.equal(respuesta.status, 400)
  } finally {
    servidor.close()
  }
})
