// Pruebas de `enviar-resumen-reposicion` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-resumen-reposicion`); handler.ts y contenido.ts no importan nada de Deno.
// Verifica FR-203 (contenido), FR-204 (destinatarios), FR-205 (el barrido llama a la función) y FR-206.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TOPE_PRODUCTOS, asuntoResumen, cuerpoResumen, enlaceStock, type ProductoResumen } from './contenido.ts'
import { MAX_INTENTOS, manejar, procesarOrganizacion, type Deps, type Generado } from './handler.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const RESUMEN = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'secreto-de-prueba'
const PANEL = 'https://panel.example.com/'

const producto = (n: number, estado: ProductoResumen['estado'], nombre = `Producto ${String(n).padStart(3, '0')}`): ProductoResumen => ({
  producto_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  nombre,
  sku: `SKU-${n}`,
  cantidad: estado === 'sin_stock' ? 0 : 3,
  disponible: estado === 'sin_stock' ? 0 : 2,
  minimo: 5,
  estado,
})

const generado = (productos: ProductoResumen[], destinatarios = ['ana@example.com']): Generado => ({
  resumen_id: RESUMEN,
  sin_stock: productos.filter((p) => p.estado === 'sin_stock').length,
  stock_bajo: productos.filter((p) => p.estado === 'stock_bajo').length,
  productos,
  destinatarios,
})

type Opciones = {
  generado?: Generado[]
  generarError?: boolean
  falloSmtp?: string
  cerrarError?: boolean
  organizaciones?: string[]
  organizacionesError?: boolean
  token?: string | undefined
  panelUrl?: string | undefined
}

function montar(opciones: Opciones = {}) {
  const enviados: { para: string[]; asunto: string; texto: string }[] = []
  const cierres: { id: string; enviado: boolean; error: string | null }[] = []
  const generaciones: { organizacion: string; tope: number }[] = []
  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    panelUrl: 'panelUrl' in opciones ? opciones.panelUrl : PANEL,
    datos: {
      organizaciones: async () => opciones.organizacionesError
        ? { data: null, error: { message: 'boom' } }
        : { data: opciones.organizaciones ?? [], error: null },
      generar: async (organizacion, tope) => {
        generaciones.push({ organizacion, tope })
        return opciones.generarError
          ? { data: null, error: { message: 'boom' } }
          : { data: opciones.generado ?? [], error: null }
      },
      cerrar: async (id, enviado, error) => {
        cierres.push({ id, enviado, error })
        return { data: null, error: opciones.cerrarError ? { message: 'boom' } : null }
      },
    },
    enviar: async (mensaje) => {
      if (opciones.falloSmtp) throw new Error(opciones.falloSmtp)
      enviados.push(mensaje)
    },
  }
  return { deps, enviados, cierres, generaciones }
}

const pedido = (cuerpo: unknown, headers: Record<string, string> = { 'x-aviso-token': TOKEN }, method = 'POST') =>
  new Request('http://local/enviar-resumen-reposicion', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(cuerpo) : undefined,
  })

