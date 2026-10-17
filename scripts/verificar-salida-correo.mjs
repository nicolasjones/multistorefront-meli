// Verificación de salida del correo de «Solicitar acceso» (F-ROL-05, FR-012, SC-004). Manual y opt-in:
// NO corre en `pnpm test` ni en el CI. Usa el flujo real: inicia sesión como una persona SIN acceso a
// la sección, invoca la Edge Function `solicitar-acceso` y, si hay MAILPIT_URL, comprueba que el
// mensaje llegó a Mailpit (local). En el servidor self-hosted no hay Mailpit: el aviso llega a los
// administradores de la organización, así que para probar la salida hacia afuera el administrador de
// la organización de prueba debe tener como correo CORREO_PRUEBA (nicolas.m.jones@gmail.com) y se
// confirma a mano que el mensaje llegó a esa casilla (evidencia en el PR).
//
// Variables (nunca se commitean valores reales):
//   AUTH_URL        base de Supabase Auth, p. ej. http://127.0.0.1:9300/auth/v1
//   FUNCTIONS_URL   base de Edge Functions, p. ej. http://127.0.0.1:9300/functions/v1
//   SUPABASE_ANON_KEY, ACCESO_EMAIL, ACCESO_PASSWORD   credenciales de la persona sin acceso
//   SECCION         clave de la sección sin acceso para esa persona (por omisión «rentabilidad»)
//   MAILPIT_URL     opcional (local), p. ej. http://127.0.0.1:4302
//   CORREO_PRUEBA   opcional: solo se imprime como recordatorio del destinatario esperado
const requerida = (nombre) => {
  const valor = process.env[nombre]
  if (!valor) {
    console.error(`Falta la variable ${nombre}.`)
    process.exit(2)
  }
  return valor
}

const authUrl = requerida('AUTH_URL').replace(/\/$/, '')
const functionsUrl = requerida('FUNCTIONS_URL').replace(/\/$/, '')
const anonKey = requerida('SUPABASE_ANON_KEY')
const seccion = process.env.SECCION ?? 'rentabilidad'
const mailpit = process.env.MAILPIT_URL?.replace(/\/$/, '')

const login = await fetch(`${authUrl}/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: requerida('ACCESO_EMAIL'), password: requerida('ACCESO_PASSWORD') }),
})
if (!login.ok) {
  console.error(`No se pudo iniciar sesión (HTTP ${login.status}).`)
  process.exit(1)
}
const { access_token: token } = await login.json()

const inicio = Date.now()
const respuesta = await fetch(`${functionsUrl}/solicitar-acceso`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ seccion }),
})
const cuerpo = await respuesta.json().catch(() => null)
console.log(`solicitar-acceso → HTTP ${respuesta.status}`, JSON.stringify(cuerpo))
if (!respuesta.ok) process.exit(1)
if (cuerpo?.resultado === 'sin_administradores') {
  console.error('La organización no tiene administrador activo: no hay a quién enviar.')
  process.exit(1)
}

if (!mailpit) {
  console.log(`Sin MAILPIT_URL: confirmá a mano que el aviso llegó a ${process.env.CORREO_PRUEBA ?? 'la casilla de prueba'} y adjuntá la evidencia al PR.`)
  process.exit(0)
}

// Mailpit puede tardar un instante en indexar el mensaje.
for (let intento = 0; intento < 10; intento += 1) {
  const lista = await fetch(`${mailpit}/api/v1/messages`).then((r) => r.json()).catch(() => null)
  const mensaje = (lista?.messages ?? []).find((m) => /Solicitud de acceso/.test(m.Subject ?? '') && Date.parse(m.Created) >= inicio - 5000)
  if (mensaje) {
    console.log(`OK: el correo «${mensaje.Subject}» llegó a Mailpit para ${(mensaje.To ?? []).map((t) => t.Address).join(', ')}.`)
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
console.error('El correo no apareció en Mailpit.')
process.exit(1)
