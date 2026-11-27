// Lógica de `baja-correo-masivo` (F-CLI-12, FR-019, SC-004) con dependencias inyectadas para poder probarla sin Deno
// ni Supabase (handler.test.ts). `index.ts` solo cablea el cliente real.
//
// Rate limit (MSF-980): ANTES de leer el cuerpo se consume el cupo persistente de la IP (60 por hora, `public.consumir_cupo_baja_correo`: la base guarda solo su
// HMAC con el secreto del entorno). Sin cupo: 429 con `Retry-After`; si no se puede contar: 503 (falla cerrado). Ambas respuestas dependen solo del origen,
// nunca del token ni de si existe: la baja no se puede usar para enumerar. Un OPTIONS o un método no soportado no gastan cupo. Sin CAPTCHA ni contador en
// memoria (cada instancia tiene el suyo): ver docs/newsletter.md.
//
// Es anónima: la abre quien recibe el correo desde el enlace de baja. El enlace trae un token aleatorio (≥ 128 bits);
// la base solo guarda su hash SHA-256, así que acá se calcula el hash y se llama a `dar_de_baja_correo_masivo`
// (solo `service_role`). La respuesta es SIEMPRE `{ ok: true }` exista o no el token y se repita o no la baja
// (idempotente): no se puede enumerar qué tokens son válidos. Un fallo de la base responde 500 sin detalle, para que
// quien quiere darse de baja pueda reintentar, y solo se registra en el log (sin el token).
import { errorDeBase, textoDeError } from '../_shared/log-seguro.ts'

// CORS (MSF-963, RF-NL-9): la página de baja corre en el dominio de CADA tienda y llama a esta función con `supabase.functions.invoke`, así que el
// origen no se puede fijar de antemano: `*` es correcto porque la función no usa cookies ni credenciales (la autenticación es el token del enlace) y el
// navegador no manda credenciales a un origen `*`. Los encabezados permitidos son EXACTAMENTE los que declara el SDK de Supabase para sus llamadas
// (`@supabase/supabase-js/cors`, versión del lockfile): los cuatro que manda `functions.invoke` (`authorization`, `apikey`, `x-client-info`,
// `content-type`) más los opcionales de reintento y de trazas. Si el SDK suma uno, hay que sumarlo acá (lo fija handler.test.ts). POST es un método
// «seguro» para CORS, pero se declara igual para que el preflight sea explícito.
const permitidos = 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': permitidos }
// El preflight se puede recordar un día: menos pedidos OPTIONS por cada visita a la página de baja.
const preflightHeaders = { ...corsHeaders, 'Access-Control-Max-Age': '86400' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

import { cadenaProxy, ipDelCliente, SIN_IP } from '../_shared/ip-cliente.ts'
import { TEXTO_CUPO_NO_VERIFICABLE, type RechazoCupo } from './cupo.ts'

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type Deps = {
  // Solo `dar_de_baja_correo_masivo` (restringida a service_role).
  admin: { rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown> }
  // Cupo por IP (cupo.ts): `null` deja pasar; un rechazo trae el estado (429 o 503) y, en el 429, la espera.
  cupo: (ip: string) => Promise<RechazoCupo | null>
  // Saltos de proxy de confianza de `x-forwarded-for` (variable BAJA_PROXY_SALTOS; 0 por defecto).
  saltosProxy: number
}

// Los tokens son hexadecimales de 64 caracteres; un largo mayor es basura y no se hashea.
const TOKEN_MAXIMO = 128
const TOKEN = /^[0-9a-zA-Z_-]+$/

async function sha256Hex(texto: string): Promise<string> {
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(resumen), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function manejar(req: Request, { admin, cupo, saltosProxy }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)

  // Si la cadena no tiene la longitud esperada, el pedido cae en el cupo compartido `sin-ip` (cadena corta) o usa la IP de un proxy (cadena larga): en ambos
  // casos todos los clientes detrás comparten 60 bajas por hora. Se avisa, sin IP, para fijar BAJA_PROXY_SALTOS (docs/newsletter.md, paso de despliegue).
  const largoCadena = cadenaProxy(req.headers).length
  const ip = ipDelCliente(req.headers, saltosProxy)
  if (ip === SIN_IP || largoCadena !== saltosProxy + 1) {
    console.warn(`baja-correo-masivo: x-forwarded-for trae ${largoCadena} valores y se esperaban ${saltosProxy + 1}; ${ip === SIN_IP ? 'las bajas comparten el cupo sin-ip' : 'la IP resuelta puede ser la de un proxy y compartir cupo'}: revisá BAJA_PROXY_SALTOS`)
  }
  // Defensa en profundidad: `cupo` ya no lanza, pero si lo hiciera tampoco se deja pasar sin contar (falla cerrado).
  const rechazo = await cupo(ip).catch((): RechazoCupo => ({ status: 503, error: TEXTO_CUPO_NO_VERIFICABLE }))
  if (rechazo) {
    return new Response(JSON.stringify({ error: rechazo.error }), {
      status: rechazo.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(rechazo.retryAfter === undefined ? {} : { 'Retry-After': String(rechazo.retryAfter) }) },
    })
  }

  const body = await req.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  // La forma inválida no depende de que el token exista, así que puede rechazarse sin filtrar nada.
  if (!token || token.length > TOKEN_MAXIMO || !TOKEN.test(token)) {
    return response({ error: 'Datos inválidos.' }, 400)
  }

  try {
    // Un token desconocido no es error: la función devuelve false y la respuesta es la misma.
    const { error } = await admin.rpc('dar_de_baja_correo_masivo', { p_token_hash: await sha256Hex(token) })
    if (error) throw errorDeBase('dar_de_baja_correo_masivo falló', error)
  } catch (cause) {
    console.error('baja-correo-masivo: no se pudo procesar la baja', textoDeError(cause))
    return response({ error: 'No pudimos procesar la baja. Probá de nuevo en un rato.' }, 500)
  }
  return response({ ok: true })
}
