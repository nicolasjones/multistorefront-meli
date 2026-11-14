// Verificación de salida del correo de «Solicitar acceso» (F-ROL-05, FR-012, SC-004). Manual y opt-in:
// NO corre en `pnpm test` ni en el CI. Usa el flujo real: inicia sesión como una persona SIN acceso a
// la sección, invoca la Edge Function `solicitar-acceso` y, si hay MAILPIT_URL, comprueba que el
// mensaje llegó a Mailpit (local). En el servidor self-hosted no hay Mailpit: el aviso llega a los
// administradores de la organización, así que para probar la salida hacia afuera el administrador de
// la organización de prueba debe tener como correo CORREO_PRUEBA (nicolas.m.jones@gmail.com) y se
// confirma a mano que el mensaje llegó a esa casilla (evidencia en el PR).
//
// Códigos de salida (un 0 SÍ significa «verificado por la máquina»):
//   0 = verificado: el mensaje llegó a Mailpit.
//   1 = la corrida no produjo un aviso nuevo (falló el flujo, no hay administrador, o el pedido del día
//       ya estaba notificado y el flujo es idempotente).
//   2 = uso incorrecto: falta una variable de entorno.
//   3 = el aviso salió del flujo (el SMTP lo aceptó), pero la ENTREGA no se puede verificar desde el
//       servidor: queda pendiente la confirmación manual (captura) y el registro en
//       `docs/verificacion-salida-correo.md`.
//
// Variables (nunca se commitean valores reales):
//   AUTH_URL        base de Supabase Auth, p. ej. http://127.0.0.1:9300/auth/v1
//   FUNCTIONS_URL   base de Edge Functions, p. ej. http://127.0.0.1:9300/functions/v1
//   SUPABASE_ANON_KEY, ACCESO_EMAIL, ACCESO_PASSWORD   credenciales de la persona sin acceso
//   SECCION         clave de la sección sin acceso para esa persona (por omisión «rentabilidad»)
//   MAILPIT_URL     opcional (local), p. ej. http://127.0.0.1:4302
//   CORREO_PRUEBA   obligatoria sin MAILPIT_URL: es la casilla externa donde se confirma la recepción
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
// Sin Mailpit no hay forma de verificar la entrega desde el servidor: la casilla de la prueba es
// obligatoria, porque es donde el aviso tiene que llegar.
const correoPrueba = process.env.CORREO_PRUEBA?.trim()
if (!mailpit && !correoPrueba) {
  console.error('Falta la variable CORREO_PRUEBA: sin MAILPIT_URL el guion necesita saber a qué casilla externa debe llegar el aviso.')
  process.exit(2)
}

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
if (cuerpo?.resultado !== 'solicitud_enviada') {
  console.error(`La función no confirmó el envío (respuesta inesperada: ${JSON.stringify(cuerpo)}).`)
  process.exit(1)
}

// Contrato de la respuesta: `{resultado, nuevo}` (pinnado en
// `supabase/functions/solicitar-acceso/handler.test.ts`). «nuevo» true significa que el pedido del día se
// creó en esta corrida, así que el aviso salió ahora. Con «nuevo» false el pedido ya existía (el flujo es
// idempotente por día) y no se puede asegurar que esta corrida enviara un aviso nuevo.
const avisoNuevo = cuerpo.nuevo === true

if (mailpit) {
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
  console.error('El correo no apareció en Mailpit: esta corrida no produjo un aviso nuevo.')
  if (!avisoNuevo) {
    console.error('El pedido del día ya estaba registrado (idempotencia): repetí con otra SECCION o con otra persona sin acceso para que el pedido sea nuevo.')
  }
  process.exit(1)
}

if (!avisoNuevo) {
  console.error('La corrida no confirmó un aviso nuevo: el pedido del día ya estaba registrado (idempotencia), así que la respuesta no deja saber si esta corrida volvió a avisar.')
  console.error('Repetí con otra SECCION o con otra persona sin acceso para que el pedido sea nuevo.')
  process.exit(1)
}
console.log('El aviso salió del flujo: el SMTP del servidor lo aceptó.')
console.log(`Destinatario real: los administradores activos de la organización (la casilla de prueba es ${correoPrueba}).`)
console.log('VERIFICACIÓN MANUAL PENDIENTE: esto NO es evidencia de que el correo haya llegado.')
console.log(`Confirmá a mano que el aviso llegó a ${correoPrueba}, guardá la captura y completá el registro en docs/verificacion-salida-correo.md.`)
process.exit(3)
