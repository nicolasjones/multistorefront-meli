// Entrega de un aviso a un destino externo (F-API-01, FR-010, FR-012, SC-003)
// con dependencias inyectadas para probarla sin Deno ni Supabase
// (`handler.test.ts`). `index.ts` solo cablea el cliente real.
//
// La entrega es DURABLE: la base decide cuándo reintentar (5 intentos con
// espera 60 s × 2^(intentos-1), D-6) y esta función solo intenta una vez y
// deja el resultado. Un aviso llega a lo sumo una vez por suscripción y
// evento: la idempotencia la garantiza `unique (evento_id, suscripcion_id)`.
//
// Seguridad (FR-010):
//   · el destino se vuelve a resolver por DNS antes de entregar: si cae en un
//     rango interno la entrega falla (y no se sigue ninguna redirección);
//   · la firma es HMAC-SHA256 sobre `<t>.<cuerpo>` con el secreto de la
//     suscripción (que vive en Vault y nunca sale de la base hacia el
//     navegador);
//   · el error que se guarda está saneado: sin secretos ni credenciales.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Timeout de la entrega (D-6). */
export const TIMEOUT_ENTREGA_MS = 10_000

/** Estados que deja la función: la base agota la entrega en el quinto intento. */
export type EstadoEntrega = 'completada' | 'pendiente'

export type Resultado<T> = Promise<{ data: T; error: { message: string; code?: string } | null }>

export type Envio = {
  url: string
  /** IP ya resuelta y validada: el transporte se conecta a ella, no al host. */
  ip: string
  familia: 4 | 6
  cabeceras: Record<string, string>
  cuerpo: string
  timeoutMs: number
}

export type Deps = {
  /** Clave de servicio de Supabase: la función solo la acepta a ella. */
  token: string | undefined
  /** Destino, evento y secreto de firma de la entrega. */
  entrega: (entregaId: string) => Resultado<{ url: string; evento: unknown; secreto: string; secreto_anterior?: string | null }[] | null>
  /** Deja el resultado de la entrega (la base calcula la espera del reintento). */
  resolver: (
    entregaId: string,
    estado: EstadoEntrega,
    estadoHttp: number | null,
    error: string | null,
  ) => Resultado<null>
  /** Resuelve el host del destino (DNS) para revalidar el SSRF. */
  resolverDns: (host: string) => Promise<string[]>
  /** Entrega a la IP resuelta: el host no se vuelve a resolver (anti-rebinding). */
  enviar: (envio: Envio) => Promise<{ status: number }>
  /** Reloj de la firma (epoch en milisegundos). */
  ahora: () => number
}

const ERROR_MAX = 500

function respuesta(cuerpo: unknown, estado: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Comparación en tiempo constante del secreto de servicio. */
function tokenValido(esperado: string | undefined, recibido: string | null): boolean {
  if (!esperado || !recibido) return false
  const a = new TextEncoder().encode(esperado)
  const b = new TextEncoder().encode(recibido)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** El error que se guarda nunca lleva el secreto ni credenciales. */
export function sanearError(mensaje: string, secreto: string, secretoAnterior?: string | null): string {
  let sinSecreto = secreto ? mensaje.split(secreto).join('[REDACTADO]') : mensaje
  if (secretoAnterior) sinSecreto = sinSecreto.split(secretoAnterior).join('[REDACTADO]')
  return sinSecreto.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX)
}

/** Host del destino, sin puerto. */
export function hostDe(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host || null
  } catch {
    return null
  }
}

function ipv4Privada(ip: string): boolean {
  const partes = ip.split('.')
  if (partes.length !== 4) return false
  const numeros = partes.map((parte) => Number(parte))
  if (numeros.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b, c] = numeros
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return false
}

/**
 * Expande una dirección IPv6 a sus 8 grupos de 16 bits (admite `::` y un sufijo
 * IPv4 punteado). Devuelve `null` si no se puede interpretar: quien llama la trata
 * como interna (falla cerrada).
 */
