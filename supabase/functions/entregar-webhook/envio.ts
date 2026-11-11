// Transporte real de la entrega (F-API-01, FR-012): se conecta directo a la IP
// ya resuelta y validada por `manejar` —el host no se vuelve a resolver, así un
// DNS de TTL corto no puede cambiarla a una IP interna entre la validación y la
// conexión— y no sigue redirecciones. Usa solo módulos `node:` del runtime, sin
// dependencias npm que resolver en cada arranque.
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Envio } from './handler.ts'

export function enviar(envio: Envio): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const destino = new URL(envio.url)
    const opciones: RequestOptions & { servername: string } = {
      method: 'POST',
      // La conexión va a la IP validada; el certificado y el SNI se verifican
      // contra el host del destino.
      host: envio.ip,
      port: destino.port || (destino.protocol === 'https:' ? 443 : 80),
      path: `${destino.pathname}${destino.search}`,
      family: envio.familia,
      servername: destino.hostname,
      headers: { ...envio.cabeceras, Host: destino.host },
      timeout: envio.timeoutMs,
    }
    const alResponder = (respuesta: IncomingMessage) => {
      respuesta.resume()
      resolve({ status: respuesta.statusCode ?? 0 })
    }
    const peticion = destino.protocol === 'https:'
      ? httpsRequest(opciones, alResponder)
      : httpRequest(opciones, alResponder)
    // El `timeout` de node es de INACTIVIDAD del socket: un destino que gotea bytes lo reinicia y retiene al trabajador
    // para siempre. Este temporizador es el tope TOTAL (conexión + respuesta) de `timeoutMs`.
    const tope = setTimeout(() => peticion.destroy(new Error('TIMEOUT')), envio.timeoutMs)
    peticion.on('close', () => clearTimeout(tope))
    peticion.on('timeout', () => peticion.destroy(new Error('TIMEOUT')))
    peticion.on('error', reject)
    peticion.end(envio.cuerpo)
  })
}
