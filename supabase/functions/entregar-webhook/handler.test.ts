// Pruebas de `entregar-webhook` (F-API-01, FR-010, FR-012, SC-003) con las
// dependencias simuladas: solo la clave de servicio entra; la firma es
// HMAC-SHA256 sobre `<t>.<cuerpo>`; el destino se revalida por DNS (SSRF) y
// no se siguen redirecciones; un fallo deja la entrega pendiente con el error
// saneado. Corre con `node --test` (`pnpm test:edge:entregar-webhook`); el
// handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { esInterna, firmar, manejar, TIMEOUT_ENTREGA_MS, type Deps, type Envio } from './handler.ts'

const TOKEN = 'clave-de-servicio'
const SECRETO = 'secreto-de-firma'
const EVENTO = { id: 'evento-1', tipo: 'stock.actualizado', organizacion_id: 'org-1', ocurrido_en: '2027-01-05T00:00:00Z', datos: { producto_id: 'p-1' } }
const EPOCH = 1_767_571_200

type Opciones = {
  destino?: { status: number }
  fallo?: Error
  dns?: string[]
  token?: string | undefined
  // La base no pudo dejar el resultado (p. ej. ENTREGA_NO_VIGENTE: el lease venció).
  falloResolver?: boolean
  // Secreto anterior durante la gracia de una rotación (MSF-839).
  secretoAnterior?: string | null
  anteriorIlegible?: boolean
}

function montar(opciones: Opciones = {}) {
  const llamadas = {
    resueltos: [] as unknown[],
    peticiones: [] as Envio[],
  }

  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    entrega: async () => ({
      data: [{ url: 'https://ejemplo.com/aviso', evento: EVENTO, secreto: SECRETO, secreto_anterior: opciones.secretoAnterior ?? null, secreto_anterior_ilegible: opciones.anteriorIlegible ?? false }],
      error: null,
    }),
    resolver: async (...args) => {
      llamadas.resueltos.push(args)
      return { data: null, error: opciones.falloResolver ? { message: 'ENTREGA_NO_VIGENTE' } : null }
    },
    resolverDns: async () => opciones.dns ?? ['203.0.113.10'],
    enviar: async (envio) => {
      llamadas.peticiones.push(envio)
      if (opciones.fallo) throw opciones.fallo
      return { status: opciones.destino?.status ?? 200 }
    },
    ahora: () => EPOCH * 1000,
  }

  return { deps, llamadas }
}

const pedir = (cuerpo: unknown, token: string | null = TOKEN) =>
  new Request('https://ejemplo.com/entregar-webhook', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(cuerpo),
  })

