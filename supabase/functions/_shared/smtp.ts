// Cableado del envío SMTP sin URL de Deno (se prueba con `node --test`): configura el cliente y manda el correo SIEMPRE por
// `enviarConLimites` (fase de conexión + envío + cierre con tope). `correo.ts` solo aporta el SMTPClient y `Deno.connect` reales.
import { enviarConLimites, type ClienteSmtp } from './envio.ts'
import { lineaSegura } from './texto.ts'

export type MensajeCorreo = { para: string[]; asunto: string; texto: string }
export type EnviarCorreo = (mensaje: MensajeCorreo) => Promise<void>
export type CorreoSmtp = { from: string; to: string[]; subject: string; content: string }

export type ConfigSmtp = { hostname: string; from: string; port: number; tls: boolean; usuario?: string; clave?: string }

export function armarEnvio({ config, crearCliente, conectar, limites }: {
  config: ConfigSmtp
  crearCliente: (config: ConfigSmtp) => ClienteSmtp<CorreoSmtp>
  conectar: (hostname: string, port: number) => Promise<unknown>
  limites?: { timeoutMs?: number; cierreMs?: number; conexionMs?: number }
}): EnviarCorreo {
  return async ({ para, asunto, texto }) => {
    const cliente = crearCliente(config)
    await enviarConLimites(
      cliente,
      { from: config.from, to: para.map(lineaSegura), subject: lineaSegura(asunto), content: texto },
      { ...limites, conectar: () => conectar(config.hostname, config.port) },
    )
  }
}
