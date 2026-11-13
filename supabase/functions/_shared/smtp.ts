// Cableado del envío SMTP sin URL de Deno (se prueba con `node --test`): configura el cliente y manda el correo SIEMPRE por
// `enviarConLimites` (fase de conexión + envío + cierre con tope). `correo.ts` solo aporta el SMTPClient y `Deno.connect` reales.
import { enviarConLimites, sondearConexion, type ClienteSmtp, type Conexion } from './envio.ts'
import { lineaSegura } from './texto.ts'

export type MensajeCorreo = { para: string[]; asunto: string; texto: string }
export type EnviarCorreo = (mensaje: MensajeCorreo) => Promise<void>
export type CorreoSmtp = { from: string; to: string[]; subject: string; content: string }

/** `sondeo` (por defecto activo): sondeo TCP previo a `send` para separar «no se pudo conectar» (no salió nada); se desactiva con SMTP_SONDEO=false. */
export type ConfigSmtp = { hostname: string; from: string; port: number; tls: boolean; usuario?: string; clave?: string; sondeo?: boolean }

type Limites = { timeoutMs?: number; cierreMs?: number; conexionMs?: number }

export function armarEnvio({ config, crearCliente, conectar, limites }: {
  config: ConfigSmtp
  crearCliente: (config: ConfigSmtp) => ClienteSmtp<CorreoSmtp>
  conectar: (hostname: string, port: number, senal: AbortSignal) => Promise<unknown>
  limites?: Limites
}): EnviarCorreo {
  return async ({ para, asunto, texto }) => {
    const cliente = crearCliente(config)
    await enviarConLimites(
      cliente,
      { from: config.from, to: para.map(lineaSegura), subject: lineaSegura(asunto), content: texto },
      { ...limites, ...(config.sondeo === false ? {} : { conectar: (senal) => conectar(config.hostname, config.port, senal) }) },
    )
  }
}

/** Configuración SMTP desde las variables de entorno de la función; falla si falta lo imprescindible. */
export function configDesdeEntorno(env: (clave: string) => string | undefined): ConfigSmtp {
  const hostname = env('SMTP_HOST')
  const from = env('SMTP_FROM')
  if (!hostname || !from) throw new Error('Falta configurar SMTP_HOST / SMTP_FROM')
  return {
    hostname,
    from,
    port: Number(env('SMTP_PORT') ?? '587'),
    // Mailpit local no usa TLS; el relay del servidor sí (SMTP_TLS=true).
    tls: env('SMTP_TLS') === 'true',
    usuario: env('SMTP_USER'),
    clave: env('SMTP_PASS'),
    // Sondeo TCP previo (activo por defecto); SMTP_SONDEO=false lo apaga si el MTA penaliza un connect-and-drop (postscreen, fail2ban).
    sondeo: env('SMTP_SONDEO') !== 'false',
  }
}

/** Opciones del `SMTPClient` de denomailer a partir de la configuración (puerto y host sin intercambiar; credenciales solo si hay las dos). */
export function opcionesDenomailer({ hostname, port, tls, usuario, clave }: ConfigSmtp) {
  return { connection: { hostname, port, tls, ...(usuario && clave ? { auth: { username: usuario, password: clave } } : {}) } }
}

/** Argumentos de `Deno.connect` para el sondeo. */
export const opcionesConexion = (hostname: string, port: number) => ({ hostname, port })

/**
 * Envío completo a partir del entorno: lo único que aporta `correo.ts` son los constructores reales (`SMTPClient`, `Deno.connect`).
 * Todo lo demás (qué variable es qué, host/puerto del sondeo, límites) se prueba acá.
 */
export function armarEnvioDesdeEntorno({ env, crearCliente, abrirConexion, limites }: {
  env: (clave: string) => string | undefined
  crearCliente: (opciones: ReturnType<typeof opcionesDenomailer>) => ClienteSmtp<CorreoSmtp>
  abrirConexion: (opciones: ReturnType<typeof opcionesConexion>) => Promise<Conexion>
  limites?: Limites
}): EnviarCorreo {
  return async (mensaje) => {
    const config = configDesdeEntorno(env)
    await armarEnvio({
      config,
      crearCliente: (cfg) => crearCliente(opcionesDenomailer(cfg)),
      conectar: (host, port, senal) => sondearConexion(() => abrirConexion(opcionesConexion(host, port)), senal),
      limites,
    })(mensaje)
  }
}
