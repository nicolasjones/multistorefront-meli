// Cableado del envío SMTP sin URL de Deno (se prueba con `node --test`): configura el cliente y manda el correo SIEMPRE por
// `enviarConLimites` (fase de conexión + envío + cierre con tope). `correo.ts` solo aporta el SMTPClient y `Deno.connect` reales.
import { enviarConLimites, sondearConexion, type ClienteSmtp, type Conexion } from './envio.ts'
import { lineaSegura } from './texto.ts'

export type MensajeCorreo = { para: string[]; asunto: string; texto: string }
export type EnviarCorreo = (mensaje: MensajeCorreo) => Promise<void>
export type CorreoSmtp = { from: string; to: string[]; subject: string; content: string }

/** `sondeo` (por defecto activo): sondeo TCP previo a `send` para separar «no se pudo conectar» (no salió nada); se desactiva con SMTP_SONDEO=false (también 0, no, off). */
export type ConfigSmtp = {
  hostname: string
  from: string
  port: number
  tls: boolean
  usuario?: string
  clave?: string
  sondeo?: boolean
  /** Opt-in EXPLÍCITO (SMTP_PERMITIR_INSEGURO=true) para hablar con el SMTP sin TLS: solo local/dev con buzón de pruebas. */
  permitirInseguro?: boolean
}

type Limites = { timeoutMs?: number; cierreMs?: number; conexionMs?: number }

export function armarEnvio({ config, crearCliente, conectar, limites }: {
  config: ConfigSmtp
  crearCliente: (config: ConfigSmtp) => ClienteSmtp<CorreoSmtp>
  conectar: (hostname: string, port: number) => Promise<unknown>
  limites?: Limites
}): EnviarCorreo {
  return async ({ para, asunto, texto }) => {
    const cliente = crearCliente(config)
    await enviarConLimites(
      cliente,
      { from: config.from, to: para.map(lineaSegura), subject: lineaSegura(asunto), content: texto },
      { ...limites, ...(config.sondeo === false ? {} : { conectar: () => conectar(config.hostname, config.port) }) },
    )
  }
}

/** Error de configuración del envío SMTP (no del servidor ni del cliente): no se conecta ni se envía nada. */
export class ConfiguracionSmtpError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ConfiguracionSmtpError'
  }
}

/** Valores de `SMTP_SONDEO` que apagan el sondeo (sin distinguir mayúsculas ni espacios); cualquier otro lo deja activo. */
const SONDEO_APAGADO = new Set(['false', '0', 'no', 'off'])

/**
 * `SMTP_TLS` normalizado (sin espacios ni mayúsculas): solo `true` o `false`. Cualquier otro valor (indefinido, vacío, `1`, un typo)
 * es un error de configuración: NUNCA se interpreta como «sin TLS» (falla cerrado, sin enviar).
 */
function tlsDesdeEntorno(valor: string | undefined): boolean {
  const normalizado = (valor ?? '').trim().toLowerCase()
  if (normalizado === 'true') return true
  if (normalizado === 'false') return false
  throw new ConfiguracionSmtpError('Configuración SMTP inválida: SMTP_TLS debe ser true o false (stg/prd: true).')
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
    tls: tlsDesdeEntorno(env('SMTP_TLS')),
    usuario: env('SMTP_USER'),
    clave: env('SMTP_PASS'),
    // Sondeo TCP previo (activo por defecto); SMTP_SONDEO=false lo apaga si el MTA penaliza un connect-and-drop (postscreen, fail2ban).
    // Texto plano SOLO con opt-in explícito (normalizado): un olvido o un typo nunca lo habilita.
    permitirInseguro: (env('SMTP_PERMITIR_INSEGURO') ?? '').trim().toLowerCase() === 'true',
    sondeo: !SONDEO_APAGADO.has((env('SMTP_SONDEO') ?? '').trim().toLowerCase()),
  }
}

/**
 * Opciones del `SMTPClient` de denomailer a partir de la configuración (puerto y host sin intercambiar).
 * Regla de TLS (denomailer 1.6.0 rechaza toda conexión sin TLS salvo `debug.allowUnsecure`):
 * - `tls: true` -> conexión segura, con `auth` si hay usuario y clave (stg/prd).
 * - `tls: false` CON credenciales (aunque sea solo una) -> error de configuración: NUNCA se mandan credenciales sin TLS.
 * - `tls: false` SIN `permitirInseguro` (SMTP_PERMITIR_INSEGURO=true) -> error de configuración: el texto plano exige opt-in explícito.
 * - `tls: false` sin credenciales y CON el opt-in -> `debug: { allowUnsecure: true }`: buzón de pruebas local (Mailpit/Inbucket).
 * Los mensajes son fijos: no incluyen host, usuario ni clave.
 */
export function opcionesDenomailer({ hostname, port, tls, usuario, clave, permitirInseguro }: ConfigSmtp) {
  if (tls) {
    return { connection: { hostname, port, tls, ...(usuario && clave ? { auth: { username: usuario, password: clave } } : {}) } }
  }
  if (usuario || clave) {
    throw new ConfiguracionSmtpError(
      'Configuración SMTP insegura: SMTP_TLS=false con SMTP_USER/SMTP_PASS. No se envían credenciales por una conexión sin TLS: usá SMTP_TLS=true.',
    )
  }
  if (!permitirInseguro) {
    throw new ConfiguracionSmtpError(
      'Configuración SMTP insegura: SMTP_TLS=false sin SMTP_PERMITIR_INSEGURO=true. El texto plano solo se permite, de forma explícita, con un buzón de pruebas local; en stg/prd usá SMTP_TLS=true.',
    )
  }
  return { connection: { hostname, port, tls }, debug: { allowUnsecure: true } }
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
      conectar: (host, port) => sondearConexion(() => abrirConexion(opcionesConexion(host, port))),
      limites,
    })(mensaje)
  }
}
