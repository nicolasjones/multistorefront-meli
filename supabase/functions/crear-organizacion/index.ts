// Contrato: specs/003-fundacion-multitenant/contracts/crear-organizacion.md
//
// Única forma de dar de alta una organización (FR-009, FR-010): crea la
// fila, invita por email al fundador vía la Auth Admin API (requiere la
// service-role key — por eso es una Edge Function y no una RPC de
// Postgres, ver research.md) y lo deja como administrador de esa
// organización. Si la invitación falla, revierte la organización creada.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no soportado, usar POST.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Quién llama: se identifica con su propio JWT (no con la service-role,
  // esa queda solo para las escrituras internas de esta función).
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return jsonResponse({ error: 'Falta el header Authorization.' }, 403)
  }

  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt)
  if (callerError || !callerData?.user) {
    return jsonResponse({ error: 'Token inválido o expirado.' }, 403)
  }

  const { data: superadminRow } = await admin
    .from('superadmins')
    .select('user_id')
    .eq('user_id', callerData.user.id)
    .maybeSingle()

  if (!superadminRow) {
    return jsonResponse({ error: 'Solo un superadmin puede crear organizaciones.' }, 403)
  }

  let body: { nombre?: string; email_fundador?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }

  const nombre = body.nombre?.trim()
  const emailFundador = body.email_fundador?.trim()

  if (!nombre || !emailFundador) {
    return jsonResponse({ error: 'Faltan "nombre" o "email_fundador".' }, 400)
  }

  const { data: organizacion, error: organizacionError } = await admin
    .from('organizaciones')
    .insert({ nombre })
    .select('id')
    .single()

  if (organizacionError || !organizacion) {
    return jsonResponse(
      { error: `No se pudo crear la organización: ${organizacionError?.message}` },
      400,
    )
  }

  const { data: invitado, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    emailFundador,
  )

  if (inviteError || !invitado?.user) {
    await admin.from('organizaciones').delete().eq('id', organizacion.id)

    // GoTrue responde 422 cuando el email ya tiene cuenta — probablemente
    // con membresía activa en otra organización (FR-002, único-usuario-
    // única-organización). Cualquier otro fallo es un problema real de
    // envío, no un dato inválido del pedido.
    if (inviteError?.status === 422) {
      return jsonResponse(
        {
          error: `${emailFundador} ya tiene una cuenta registrada (FR-002: un usuario, una sola organización): ${inviteError.message}`,
        },
        400,
      )
    }

    return jsonResponse(
      { error: `No se pudo invitar a ${emailFundador}: ${inviteError?.message}` },
      502,
    )
  }

  const { error: membresiaError } = await admin.from('usuarios_organizacion').insert({
    user_id: invitado.user.id,
    organizacion_id: organizacion.id,
    rol_id: 'administrador',
  })

  if (membresiaError) {
    await admin.from('organizaciones').delete().eq('id', organizacion.id)
    return jsonResponse(
      { error: `No se pudo vincular al fundador como administrador: ${membresiaError.message}` },
      400,
    )
  }

  return jsonResponse({ organizacion_id: organizacion.id, invitado: emailFundador }, 201)
})