describe('entregar-webhook', () => {
  it('sin la clave de servicio no hace nada', async () => {
    const { deps } = montar()
    const sinAuth = await manejar(pedir({ entrega_id: 'e-1' }, null), deps)
    assert.equal(sinAuth.status, 403)

    const sinConfigurar = await manejar(pedir({ entrega_id: 'e-1' }), montar({ token: undefined }).deps)
    assert.equal(sinConfigurar.status, 503)
  })

  it('un método que no sea POST o un pedido sin entrega_id se rechaza', async () => {
    const { deps } = montar()
    const get = await manejar(new Request('https://ejemplo.com/entregar-webhook'), deps)
    assert.equal(get.status, 405)

    const sinId = await manejar(pedir({}), deps)
    assert.equal(sinId.status, 400)
  })

  it('si la base no puede dejar el resultado (lease vencido) responde 500 y no «completada»: Kestra se entera', async () => {
    const { deps } = montar({ falloResolver: true })
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 500)
    assert.equal((await res.json() as { estado?: string }).estado, undefined)
  })

  it('entrega el evento firmado y deja la entrega completada', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 200)
    assert.equal((await res.json() as { estado: string }).estado, 'completada')

    const peticion = llamadas.peticiones[0]
    const cuerpo = peticion.cuerpo
    const epoch = EPOCH
    const esperado = createHmac('sha256', SECRETO).update(`${epoch}.${cuerpo}`).digest('hex')
    const cabeceras = peticion.cabeceras
    assert.equal(cabeceras['X-Firma'], `t=${epoch},v1=${esperado}`)
    assert.equal(cabeceras['X-Evento-Id'], 'evento-1')
    assert.equal(cabeceras['Content-Type'], 'application/json')
    assert.equal(peticion.timeoutMs, TIMEOUT_ENTREGA_MS)
    assert.equal(TIMEOUT_ENTREGA_MS, 10_000)

    assert.deepEqual(llamadas.resueltos[0], ['e-1', 'completada', 200, null])
  })

  it('un destino que falla deja la entrega pendiente con el error saneado', async () => {
    const { deps, llamadas } = montar({ destino: { status: 500 } })
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 200)
    const [, estado, estadoHttp, error] = llamadas.resueltos[0] as [string, string, number, string]
    assert.equal(estado, 'pendiente')
    assert.equal(estadoHttp, 500)
    assert.match(error, /500/)
  })

  it('una redirección deja la entrega pendiente y no guarda un estado inexistente', async () => {
    // El transporte devuelve la redirección opaca (status 0): el 0 no es un
    // estado HTTP y no puede quedar en la auditoría.
    const opaca = montar({ destino: { status: 0 } })
    await manejar(pedir({ entrega_id: 'e-1' }), opaca.deps)
    const [, estado, estadoHttp, error] = opaca.llamadas.resueltos[0] as [string, string, number | null, string]
    assert.equal(estado, 'pendiente')
    assert.equal(estadoHttp, null)
    assert.match(error, /redirección/i)

    // Con el código real de la redirección, el error lo nombra.
    const conCodigo = montar({ destino: { status: 302 } })
    await manejar(pedir({ entrega_id: 'e-1' }), conCodigo.deps)
    const [, , estadoHttp2, error2] = conCodigo.llamadas.resueltos[0] as [string, string, number | null, string]
    assert.equal(estadoHttp2, 302)
    assert.match(error2, /302/)
    assert.match(error2, /redirección/i)
  })

  it('un timeout deja la entrega pendiente', async () => {
    const { deps, llamadas } = montar({ fallo: new Error('The operation was aborted due to timeout') })
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 200)
    const [, estado] = llamadas.resueltos[0] as [string, string]
    assert.equal(estado, 'pendiente')
  })

  it('el error guardado nunca lleva el secreto de firma', async () => {
    const { deps, llamadas } = montar({ fallo: new Error(`falló con ${SECRETO} adentro`) })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    const [, , , error] = llamadas.resueltos[0] as [string, string, number, string]
    assert.ok(!error.includes(SECRETO), 'el secreto no se guarda')
    assert.match(error, /REDACTADO/)
  })

  it('durante la gracia de una rotación el error tampoco lleva el secreto anterior', async () => {
    const { deps, llamadas } = montar({ secretoAnterior: 'secreto-viejo', fallo: new Error(`falló con ${SECRETO} y con secreto-viejo adentro`) })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    const [, , , error] = llamadas.resueltos[0] as [string, string, number, string]
    assert.ok(!error.includes(SECRETO) && !error.includes('secreto-viejo'), 'ninguno de los dos secretos se guarda')
  })

  it('durante la gracia de una rotación el aviso lleva dos firmas: la del secreto nuevo y la del anterior', async () => {
    const { deps, llamadas } = montar({ secretoAnterior: 'secreto-viejo' })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    const firma = llamadas.peticiones[0].cabeceras['X-Firma']
    const cuerpo = JSON.stringify(EVENTO)
    const v1 = (clave: string) => createHmac('sha256', clave).update(`${EPOCH}.${cuerpo}`).digest('hex')
    assert.equal(firma, `t=${EPOCH},v1=${v1(SECRETO)},v1=${v1('secreto-viejo')}`)
  })

  it('si Vault no pudo leer el secreto anterior, el aviso sale con una firma y queda un aviso en el log sin secretos', async () => {
    const avisos: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => { avisos.push(args.join(' ')) }
    try {
      const { deps, llamadas } = montar({ anteriorIlegible: true })
      const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
      assert.equal(res.status, 200)
      assert.equal((llamadas.peticiones[0].cabeceras['X-Firma'].match(/v1=/g) ?? []).length, 1)
    } finally {
      console.warn = original
    }
    assert.equal(avisos.length, 1)
    assert.match(avisos[0], /secreto anterior de la entrega e-1/)
    assert.ok(!avisos[0].includes(SECRETO), 'el log no lleva secretos')
  })

  it('sin rotación en curso el aviso lleva una sola firma', async () => {
    const { deps, llamadas } = montar()
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal((llamadas.peticiones[0].cabeceras['X-Firma'].match(/v1=/g) ?? []).length, 1)
  })

  it('un destino que resuelve a la red interna no recibe el aviso (SSRF)', async () => {
    const { deps, llamadas } = montar({ dns: ['127.0.0.1'] })
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 200)
    assert.equal(llamadas.peticiones.length, 0, 'no se entregó a un destino interno')
    assert.deepEqual(llamadas.resueltos[0], ['e-1', 'pendiente', null, 'DESTINO_NO_PERMITIDO'])
  })

  it('un destino que resuelve a varias direcciones las revisa todas', async () => {
    const { deps, llamadas } = montar({ dns: ['203.0.113.10', '10.0.0.5'] })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(llamadas.peticiones.length, 0, 'una sola dirección interna alcanza para rechazar')
  })

  it('un destino público se entrega contra la IP resuelta (anti-rebinding)', async () => {
    const { deps, llamadas } = montar({ dns: ['203.0.113.10'] })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(llamadas.peticiones.length, 1)
    assert.equal(llamadas.peticiones[0].url, 'https://ejemplo.com/aviso')
    assert.equal(llamadas.peticiones[0].ip, '203.0.113.10', 'se conecta a la IP validada, no vuelve a resolver')
    assert.equal(llamadas.peticiones[0].familia, 4)
  })

  it('la firma se puede verificar con el secreto de la suscripción', () => {
    const cuerpo = JSON.stringify(EVENTO)
    assert.equal(
      firmar(cuerpo, SECRETO, EPOCH),
      `t=${EPOCH},v1=${createHmac('sha256', SECRETO).update(`${EPOCH}.${cuerpo}`).digest('hex')}`,
    )
  })
})