function expandirIpv6(ip: string): number[] | null {
  let texto = ip.toLowerCase().split('%')[0]
  const punteado = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(texto)
  if (punteado) {
    const partes = punteado[1].split('.').map(Number)
    if (partes.some((n) => n > 255)) return null
    const alto = ((partes[0] << 8) | partes[1]).toString(16)
    const bajo = ((partes[2] << 8) | partes[3]).toString(16)
    texto = `${texto.slice(0, texto.length - punteado[1].length)}${alto}:${bajo}`
  }
  const dobles = texto.split('::')
  if (dobles.length > 2) return null
  const aGrupos = (parte: string) => (parte === '' ? [] : parte.split(':'))
  const izquierda = aGrupos(dobles[0])
  const derecha = dobles.length === 2 ? aGrupos(dobles[1]) : []
  let grupos: string[]
  if (dobles.length === 2) {
    const faltan = 8 - izquierda.length - derecha.length
    if (faltan < 1) return null
    grupos = [...izquierda, ...Array(faltan).fill('0'), ...derecha]
  } else {
    grupos = izquierda
  }
  if (grupos.length !== 8) return null
  const numeros = grupos.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN))
  return numeros.some((n) => Number.isNaN(n)) ? null : numeros
}

function ipv4DeGrupos(alto: number, bajo: number): string {
  return `${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`
}

function ipv6Privada(ip: string): boolean {
  const g = expandirIpv6(ip)
  if (g === null) return true
  const ceros = (desde: number, hasta: number) => g.slice(desde, hasta).every((n) => n === 0)
  // ::/96 (no especificada, loopback y «IPv4-compatible» obsoleta).
  if (ceros(0, 6)) return true
  // IPv4 mapeada ::ffff:a.b.c.d (en cualquier notación): vale lo que valga la IPv4.
  if (ceros(0, 5) && g[5] === 0xffff) return ipv4Privada(ipv4DeGrupos(g[6], g[7]))
  // NAT64 64:ff9b::/96 traduce a la IPv4 embebida; 64:ff9b:1::/48 es de uso local.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true
    if (ceros(2, 6)) return ipv4Privada(ipv4DeGrupos(g[6], g[7]))
    return true
  }
  // 6to4 2002::/16 lleva la IPv4 en los grupos 1 y 2.
  if (g[0] === 0x2002) return ipv4Privada(ipv4DeGrupos(g[1], g[2]))
  // Teredo 2001::/32 y documentación 2001:db8::/32: nunca son destinos públicos válidos.
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true
  // 100::/64 (descarte), ULA fc00::/7, link-local fe80::/10, site-local fec0::/10 y multicast ff00::/8.
  if (g[0] === 0x100 && ceros(1, 4)) return true
  if ((g[0] & 0xfe00) === 0xfc00) return true
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true
  if ((g[0] & 0xff00) === 0xff00) return true
  return false
}

/** Una dirección interna (loopback, privada, link-local o metadata). */
export function esInterna(ip: string): boolean {
  return ip.includes(':') ? ipv6Privada(ip) : ipv4Privada(ip)
}

/**
 * El destino tiene que ser público: se rechazan loopback, rangos privados,
 * link-local y metadata. Si resuelve a más de una dirección, se rechazan
 * todas las que sean internas (rebinding de DNS).
 */
export function destinoPermitido(direcciones: string[]): boolean {
  return direcciones.length > 0 && direcciones.every((ip) => !esInterna(ip))
}

/**
 * Firma del aviso: `t=<epoch>,v1=<hmac-sha256-hex>` sobre `<t>.<cuerpo>`. Durante la gracia de una rotación del secreto
 * (MSF-839) lleva DOS `v1`, el del secreto nuevo y el del anterior: el receptor acepta el aviso si alguno coincide, así puede
 * cambiar el secreto sin cortar el servicio.
 */
export function firmar(cuerpo: string, secreto: string, epoch: number, secretoAnterior?: string | null): string {
  const hmac = (clave: string) => createHmac('sha256', clave).update(`${epoch}.${cuerpo}`).digest('hex')
  return `t=${epoch},v1=${hmac(secreto)}${secretoAnterior ? `,v1=${hmac(secretoAnterior)}` : ''}`
}

