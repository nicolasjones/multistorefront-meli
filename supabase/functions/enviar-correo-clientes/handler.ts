// Correo masivo a clientes (prototipo Clientes · Listado, diálogo de correo).
// Lógica con dependencias inyectadas para probarla sin Deno ni Supabase
// (handler.test.ts). `index.ts` solo cablea los clientes reales. Sin imports
// (ni siquiera tipos de `_shared`: el URL-import de Deno rompería `node --test`).

type EnviarCorreo = (mensaje: { para: string[]; asunto: string; texto: string }) => Promise<void>
// Quita saltos de línea de lo que va en cabeceras (igual que `_shared/correo.ts`).
const lineaSegura = (valor: string) => valor.replace(/[\r\n]+/g, ' ').trim()

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type Deps = {
  verificarJwt(jwt: string): Promise<{ id: string; email?: string | null } | null>
  // Permisos del llamador (refleja `permisos_actuales`): se exige edición en Clientes.
  permisos(jwt: string): Resultado<{ seccion: string; nivel: string }[]>
  // Clientes con RLS del llamador (misma organización, sin BYPASS): el JWT acota solo.
  clientes(jwt: string, ids: string[]): Resultado<{ id: string; nombre: string; correo: string | null }[]>
  enviar: EnviarCorreo
}

const TOPE_DESTINATARIOS = 500

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Método no soportado.' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'Falta autenticación.' }, 403)
  const usuario = await deps.verificarJwt(jwt)
  if (!usuario) return response({ error: 'Token inválido o expirado.' }, 403)
  const { data: permisos, error: errorPermisos } = await deps.permisos(jwt)
  if (errorPermisos) return response({ error: 'No pudimos verificar tu permiso.' }, 403)
  const nivel = (permisos ?? []).find((p) => p.seccion === 'clientes')?.nivel ?? 'ninguno'
  if (nivel !== 'edicion') return response({ error: 'Solo quien edita Clientes puede enviar correos.' }, 403)

  const body = await req.json().catch(() => null) as { ids?: unknown; asunto?: unknown; mensaje?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x !== '') : []
  const asunto = typeof body?.asunto === 'string' ? body.asunto.trim() : ''
  const mensaje = typeof body?.mensaje === 'string' ? body.mensaje.trim() : ''
  if (ids.length === 0) return response({ error: 'Elegí al menos un cliente.' }, 400)
  if (ids.length > TOPE_DESTINATARIOS) return response({ error: `Como máximo ${TOPE_DESTINARIOS} destinatarios por envío.` }, 400)
  if (!asunto) return response({ error: 'Falta el asunto.' }, 400)
  if (!mensaje) return response({ error: 'Falta el mensaje.' }, 400)

  const { data: clientes, error: errorClientes } = await deps.clientes(jwt, [...new Set(ids)])
  if (errorClientes) return response({ error: 'No pudimos cargar los clientes.' }, 400)
  const conCorreo = (clientes ?? []).filter((c) => (c.correo ?? '').trim() !== '')
  const sinCorreo = (clientes ?? []).length - conCorreo.length
  if (conCorreo.length === 0) return response({ error: 'Ninguno de los elegidos tiene correo cargado.', sin_correo: sinCorreo }, 400)

  try {
    await deps.enviar({
      para: conCorreo.map((c) => c.correo as string),
      asunto: `${lineaSegura(asunto)} [Clientes]`,
      texto: mensaje,
    })
  } catch {
    return response({ error: 'No pudimos enviar el correo.' }, 502)
  }
  return response({ enviados: conCorreo.length, sin_correo: sinCorreo })
}
