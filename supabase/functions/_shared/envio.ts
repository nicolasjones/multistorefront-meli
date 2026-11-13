// Envío con límites de tiempo (MSF-161 M-2). Módulo aparte de `correo.ts` (importa denomailer desde una URL de Deno)
// para probar el cableado con `node --test` y un cliente simulado.
import { conTimeout } from './timeout.ts'

/** Lo mínimo que se usa del cliente SMTP (SMTPClient de denomailer lo cumple). */
export type ClienteSmtp<M> = { send(mensaje: M): Promise<unknown>; close(): Promise<unknown> }

/** Tope de la fase de conexión (antes de enviar nada): si se vence, el correo NO salió y el aviso es reintentable. */
export const TIMEOUT_CONEXION_MS = 10_000
export const TIMEOUT_SMTP_MS = 30_000
/** Tope del cierre del cliente: con un socket muerto `close()` podría no volver y colgar la respuesta de la función. */
export const TIMEOUT_CIERRE_MS = 5_000

/**
 * Envía en dos fases con límites propios:
 * 1. conexión (`conectar`, opcional): alcanzar el servidor. Si se vence falla con «smtp conexion timeout» (`TimeoutError`):
 *    todavía no se envió nada, así que `codigoDeError` lo trata como `smtp_conexion` (reintentable).
 * 2. envío (`send`, `timeoutMs`): falla con «smtp timeout» (`TimeoutError`): el DATA pudo haberse enviado, intento INCIERTO.
 * El cliente se cierra siempre con su propio tope: un `close()` colgado no demora ni cambia el resultado.
 */
export async function enviarConLimites<M>(
  cliente: ClienteSmtp<M>,
  mensaje: M,
  {
    timeoutMs = TIMEOUT_SMTP_MS,
    cierreMs = TIMEOUT_CIERRE_MS,
    conexionMs = TIMEOUT_CONEXION_MS,
    conectar,
  }: { timeoutMs?: number; cierreMs?: number; conexionMs?: number; conectar?: () => Promise<unknown> } = {},
): Promise<void> {
  try {
    if (conectar) {
      await conTimeout(Promise.resolve().then(conectar), conexionMs, 'smtp conexion timeout: no se pudo alcanzar el servidor a tiempo')
    }
    await conTimeout(cliente.send(mensaje), timeoutMs)
  } finally {
    await conTimeout(Promise.resolve().then(() => cliente.close()), cierreMs).catch(() => undefined)
  }
}