describe('contenido del resumen (FR-203)', () => {
  it('el asunto lleva los totales y respeta el singular', () => {
    assert.equal(asuntoResumen(3, 2), '3 productos sin stock y 2 con stock bajo')
    assert.equal(asuntoResumen(1, 0), '1 producto sin stock y 0 con stock bajo')
  })

  it('lista «Sin stock» primero y luego por nombre, con stock, disponible y mínimo', () => {
    const cuerpo = cuerpoResumen([
      producto(1, 'stock_bajo', 'Aro'),
      producto(2, 'sin_stock', 'Zapato'),
      producto(3, 'sin_stock', 'Bota'),
    ], enlaceStock(PANEL))
    const posicion = (texto: string) => cuerpo.indexOf(texto)
    assert.ok(posicion('Bota') < posicion('Zapato'), 'entre los sin stock, por nombre')
    assert.ok(posicion('Zapato') < posicion('Aro'), 'sin stock antes que stock bajo')
    assert.match(cuerpo, /Bota \(SKU SKU-3\) — Sin stock/)
    assert.match(cuerpo, /Aro \(SKU SKU-1\) — Stock bajo/)
    assert.match(cuerpo, /Stock: 3 · Disponible: 2 · Mínimo: 5/)
    assert.match(cuerpo, /2 sin stock y 1 con stock bajo/)
  })

  it('enlaza al panel de Stock sin barras de más', () => {
    assert.equal(enlaceStock(PANEL), 'https://panel.example.com/stock')
    assert.match(cuerpoResumen([producto(1, 'sin_stock')], enlaceStock(PANEL)), /https:\/\/panel\.example\.com\/stock\n$/)
  })

  it('con más de 50 productos lista 50, informa el total y el enlace', () => {
    const muchos = Array.from({ length: TOPE_PRODUCTOS + 7 }, (_, i) => producto(i + 1, i < 10 ? 'sin_stock' : 'stock_bajo'))
    const cuerpo = cuerpoResumen(muchos, enlaceStock(PANEL))
    assert.equal(cuerpo.split('\n').filter((l) => l.startsWith('• ')).length, TOPE_PRODUCTOS)
    assert.match(cuerpo, /… y 7 más\. Total: 57 productos/)
    assert.match(cuerpo, /\/stock\n$/)
  })

  it('neutraliza saltos de línea en nombre y SKU (no entran a cabeceras ni rompen la lista)', () => {
    const malo = { ...producto(1, 'sin_stock', 'Funda\r\nBcc: x@evil.test'), sku: 'A\nB' }
    const cuerpo = cuerpoResumen([malo], enlaceStock(PANEL))
    assert.match(cuerpo, /• Funda Bcc: x@evil\.test \(SKU A B\)/)
    assert.equal(asuntoResumen(1, 1).includes('\n'), false)
  })
})

describe('procesarOrganizacion', () => {
  it('envía el resumen a los destinatarios de la base y lo cierra como enviado (FR-206)', async () => {
    const { deps, enviados, cierres, generaciones } = montar({
      generado: [generado([producto(1, 'sin_stock'), producto(2, 'stock_bajo')], ['ana@example.com', 'beto@example.com'])],
    })
    assert.equal(await procesarOrganizacion(ORG, deps), 'enviado')
    assert.deepEqual(generaciones, [{ organizacion: ORG, tope: MAX_INTENTOS }])
    assert.equal(enviados.length, 1)
    assert.deepEqual(enviados[0].para, ['ana@example.com', 'beto@example.com'])
    assert.equal(enviados[0].asunto, '1 producto sin stock y 1 con stock bajo')
    assert.deepEqual(cierres, [{ id: RESUMEN, enviado: true, error: null }])
  })

  it('sin novedades no envía ni cierra nada (FR-201)', async () => {
    const { deps, enviados, cierres } = montar({ generado: [] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'sin_novedades')
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 0)
  })

  it('sin destinatarios no envía ni marca: la base ya lo dejó «sin destinatario» (FR-204)', async () => {
    const { deps, enviados, cierres } = montar({ generado: [generado([producto(1, 'sin_stock')], [])] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'sin_destinatario')
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 0, 'cerrar como enviado marcaría los productos')
  })

  it('si el envío falla cierra con error y no marca (FR-206)', async () => {
    const { deps, cierres } = montar({
      generado: [generado([producto(1, 'sin_stock')])],
      falloSmtp: 'SMTP\n  caído   en prueba',
    })
    assert.equal(await procesarOrganizacion(ORG, deps), 'fallido')
    assert.deepEqual(cierres, [{ id: RESUMEN, enviado: false, error: 'Falló el envío del correo; el detalle está en los registros de la función' }])
  })

  it('el detalle del SMTP no se guarda en la tabla (solo un texto genérico)', async () => {
    const { deps, cierres } = montar({ generado: [generado([producto(1, 'sin_stock')])], falloSmtp: 'smtp.interno:587 ' + 'x'.repeat(1000) })
    await procesarOrganizacion(ORG, deps)
    assert.ok(!cierres[0].error?.includes('smtp.interno'))
    assert.ok((cierres[0].error?.length ?? 0) <= 300)
  })

  it('el registro de la función no incluye host, IP ni correo del error SMTP', async () => {
    const { deps } = montar({ generado: [generado([producto(1, 'sin_stock')])], falloSmtp: 'connect ECONNREFUSED 10.0.0.5:587 smtp.interno.com user=admin@interno.com' })
    const original = console.error
    const lineas: string[] = []
    console.error = (...a: unknown[]) => { lineas.push(a.join(' ')) }
    try { await procesarOrganizacion(ORG, deps) } finally { console.error = original }
    const log = lineas.join('\n')
    assert.ok(log.includes('ECONNREFUSED'))
    assert.ok(!/10\.0\.0\.5|smtp\.interno|admin@interno/.test(log))
  })

  it('descarta destinatarios con formato inválido y, si no queda ninguno, cierra con error', async () => {
    const parcial = montar({ generado: [generado([producto(1, 'sin_stock')], ['no-es-correo', 'ok@example.com'])] })
    assert.equal(await procesarOrganizacion(ORG, parcial.deps), 'enviado')
    assert.deepEqual(parcial.enviados[0].para, ['ok@example.com'])

    const ninguno = montar({ generado: [generado([producto(1, 'sin_stock')], ['no-es-correo'])] })
    assert.equal(await procesarOrganizacion(ORG, ninguno.deps), 'fallido')
    assert.equal(ninguno.enviados.length, 0)
    assert.equal(ninguno.cierres[0].enviado, false)
  })

  it('si la base no puede generar el resumen lanza el error (el barrido lo cuenta)', async () => {
    const { deps } = montar({ generarError: true })
    await assert.rejects(procesarOrganizacion(ORG, deps), /No se pudo generar el resumen: boom/)
  })

  it('si el correo salió pero el cierre falla, igual informa enviado', async () => {
    const { deps } = montar({ generado: [generado([producto(1, 'sin_stock')])], cerrarError: true })
    assert.equal(await procesarOrganizacion(ORG, deps), 'enviado')
  })
})