describe('firmar con secreto anterior', () => {
  it('agrega la firma del secreto anterior después de la del nuevo y las dos se verifican por separado', () => {
    const cuerpo = JSON.stringify(EVENTO)
    const firma = firmar(cuerpo, SECRETO, EPOCH, 'secreto-viejo')
    const partes = firma.split(',')
    assert.equal(partes[0], `t=${EPOCH}`)
    assert.equal(partes.length, 3)
    assert.equal(partes[1], `v1=${createHmac('sha256', SECRETO).update(`${EPOCH}.${cuerpo}`).digest('hex')}`)
    assert.equal(partes[2], `v1=${createHmac('sha256', 'secreto-viejo').update(`${EPOCH}.${cuerpo}`).digest('hex')}`)
  })

  it('un secreto anterior vacío o nulo no agrega nada', () => {
    const cuerpo = JSON.stringify(EVENTO)
    assert.equal(firmar(cuerpo, SECRETO, EPOCH, null), firmar(cuerpo, SECRETO, EPOCH))
    assert.equal(firmar(cuerpo, SECRETO, EPOCH, ''), firmar(cuerpo, SECRETO, EPOCH))
  })
})

describe('esInterna (SSRF)', () => {
  const internas = [
    '127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '224.0.0.1',
    '::', '::1', '0:0:0:0:0:0:0:1', '::127.0.0.1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:c0a8:1',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::1',
    '2002:7f00:1::1', '2002:a9fe:a9fe::', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '100::1',
    'no-es-una-ip::zz', '1:2:3:4:5:6:7:8:9',
  ]
  for (const ip of internas) {
    it(`rechaza ${ip}`, () => assert.equal(esInterna(ip), true))
  }

  const publicas = ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::']
  for (const ip of publicas) {
    it(`acepta ${ip}`, () => assert.equal(esInterna(ip), false))
  }
})
