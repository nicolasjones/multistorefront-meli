// Lógica de `baja-correo-masivo` (F-CLI-12, FR-019, SC-004) con dependencias inyectadas para poder probarla sin Deno
// ni Supabase (handler.test.ts). `index.ts` solo cablea el cliente real.
//
// Es anónima: la abre quien recibe el correo desde el enlace de baja. El enlace trae un token aleatorio (≥ 128 bits);
// la base solo guarda su hash SHA-256, así que acá se calcula el hash y se llama a `dar_de_baja_correo_masivo`
// (solo `service_role`). La respuesta es SIEMPRE `{ ok: true }` exista o no el token y se repita o no la baja
// (idempotente): no se puede enumerar qué tokens son válidos. Un fallo de la base responde 500 sin detalle, para que
// quien quiere darse de baja pueda reintentar, y solo se registra en el log (sin el token).

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type Deps = {
  // Solo `dar_de_baja_correo_masivo` (restringida a service_role).
  admin: { rpc(nombre: string, args: Record<string, unknown>): Resultado<unknown> }
}

// Los tokens son hexadecimales de 64 caracteres; un largo mayor es basura y no se hashea.
const TOKEN_MAXIMO = 128
const TOKEN = /^[0-9a-zA-Z_-]+$/

async function sha256Hex(texto: string): Promise<string> {
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(resumen), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function manejar(req: Request, { admin }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)

  const body = await req.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  // La forma inválida no depende de que el token exista, así que puede rechazarse sin filtrar nada.
  if (!token || token.length > TOKEN_MAXIMO || !TOKEN.test(token)) {
    return response({ error: 'Datos inválidos.' }, 400)
  }

  try {
    // Un token desconocido no es error: la función devuelve false y la respuesta es la misma.
    const { error } = await admin.rpc('dar_de_baja_correo_masivo', { p_token_hash: await sha256Hex(token) })
    if (error) throw new Error(error.message)
  } catch (cause) {
    console.error('baja-correo-masivo: no se pudo procesar la baja', cause instanceof Error ? cause.message : cause)
    return response({ error: 'No pudimos procesar la baja. Probá de nuevo en un rato.' }, 500)
  }
  return response({ ok: true })
}
