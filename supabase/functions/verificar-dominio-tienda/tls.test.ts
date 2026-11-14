// Pruebas de la comprobación TLS de `verificar-dominio-tienda` (MSF-797): el timeout de 5 s ya no deja un `Conn`
// colgado. Se simulan `connect` y `startTls` con promesas controladas; corre con `node --test`
// (`pnpm test:edge:verificar-dominio-tienda`); `tls.ts` no importa nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { comprobarTls, type Conexion } from './tls.ts'

const HOST = 'mundojc.com.ar'
const IP = '203.0.113.24'

// Conexión simulada que cuenta cuántas veces se cerró.
const conexion = (nombre: string, cierres: string[]): Conexion => ({ close: () => { cierres.push(nombre) } })

// Promesa que se resuelve o rechaza desde afuera (la conexión «colgada»).
function diferida<T>() {
  let resolver!: (valor: T) => void
  let rechazar!: (motivo: unknown) => void
  const promesa = new Promise<T>((ok, mal) => { resolver = ok; rechazar = mal })
  return { promesa, resolver, rechazar }
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

describe('comprobarTls (MSF-797)', () => {
  it('conexión y certificado correctos: «activo» y cierra la conexión TLS una sola vez', async () => {
    const cierres: string[] = []
    const resultado = await comprobarTls(HOST, IP, {
      conectar: async () => conexion('tcp', cierres),
      iniciarTls: async () => conexion('tls', cierres),
    }, 200)
    assert.equal(resultado, 'activo')
    assert.deepEqual(cierres, ['tls'], 'cierra la conexión TLS (que cierra la TCP subyacente) y nada más')
  })

  it('se conecta a la IP de la plataforma y valida el certificado contra el dominio', async () => {
    const llamadas: string[] = []
    await comprobarTls(HOST, IP, {
      conectar: async (ip) => { llamadas.push(`conectar ${ip}`); return conexion('tcp', []) },
      iniciarTls: async (_tcp, host) => { llamadas.push(`tls ${host}`); return conexion('tls', []) },
    }, 200)
    assert.deepEqual(llamadas, [`conectar ${IP}`, `tls ${HOST}`])
  })

  it('el timeout durante la conexión TCP responde «pendiente» y cierra la conexión que llegue tarde', async () => {
    const cierres: string[] = []
    const tcp = diferida<Conexion>()
    const resultado = await comprobarTls(HOST, IP, {
      conectar: () => tcp.promesa,
      iniciarTls: async () => { throw new Error('no debería negociar TLS tras el timeout') },
    }, 20)
    assert.equal(resultado, 'pendiente')
    assert.deepEqual(cierres, [], 'todavía no hay conexión que cerrar')
    // La conexión llega después del vencimiento: queda cerrada, no colgada.
    tcp.resolver(conexion('tcp-tardia', cierres))
    await esperar(10)
    assert.deepEqual(cierres, ['tcp-tardia'])
  })

  // El socket que quedó pendiente de conectar se cancela al vencer el tiempo (no espera a que la promesa resuelva).
  it('el timeout durante la conexión TCP cancela la conexión pendiente', async () => {
    let senal: AbortSignal | undefined
    const tcp = diferida<Conexion>()
    const resultado = await comprobarTls(HOST, IP, {
      conectar: (_ip, s) => { senal = s; return tcp.promesa },
      iniciarTls: async () => { throw new Error('no debería negociar TLS tras el timeout') },
    }, 20)
    assert.equal(resultado, 'pendiente')
    assert.equal(senal?.aborted, true, 'la conexión pendiente se cancela al vencer el tiempo')
  })

  // Con Deno real no se verificó qué hace cerrar la TCP después de `startTls` (puede estar consumida): acá solo se afirma que se
  // INTENTA cerrarla y que, si el handshake termina tarde, esa conexión TLS sí se cierra (ver la limitación en `tls.ts`).
  it('el timeout durante el handshake TLS intenta cerrar la TCP y cierra la TLS que llegue tarde', async () => {
    const cierres: string[] = []
    const tls = diferida<Conexion>()
    const resultado = await comprobarTls(HOST, IP, {
      conectar: async () => conexion('tcp', cierres),
      iniciarTls: () => tls.promesa,
    }, 20)
    assert.equal(resultado, 'pendiente')
    assert.deepEqual(cierres, ['tcp'], 'al vencer se intenta cerrar la TCP')
    // El handshake termina tarde: esa conexión TLS también se cierra.
    tls.resolver(conexion('tls-tardia', cierres))
    await esperar(10)
    assert.deepEqual(cierres, ['tcp', 'tls-tardia'])
  })

  it('un certificado inválido responde «error» y cierra la conexión TCP', async () => {
    const cierres: string[] = []
    const resultado = await comprobarTls(HOST, IP, {
      conectar: async () => conexion('tcp', cierres),
      iniciarTls: async () => { throw new Error('invalid peer certificate: UnknownIssuer') },
    }, 200)
    assert.equal(resultado, 'error')
    assert.deepEqual(cierres, ['tcp'])
  })

  it('un puerto que no responde (rechazo de la conexión) es «pendiente» y no hay nada que cerrar', async () => {
    const cierres: string[] = []
    const resultado = await comprobarTls(HOST, IP, {
      conectar: async () => { throw new Error('Connection refused (os error 111)') },
      iniciarTls: async () => conexion('tls', cierres),
    }, 200)
    assert.equal(resultado, 'pendiente')
    assert.deepEqual(cierres, [])
  })

  it('cerrar una conexión que ya estaba cerrada no rompe la comprobación', async () => {
    const resultado = await comprobarTls(HOST, IP, {
      conectar: async () => conexion('tcp', []),
      iniciarTls: async () => ({ close: () => { throw new Error('BadResource: Bad resource ID') } }),
    }, 200)
    assert.equal(resultado, 'activo')
  })

  it('no deja temporizadores pendientes tras terminar (el proceso puede salir)', async () => {
    const inicio = Date.now()
    await comprobarTls(HOST, IP, {
      conectar: async () => conexion('tcp', []),
      iniciarTls: async () => conexion('tls', []),
    }, 60000)
    assert.ok(Date.now() - inicio < 1000, 'no espera el tiempo límite cuando la conexión sale bien')
  })
})
