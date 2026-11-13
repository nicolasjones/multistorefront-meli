// Cableado del envío SMTP sin URL de Deno (se prueba con `node --test`): configura el cliente y manda el correo SIEMPRE por
// `enviarConLimites` (fase de conexión + envío + cierre con tope). `correo.ts` solo aporta el SMTPClient y `Deno.connect` reales.
import { enviarConLimites, sondearConexion, type ClienteSmtp, type Conexion } from './envio.ts'
import { lineaSegura } from './texto.ts'

export type MensajeCorreo = { para: string[]; asunto: string; texto: string }
export type EnviarCorreo = (mensaje: MensajeCorreo) => Promise<void>
/** Parte de contenido de denomailer (`mimeContent`): `content` ya viene codificado según `transferEncoding`. */
export type ParteCorreo = { mimeType: string; content: string; transferEncoding: string }
export type CorreoSmtp = { from: string; to: string[]; subject: string; mimeContent: ParteCorreo[] }

const codificadorTexto = new TextEncoder()

/** Base64 de bytes sin depender de `Buffer` (corre igual en Deno y en node). */
function base64DeBytes(bytes: Uint8Array): string {
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binario)
}

/**
 * Cuerpo en base64 con líneas de 76 caracteres y CRLF. El texto se normaliza a CRLF antes de codificar. Se usa base64 y NO el
 * quoted-printable de denomailer 1.6.0: ese corta las líneas a 74 caracteres SIN respetar los bytes de un carácter multibyte
 * (corrompe «·», tildes, ñ y emojis según dónde caiga el corte) y deja saltos de línea sueltos (LF sin CR). Base64 es inmune a eso
 * y además ninguna línea puede empezar con «.» (sin dot-stuffing que cuidar).
 */
export function cuerpoBase64(texto: string): string {
  const normalizado = texto.replace(/\r\n|\r|\n/g, '\r\n')
  return (base64DeBytes(codificadorTexto.encode(normalizado)).match(/.{1,76}/g) ?? []).join('\r\n')
}

const ASCII = /^[\x20-\x7e]*$/
/** Bytes UTF-8 de cada palabra del asunto (ver `asuntoRfc2047`): 39 la primera, 45 las demás. */
const BYTES_PRIMERA_PALABRA = 39
const BYTES_PALABRA = 45

/**
 * Asunto listo para denomailer. Los asuntos ASCII pasan igual. Los que tienen caracteres no ASCII se codifican como palabras
 * RFC 2047 (`=?UTF-8?B?…?=`, base64) sin partir un carácter UTF-8, separadas por un pliegue de línea. La PRIMERA palabra es de a lo
 * sumo 39 bytes (<= 64 caracteres): con el prefijo `Subject:   ` (el de denomailer más nuestro espacio) la primera línea queda en
 * <= 78 caracteres, el máximo recomendado por RFC 5322; las siguientes, de a lo sumo 45 bytes (<= 72 caracteres, <= 75 con el espacio).
 * El prefijo de un espacio evita que denomailer vuelva a codificar la palabra (él lo hace con todo lo que empieza con «=?», y con su Q
 * deja espacios literales dentro de la palabra, inválidos según RFC 2047).
 *
 * ATENCIÓN: ese truco del espacio depende de cómo denomailer 1.6.0 trata las palabras «=?». NO subir denomailer de 1.6.0 sin correr
 * `supabase/functions/_shared/verificacion/smtp-real.deno.ts` (tiene que dar 18/18): los tests de node solo ven el objeto armado,
 * no el DATA que sale por el socket, y el script de Deno NO corre en CI.
 */
export function asuntoRfc2047(asunto: string): string {
  if (ASCII.test(asunto) && !asunto.startsWith('=?')) return asunto
  const palabras: string[] = []
  let actual = ''
  let bytesActual = 0
  for (const caracter of asunto) {
    const bytes = codificadorTexto.encode(caracter).length
    const limite = palabras.length === 0 ? BYTES_PRIMERA_PALABRA : BYTES_PALABRA
    if (bytesActual + bytes > limite) {
      palabras.push(actual)
      actual = ''
      bytesActual = 0
    }
    actual += caracter
    bytesActual += bytes
  }
  if (actual) palabras.push(actual)
  return ' ' + palabras.map((p) => `=?UTF-8?B?${base64DeBytes(codificadorTexto.encode(p))}?=`).join('\r\n ')
}

/** Arma el mensaje que recibe el cliente SMTP: remitente, destinatarios saneados, asunto codificado y cuerpo en base64. */
export function armarCorreoSmtp({ from, para, asunto, texto }: { from: string; para: string[]; asunto: string; texto: string }): CorreoSmtp {
  return {
    from,
    to: para.map(lineaSegura),
    subject: asuntoRfc2047(lineaSegura(asunto)),
    mimeContent: [{ mimeType: 'text/plain; charset="utf-8"', content: cuerpoBase64(texto), transferEncoding: 'base64' }],
  }
}

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
      armarCorreoSmtp({ from: config.from, para, asunto, texto }),
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

/** Puerto por defecto: 465 (TLS implícito), el único modo de stg/prd que funciona con denomailer 1.6.0 (587/STARTTLS no funciona). */
export const PUERTO_SMTP_POR_DEFECTO = 465

/**
 * `SMTP_PORT`: vacío o ausente = 465; si viene, tiene que ser un entero entre 1 y 65535 (si no, `ConfiguracionSmtpError`: un
 * `Number('abc')` = NaN o un 0 no deben llegar a la conexión).
 */
function puertoDesdeEntorno(valor: string | undefined): number {
  const texto = (valor ?? '').trim()
  if (texto === '') return PUERTO_SMTP_POR_DEFECTO
  const puerto = Number(texto)
  if (!/^\d+$/.test(texto) || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new ConfiguracionSmtpError('Configuración SMTP inválida: SMTP_PORT debe ser un puerto entre 1 y 65535.')
  }
  return puerto
}

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
  if (!hostname || !from) throw new ConfiguracionSmtpError('Configuración SMTP incompleta: falta SMTP_HOST / SMTP_FROM.')
  return {
    hostname,
    from,
    port: puertoDesdeEntorno(env('SMTP_PORT')),
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

/**
 * Valida la configuración SMTP del entorno SIN conectar ni enviar: variables obligatorias, `SMTP_TLS` true/false y la regla de
 * texto plano/credenciales. Lanza `ConfiguracionSmtpError` si no es válida. Las funciones que toman trabajo de una cola la llaman
 * ANTES de tomarlo, para que una configuración mala no gaste intentos ni marque avisos como fallidos.
 */
export function validarConfigSmtp(env: (clave: string) => string | undefined): void {
  opcionesDenomailer(configDesdeEntorno(env))
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
