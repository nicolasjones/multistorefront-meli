// Pruebas de `enviar-resumen-semanal` con la base y el SMTP simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-resumen-semanal`); handler.ts y contenido.ts no importan nada de Deno.
// Verifica RF-REP-08-3 (contenido por secciones), RF-REP-08-4/5 (un correo por organización y semana, fallo con motivo fijo y
// sin duplicar), RF-REP-08-7 (solo agregados) y RF-REP-08-8 (enlaces al panel, a la pausa y a la baja).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  TOPE_ITEMS,
  asuntoResumenSemanal,
  cuerpoResumenSemanal,
  enlaces,
  formatearDia,
  formatearPesos,
  periodoTexto,
  type ContenidoResumen,
} from './contenido.ts'
import { MAX_CUERPO_BYTES, MAX_INTENTOS, manejar, mensajeDeError, procesarOrganizacion, type Deps, type Generado } from './handler.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const RESUMEN = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'secreto-de-prueba'
const PANEL = 'https://panel.example.com/'

const COMPLETO: ContenidoResumen = {
  desde: '2027-03-15',
  hasta: '2027-03-21',
  fuentes: ['ventas', 'rentabilidad', 'stock', 'faltantes'],
  ventas: {
    facturado: 3630,
    facturado_anterior: 605,
    comprobantes: 2,
    unidades: 3,
    tiendas: [{ nombre: 'Tienda B', facturado: 2420 }, { nombre: 'Tienda A', facturado: 1210 }],
  },
  rentabilidad: { vendido: 3000, margen: 200, margen_pct: 6.7, productos_en_riesgo: 4 },
  stock: {
    sin_stock: 1,
    stock_bajo: 1,
    productos: [{ nombre: 'Zapato', sku: 'P-1', estado: 'sin_stock' }, { nombre: 'Suelto', sku: 'P-2', estado: 'stock_bajo' }],
  },
  faltantes: { pendientes: 1, unidades: 2, dias_mas_antiguo: 3 },
}