/** Si la base no pudo dejar el resultado (p. ej. `ENTREGA_NO_VIGENTE`: el lease venció), Kestra tiene que enterarse: 500 en vez de «completada». */
async function dejarResultado(
  deps: Deps,
  entregaId: string,
  estado: EstadoEntrega,
  estadoHttp: number | null,
  error: string | null,
): Promise<boolean> {
  const { error: falla } = await deps.resolver(entregaId, estado, estadoHttp, error)
  if (falla) console.error('entregar-webhook: no se pudo dejar el resultado de la entrega', falla.message)
  return !falla
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') {
    return respuesta({ error: 'Método no soportado, usar POST.' }, 405)
  }

  if (!deps.token) {
    console.error('entregar-webhook: falta SUPABASE_SERVICE_ROLE_KEY')
    return respuesta({ error: 'La función no está configurada.' }, 503)
  }

  const encabezado = req.headers.get('authorization') ?? ''
  const recibido = encabezado.startsWith('Bearer ') ? encabezado.slice('Bearer '.length).trim() : ''
  if (!tokenValido(deps.token, recibido)) {
    return respuesta({ error: 'Falta autenticación.' }, 403)
  }

  const cuerpo = await req.json().catch(() => null) as { entrega_id?: unknown } | null
  const entregaId = typeof cuerpo?.entrega_id === 'string' ? cuerpo.entrega_id : ''
  if (!entregaId) {
    return respuesta({ error: 'Pedido inválido: falta entrega_id.' }, 400)
  }

  const { data: entregas, error: errorLectura } = await deps.entrega(entregaId)
  if (errorLectura || !entregas?.length) {
    console.error('entregar-webhook: no se pudo leer la entrega', errorLectura)
    return respuesta({ error: 'No se pudo leer la entrega.' }, 500)
  }

  const { url, evento, secreto, secreto_anterior: secretoAnterior } = entregas[0]

  // SSRF al entregar (FR-010): el destino se resuelve y la entrega se hace
  // contra ESA IP (no se vuelve a resolver el host, así un DNS de TTL corto no
  // puede cambiar a una IP interna entre la validación y la conexión). No se
  // siguen redirecciones.
  const host = hostDe(url)
  const direcciones = host ? await deps.resolverDns(host) : []
  if (!host || !destinoPermitido(direcciones)) {
    if (!await dejarResultado(deps, entregaId, 'pendiente', null, 'DESTINO_NO_PERMITIDO')) {
      return respuesta({ error: 'No se pudo dejar el resultado de la entrega.' }, 500)
    }
    return respuesta({ estado: 'pendiente', error: 'El destino no se permite.' }, 200)
  }
  const ip = direcciones[0]

  const cuerpoEvento = JSON.stringify(evento)
  const epoch = Math.floor(deps.ahora() / 1000)
  const eventoId = (evento as { id?: unknown })?.id

  let estadoHttp: number | null = null
  let error: string | null = null
  try {
    const respuestaDestino = await deps.enviar({
      url,
      ip,
      familia: ip.includes(':') ? 6 : 4,
      cabeceras: {
        'Content-Type': 'application/json',
        'X-Evento-Id': typeof eventoId === 'string' ? eventoId : entregaId,
        'X-Firma': firmar(cuerpoEvento, secreto, epoch, secretoAnterior),
      },
      cuerpo: cuerpoEvento,
      timeoutMs: TIMEOUT_ENTREGA_MS,
    })
    estadoHttp = respuestaDestino.status
    if (estadoHttp === 0) {
      // El transporte devuelve la redirección como respuesta opaca: el 0 no es
      // un estado HTTP y no sirve para la auditoría.
      estadoHttp = null
      error = 'El destino respondió con una redirección no permitida'
    } else if (estadoHttp >= 300 && estadoHttp < 400) {
      error = `El destino respondió ${estadoHttp} (redirección no permitida)`
    } else if (estadoHttp < 200 || estadoHttp >= 300) {
      error = `El destino respondió ${estadoHttp}`
    }
  } catch (fallo) {
    error = fallo instanceof Error ? fallo.message : String(fallo)
  }

  if (!error) {
    if (!await dejarResultado(deps, entregaId, 'completada', estadoHttp, null)) {
      return respuesta({ error: 'No se pudo dejar el resultado de la entrega.' }, 500)
    }
    return respuesta({ estado: 'completada' }, 200)
  }

  // Falló: la base deja la entrega pendiente con la espera de D-6 o la
  // agota en el quinto intento.
  const mensaje = sanearError(error, secreto, secretoAnterior)
  if (!await dejarResultado(deps, entregaId, 'pendiente', estadoHttp, mensaje)) {
    return respuesta({ error: 'No se pudo dejar el resultado de la entrega.' }, 500)
  }
  return respuesta({ estado: 'pendiente', error: mensaje }, 200)
}
