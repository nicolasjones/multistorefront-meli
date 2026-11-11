// Pruebas de `entregar-webhook` (F-API-01, FR-010, FR-012, SC-003) con las
// dependencias simuladas: solo la clave de servicio entra; la firma es
// HMAC-SHA256 sobre `<t>.<cuerpo>`; el destino se revalida por DNS (SSRF) y
// no se siguen redirecciones; un fallo deja la entrega pendiente con el error
// saneado. Corre con `node --test` (`pnpm test:edge:entregar-webhook`); el
// handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { firmar, manejar, TIMEOUT_ENTREGA_MS, type Deps } from './handler.ts'

const TOKEN = 'clave-de-servicio'
const SECRETO = 'secreto-de-firma'
const EVENTO = { id: 'evento-1', tipo: 'stock.actualizado', organizacion_id: 'org-1', ocurrido_en: '2027-01-05T00:00:00Z', datos: { producto_id: 'p-1' } }
const EPOCH = 1_767_571_200

type Opciones = {
  destino?: { status: number }
  fallo?: Error
  dns?: string[]
  token?: string | undefined
}

function montar(opciones: Opciones = {}) {
  const llamadas = {
    resueltos: [] as unknown[],
    peticiones: [] as { url: string; init: RequestInit }[],
  }

  const deps: Deps = {
    token: 'token' in opciones ? opciones.token : TOKEN,
    entrega: async () => ({
      data: [{ url: 'https://ejemplo.com/aviso', evento: EVENTO, secreto: SECRETO }],
      error: null,
    }),
    resolver: async (...args) => {
      llamadas.resueltos.push(args)
      return { data: null, error: null }
    },
    resolverDns: async () => opciones.dns ?? ['203.0.113.10'],
    fetch: (async (url: string, init: RequestInit) => {
      llamadas.peticiones.push({ url, init })
      if (opciones.fallo) throw opciones.fallo
      return new Response('ok', { status: opciones.destino?.status ?? 200 })
    }) as unknown as typeof fetch,
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

  it('entrega el evento firmado y deja la entrega completada', async () => {
    const { deps, llamadas } = montar()
    const res = await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(res.status, 200)
    assert.equal((await res.json() as { estado: string }).estado, 'completada')

    const peticion = llamadas.peticiones[0]
    const cuerpo = peticion.init.body as string
    const epoch = EPOCH
    const esperado = createHmac('sha256', SECRETO).update(`${epoch}.${cuerpo}`).digest('hex')
    const cabeceras = peticion.init.headers as Record<string, string>
    assert.equal(cabeceras['X-Firma'], `t=${epoch},v1=${esperado}`)
    assert.equal(cabeceras['X-Evento-Id'], 'evento-1')
    assert.equal(cabeceras['Content-Type'], 'application/json')
    assert.equal(peticion.init.redirect, 'manual', 'no sigue redirecciones')
    assert.ok(peticion.init.signal, 'la entrega tiene timeout')
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

  it('un destino público se entrega', async () => {
    const { deps, llamadas } = montar({ dns: ['203.0.113.10'] })
    await manejar(pedir({ entrega_id: 'e-1' }), deps)
    assert.equal(llamadas.peticiones.length, 1)
    assert.equal(llamadas.peticiones[0].url, 'https://ejemplo.com/aviso')
  })

  it('la firma se puede verificar con el secreto de la suscripción', () => {
    const cuerpo = JSON.stringify(EVENTO)
    assert.equal(
      firmar(cuerpo, SECRETO, EPOCH),
      `t=${EPOCH},v1=${createHmac('sha256', SECRETO).update(`${EPOCH}.${cuerpo}`).digest('hex')}`,
    )
  })
})