describe('manejar (HTTP)', () => {
  it('rechaza métodos que no son POST y responde el preflight', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedido(null, {}, 'GET'), deps)).status, 405)
    assert.equal((await manejar(pedido(null, {}, 'OPTIONS'), deps)).status, 200)
  })

  it('sin token configurado o incorrecto no hace nada', async () => {
    const sinConfigurar = montar({ token: undefined })
    assert.equal((await manejar(pedido({ barrer: true }), sinConfigurar.deps)).status, 503)
    const incorrecto = montar()
    assert.equal((await manejar(pedido({ barrer: true }, { 'x-aviso-token': 'otro' }), incorrecto.deps)).status, 403)
    assert.equal((await manejar(pedido({ barrer: true }, {}), incorrecto.deps)).status, 403)
    assert.equal(incorrecto.generaciones.length, 0)
  })

  it('sin PANEL_URL responde 503 sin enviar', async () => {
    const { deps, enviados } = montar({ panelUrl: ' ' })
    assert.equal((await manejar(pedido({ barrer: true }), deps)).status, 503)
    assert.equal(enviados.length, 0)
  })

  it('el barrido recorre las organizaciones pendientes y suma resultados (FR-205)', async () => {
    const { deps, enviados, generaciones } = montar({
      organizaciones: [ORG, '33333333-3333-4333-8333-333333333333'],
      generado: [generado([producto(1, 'sin_stock')])],
    })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { procesadas: 2, resultados: { enviado: 2 }, errores: 0 })
    assert.equal(generaciones.length, 2)
    assert.equal(enviados.length, 2)
  })

  it('una organización con error no frena a las demás', async () => {
    const { deps } = montar({ organizaciones: [ORG], generarError: true })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 502, 'Kestra debe ver la ejecución como fallida')
    assert.deepEqual(await res.json(), { procesadas: 1, resultados: {}, errores: 1 })
  })

  it('si no puede listar las organizaciones responde 502', async () => {
    const { deps } = montar({ organizacionesError: true })
    assert.equal((await manejar(pedido({ barrer: true }), deps)).status, 502)
  })

  it('procesa una organización puntual y valida su id', async () => {
    const { deps } = montar({ generado: [generado([producto(1, 'sin_stock')])] })
    const ok = await manejar(pedido({ organizacion_id: ORG }), deps)
    assert.deepEqual(await ok.json(), { estado: 'enviado' })
    assert.equal((await manejar(pedido({ organizacion_id: 'no-uuid' }), deps)).status, 400)
    assert.equal((await manejar(pedido({}), deps)).status, 400)
  })
})
