// Pruebas del transporte de `entregar-webhook` (F-API-01, FR-012): la conexión
// va a la IP ya validada —aunque el host no resuelva— y no se siguen
// redirecciones. Corre con `node --test` contra un servidor local.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createServer as crearServidorTcp, type Server as ServidorTcp } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { enviar } from './envio.ts'
import type { Envio } from './handler.ts'

describe('enviar', () => {
  let servidor: Server
  let puerto = 0
  let vistas: string[] = []
  let ultimo: { host?: string; cuerpo: string; firma?: string } | null = null

  before(async () => {
    servidor = createServer((req, res) => {
      vistas.push(req.url ?? '')
      let cuerpo = ''
      req.on('data', (parte) => { cuerpo += parte })
      req.on('end', () => {
        ultimo = { host: req.headers.host, cuerpo, firma: req.headers['x-firma'] as string | undefined }
        if (req.url === '/redirigir') {
          res.writeHead(302, { Location: '/otro' })
          res.end()
          return
        }
        res.writeHead(202)
        res.end('ok')
      })
    })
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver))
    const direccion = servidor.address()
    if (direccion && typeof direccion === 'object') puerto = direccion.port
  })

  after(() => new Promise<void>((resolver) => servidor.close(() => resolver())))

  const envio = (ruta: string): Envio => ({
    url: `http://destino-que-no-resuelve.invalid:${puerto}${ruta}`,
    ip: '127.0.0.1',
    familia: 4,
    cabeceras: { 'Content-Type': 'application/json', 'X-Evento-Id': 'e-1', 'X-Firma': 't=1,v1=abc' },
    cuerpo: '{"id":"e-1"}',
    timeoutMs: 2000,
  })

  it('conecta a la IP validada aunque el host no resuelva', async () => {
    vistas = []
    ultimo = null
    const respuesta = await enviar(envio('/aviso'))
    assert.equal(respuesta.status, 202)
    assert.deepEqual(vistas, ['/aviso'])
    assert.equal(ultimo?.host, `destino-que-no-resuelve.invalid:${puerto}`)
    assert.equal(ultimo?.cuerpo, '{"id":"e-1"}')
    assert.equal(ultimo?.firma, 't=1,v1=abc')
  })

  it('no sigue redirecciones', async () => {
    vistas = []
    const respuesta = await enviar(envio('/redirigir'))
    assert.equal(respuesta.status, 302)
    assert.deepEqual(vistas, ['/redirigir'])
  })

  it('un destino que gotea bytes (sin completar la respuesta) se corta por el tope TOTAL, no por inactividad', async () => {
    // Responde un encabezado que nunca termina, de a un byte cada 40 ms: el `timeout` de inactividad de node no salta nunca.
    const lento: ServidorTcp = crearServidorTcp((socket) => {
      socket.write('HTTP/1.1 200 OK\r\nX-Lento: ')
      const goteo = setInterval(() => socket.write('a'), 40)
      socket.on('close', () => clearInterval(goteo))
      socket.on('error', () => clearInterval(goteo))
    })
    await new Promise<void>((resolver) => lento.listen(0, '127.0.0.1', resolver))
    const direccion = lento.address()
    const puertoLento = direccion && typeof direccion === 'object' ? direccion.port : 0
    const inicio = Date.now()
    try {
      await assert.rejects(
        enviar({ ...envio('/aviso'), url: `http://destino-lento.invalid:${puertoLento}/aviso`, timeoutMs: 400 }),
        /TIMEOUT/,
      )
      assert.ok(Date.now() - inicio < 1500, 'el corte llega cerca del tope total')
    } finally {
      await new Promise<void>((resolver) => lento.close(() => resolver()))
    }
  })
})