const generado = (contenido: ContenidoResumen = COMPLETO, destinatarios = ['ana@example.com', 'beto@example.com']): Generado => ({
  resumen_id: RESUMEN,
  organizacion_nombre: 'Organización Uno',
  semana_desde: '2027-03-15',
  semana_hasta: '2027-03-21',
  contenido,
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

const pedido = (cuerpo: unknown, cabeceras: Record<string, string> = { 'x-aviso-token': TOKEN }, metodo = 'POST') =>
  new Request('http://localhost/enviar-resumen-semanal', { method: metodo, headers: cabeceras, body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined })

describe('contenido del correo (RF-REP-08-3, RF-REP-08-8)', () => {
  it('trae las cuatro secciones, el período en castellano y los enlaces al panel, la pausa y la baja', () => {
    const texto = cuerpoResumenSemanal(COMPLETO, { organizacion: 'Organización Uno', panelUrl: PANEL })
    assert.match(texto, /Semana del 15 de marzo al 21 de marzo de 2027/)
    for (const titulo of ['VENTAS', 'MARGEN Y RENTABILIDAD', 'STOCK EN ALERTA', 'FALTANTES PENDIENTES']) assert.ok(texto.includes(titulo), titulo)
    assert.match(texto, /3\.630,00/)
    assert.match(texto, /\+500,0 % respecto de la semana anterior/)
    assert.match(texto, /Productos con margen bajo o negativo hoy: 4/)
    assert.match(texto, /Zapato \(SKU P-1\) — Sin stock/)
    assert.match(texto, /1 faltante abierto \(2 unidades\)/)
    const e = enlaces(PANEL)
    assert.equal(e.panel, 'https://panel.example.com/')
    for (const enlace of [e.panel, e.pausar, e.baja, e.tableros, e.ventas, e.rentabilidad, e.stock, e.faltantes]) assert.ok(texto.includes(enlace), enlace)
  })

  it('omite las secciones cuya fuente no existe y no falla', () => {
    const texto = cuerpoResumenSemanal({ desde: COMPLETO.desde, hasta: COMPLETO.hasta, fuentes: [], ventas: COMPLETO.ventas }, { organizacion: 'Org', panelUrl: PANEL })
    assert.ok(texto.includes('VENTAS'))
    for (const titulo of ['MARGEN Y RENTABILIDAD', 'STOCK EN ALERTA', 'FALTANTES PENDIENTES']) assert.ok(!texto.includes(titulo), titulo)
    const vacio = cuerpoResumenSemanal({ desde: COMPLETO.desde, hasta: COMPLETO.hasta, fuentes: [] }, { organizacion: 'Org', panelUrl: PANEL })
    assert.match(vacio, /no hay novedades para resumir/)
  })

  it('con las fuentes de stock y faltantes pero sin nada en alerta, lo dice en una línea', () => {
    const texto = cuerpoResumenSemanal({ ...COMPLETO, stock: undefined, faltantes: undefined }, { organizacion: 'Org', panelUrl: PANEL })
    assert.match(texto, /Sin alertas de stock ni faltantes pendientes/)
  })

  it('una semana sin ventas lo dice y no inventa totales', () => {
    const texto = cuerpoResumenSemanal(
      { desde: COMPLETO.desde, hasta: COMPLETO.hasta, fuentes: ['ventas'], ventas: { facturado: 0, facturado_anterior: 0, comprobantes: 0, unidades: 0, tiendas: [] } },
      { organizacion: 'Org', panelUrl: PANEL },
    )
    assert.match(texto, /No hubo ventas en la semana/)
  })

  it('limpia saltos de línea y caracteres de control de los nombres (cabeceras y cuerpo)', () => {
    const asunto = asuntoResumenSemanal('Tienda\r\nBcc: x@y.com', '2027-03-15', '2027-03-21')
    assert.ok(!/[\r\n]/.test(asunto))
    const texto = cuerpoResumenSemanal(
      { ...COMPLETO, stock: { sin_stock: 1, stock_bajo: 0, productos: [{ nombre: 'Zapato\nBcc: x', sku: 'P‮1', estado: 'sin_stock' }] } },
      { organizacion: 'Org\nBcc: y', panelUrl: PANEL },
    )
    assert.ok(!texto.includes('Zapato\nBcc'))
    assert.ok(!texto.includes('‮'))
  })

  it('lista a lo sumo TOPE_ITEMS productos y resume el resto con el total', () => {
    const productos = Array.from({ length: 12 }, (_, n) => ({ nombre: `Producto ${n}`, sku: `S-${n}`, estado: 'stock_bajo' as const }))
    const texto = cuerpoResumenSemanal({ ...COMPLETO, stock: { sin_stock: 0, stock_bajo: 12, productos: productos.slice(0, TOPE_ITEMS) } }, { organizacion: 'Org', panelUrl: PANEL })
    assert.equal(texto.split('\n').filter((l) => l.startsWith('  • Producto')).length, TOPE_ITEMS)
    assert.match(texto, /… y 7 más/)
  })

  it('formatea fechas y pesos en castellano de Argentina', () => {
    assert.equal(formatearDia('2027-03-05'), '5 de marzo')
    assert.equal(periodoTexto('2027-12-27', '2028-01-02'), '27 de diciembre al 2 de enero de 2028')
    assert.match(formatearPesos(1234.5), /1\.234,50/)
    assert.equal(formatearDia('no-es-fecha'), 'no-es-fecha')
  })
})

describe('procesarOrganizacion (RF-REP-08-4, RF-REP-08-5)', () => {
  it('envía UN correo a todos los administradores y cierra el resumen como enviado', async () => {
    const { deps, enviados, cierres, generaciones } = montar({ generado: [generado()] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'enviado')
    assert.equal(enviados.length, 1)
    assert.deepEqual(enviados[0].para, ['ana@example.com', 'beto@example.com'])
    assert.match(enviados[0].asunto, /Resumen semanal de Organización Uno/)
    assert.deepEqual(cierres, [{ id: RESUMEN, enviado: true, error: null }])
    assert.deepEqual(generaciones, [{ organizacion: ORG, tope: MAX_INTENTOS }])
  })

  it('sin resumen para generar (ya enviado, reservado o fuera de ventana): no envía nada', async () => {
    const { deps, enviados, cierres } = montar({ generado: [] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'sin_novedades')
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 0)
  })

  it('sin destinatarios: no envía ni cierra (la base ya lo registró)', async () => {
    const { deps, enviados, cierres } = montar({ generado: [generado(COMPLETO, [])] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'sin_destinatario')
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 0)
  })

  it('un SMTP caído deja el resumen fallido con un motivo fijo (sin host, IP ni correo) para que el reintento lo retome', async () => {
    const { deps, enviados, cierres } = montar({ generado: [generado()], falloSmtp: 'connect ECONNREFUSED 10.0.0.5:587 smtp.interno.example.com ana@example.com' })
    assert.equal(await procesarOrganizacion(ORG, deps), 'fallido')
    assert.equal(enviados.length, 0)
    assert.equal(cierres.length, 1)
    assert.equal(cierres[0].enviado, false)
    assert.match(cierres[0].error as string, /Falló el envío del correo/)
    assert.doesNotMatch(cierres[0].error as string, /10\.0\.0\.5|smtp\.interno|ana@/)
  })

  it('el reintento no duplica: un resumen ya enviado no vuelve a generarse (la base devuelve 0 filas)', async () => {
    const primera = montar({ generado: [generado()] })
    assert.equal(await procesarOrganizacion(ORG, primera.deps), 'enviado')
    const segunda = montar({ generado: [] })
    assert.equal(await procesarOrganizacion(ORG, segunda.deps), 'sin_novedades')
    assert.equal(segunda.enviados.length, 0)
  })

  it('direcciones inválidas: ninguna es destino, queda fallido sin intentar el envío', async () => {
    const { deps, enviados, cierres } = montar({ generado: [generado(COMPLETO, ['no-es-un-correo', 'a b@c.d'])] })
    assert.equal(await procesarOrganizacion(ORG, deps), 'fallido')
    assert.equal(enviados.length, 0)
    assert.equal(cierres[0].enviado, false)
  })

  it('si el correo salió pero no se pudo cerrar, igual informa enviado (al menos una vez, queda en los registros)', async () => {
    const { deps } = montar({ generado: [generado()], cerrarError: true })
    assert.equal(await procesarOrganizacion(ORG, deps), 'enviado')
  })

  it('un error de la base al generar se propaga para que el barrido lo cuente', async () => {
    const { deps } = montar({ generarError: true })
    await assert.rejects(procesarOrganizacion(ORG, deps), /No se pudo generar el resumen/)
  })
})

describe('manejar (autenticación y barrido)', () => {
  it('rechaza sin el secreto compartido o con uno distinto, y sin configuración falla cerrado', async () => {
    const { deps } = montar()
    assert.equal((await manejar(pedido({ barrer: true }, {}), deps)).status, 403)
    assert.equal((await manejar(pedido({ barrer: true }, { 'x-aviso-token': 'otro' }), deps)).status, 403)
    assert.equal((await manejar(pedido({ barrer: true }), { ...deps, token: undefined })).status, 503)
    assert.equal((await manejar(pedido({ barrer: true }), { ...deps, panelUrl: '  ' })).status, 503)
    assert.equal((await manejar(pedido({}, {}, 'GET'), deps)).status, 405)
  })

  it('el barrido procesa cada organización pendiente y responde 200', async () => {
    const otra = '33333333-3333-4333-8333-333333333333'
    const { deps, enviados, generaciones } = montar({ organizaciones: [ORG, otra], generado: [generado()] })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { procesadas: 2, resultados: { enviado: 2 }, errores: 0 })
    assert.equal(enviados.length, 2)
    assert.deepEqual(generaciones.map((g) => g.organizacion), [ORG, otra])
  })

  it('con un resumen fallido responde 502 para que Kestra marque la ejecución y reintente', async () => {
    const { deps } = montar({ organizaciones: [ORG], generado: [generado()], falloSmtp: 'boom' })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 502)
    assert.equal(((await res.json()) as { resultados: { fallido: number } }).resultados.fallido, 1)
  })

  it('una organización con error no frena a las demás', async () => {
    const { deps } = montar({ organizaciones: [ORG], generarError: true })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 502)
    assert.equal(((await res.json()) as { errores: number }).errores, 1)
  })

  it('un error al listar las organizaciones responde 502 sin detalle técnico', async () => {
    const { deps } = montar({ organizacionesError: true })
    const res = await manejar(pedido({ barrer: true }), deps)
    assert.equal(res.status, 502)
    assert.doesNotMatch(JSON.stringify(await res.json()), /boom/)
  })

  it('una organización puntual exige un UUID y los destinatarios nunca vienen del pedido', async () => {
    const { deps, enviados } = montar({ generado: [generado()] })
    assert.equal((await manejar(pedido({ organizacion_id: 'no-uuid' }), deps)).status, 400)
    assert.equal((await manejar(pedido({}), deps)).status, 400)
    const res = await manejar(pedido({ organizacion_id: ORG, para: ['intruso@example.com'], destinatarios: ['intruso@example.com'] }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual(enviados[0].para, ['ana@example.com', 'beto@example.com'])
  })
})

describe('tope del cuerpo del pedido', () => {
  it('rechaza con 413 un cuerpo de más de 64 KB sin procesar nada, por el largo declarado o por lo leído', async () => {
    const { deps, generaciones } = montar({ organizaciones: [ORG], generado: [generado()] })
    const grande = { barrer: true, relleno: 'x'.repeat(MAX_CUERPO_BYTES + 1) }
    const porLargoReal = await manejar(pedido(grande), deps)
    assert.equal(porLargoReal.status, 413)
    const declarado = await manejar(pedido({ barrer: true }, { 'x-aviso-token': TOKEN, 'content-length': String(MAX_CUERPO_BYTES + 1) }), deps)
    assert.equal(declarado.status, 413)
    assert.equal(generaciones.length, 0)
  })

  it('un cuerpo dentro del tope sigue funcionando y uno que no es JSON se trata como pedido sin organización', async () => {
    const { deps } = montar({ organizaciones: [], generado: [] })
    assert.equal((await manejar(pedido({ barrer: true, relleno: 'x'.repeat(1000) }), deps)).status, 200)
    const roto = new Request('http://localhost/x', { method: 'POST', headers: { 'x-aviso-token': TOKEN }, body: '{no es json' })
    assert.equal((await manejar(roto, deps)).status, 400)
  })

  it('sin token no lee el cuerpo: responde 403 (no 401, igual que enviar-resumen-reposicion)', async () => {
    const { deps } = montar()
    const res = await manejar(pedido({ barrer: true, relleno: 'x'.repeat(MAX_CUERPO_BYTES + 1) }, {}), deps)
    assert.equal(res.status, 403)
  })
})

describe('mensajeDeError', () => {
  it('quita correos, IP y hosts y acota el largo', () => {
    const texto = mensajeDeError(new Error(`falló ana@example.com en 10.1.2.3 y smtp.example.com ${'x'.repeat(500)}`))
    assert.doesNotMatch(texto, /ana@|10\.1\.2\.3|smtp\.example/)
    assert.ok(texto.length <= 300)
    assert.equal(mensajeDeError(new Error('')), 'Error de envío sin detalle')
  })
})
