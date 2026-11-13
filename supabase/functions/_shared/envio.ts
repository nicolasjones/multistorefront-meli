// Envío con límites de tiempo (MSF-161 M-2). Módulo aparte de `correo.ts` (importa denomailer desde una URL de Deno)
// para probar el cableado con `node --test` y un cliente simulado.
import { conTimeout } from './timeout.ts'

/** Lo mínimo que se usa del cliente SMTP (SMTPClient de denomailer lo cumple). */
export type ClienteSmtp<M> = { send(mensaje: M): Promise<unknown>; close(): Promise<unknown> }

export const TIMEOUT_SMTP_MS = 30_000
/** Tope del cierre del cliente: con un socket muerto `close()` podría no volver y colgar la respuesta de la función. */
export const TIMEOUT_CIERRE_MS = 5_000

/**
 * Envía con tope de `timeoutMs` (falla con `TimeoutError` «smtp timeout») y cierra el cliente con su propio tope: un
 * `close()` colgado no demora ni cambia el resultado del envío.
 */
export async function enviarConLimites<M>(
  cliente: ClienteSmtp<M>,
  mensaje: M,
  { timeoutMs = TIMEOUT_SMTP_MS, cierreMs = TIMEOUT_CIERRE_MS }: { timeoutMs?: number; cierreMs?: number } = {},
): Promise<void> {
  try {
    await conTimeout(cliente.send(mensaje), timeoutMs)
  } finally {
    await conTimeout(Promise.resolve().then(() => cliente.close()), cierreMs).catch(() => undefined)
  }
}
