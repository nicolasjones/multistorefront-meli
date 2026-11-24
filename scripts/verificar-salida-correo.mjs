// Verificación de salida del correo de «Solicitar acceso» (F-ROL-05, FR-012, SC-004). Manual y opt-in:
// NO corre en `pnpm test` ni en el CI. Usa el flujo real: inicia sesión como una persona SIN acceso a
// la sección, invoca la Edge Function `solicitar-acceso` y, si hay MAILPIT_URL, comprueba que el
// mensaje llegó a Mailpit (local). En el servidor self-hosted no hay Mailpit: el aviso llega a los
// administradores de la organización, así que para probar la salida hacia afuera el administrador de
// la organización de prueba debe tener como correo CORREO_PRUEBA (nicolas.m.jones@gmail.com) y se
// confirma a mano que el mensaje llegó a esa casilla (evidencia en el PR).
//
// Códigos de salida (la definición completa, con el detalle de cada caso, está en
// `docs/verificacion-salida-correo.md`; un `0` SÍ significa «verificado por la máquina»):
//   0 = verificado por la máquina: el aviso de ESTA corrida llegó a Mailpit.
//   1 = esta corrida NO envió ningún aviso.
//   2 = uso incorrecto: falta una variable de entorno.
//   3 = esta corrida envió el aviso y el SMTP lo aceptó; la ENTREGA se confirma a mano.
//
// Variables (nunca se commitean valores reales):
//   AUTH_URL        base de Supabase Auth, p. ej. http://127.0.0.1:9300/auth/v1
//   FUNCTIONS_URL   base de Edge Functions, p. ej. http://127.0.0.1:9300/functions/v1
//   SUPABASE_ANON_KEY, ACCESO_EMAIL, ACCESO_PASSWORD   credenciales de la persona sin acceso
//   SECCION         clave de la sección sin acceso para esa persona (por omisión «rentabilidad»)
//   MAILPIT_URL     opcional (local), p. ej. http://127.0.0.1:4302
//   MAILPIT_TIMEOUT_MS  opcional: tope de cada consulta a Mailpit (por omisión 5000 ms, máximo 60000 ms; un valor no
//                   finito o no positivo cae al por omisión y uno mayor al máximo se acota); una consulta que no
//                   responde cuenta como «el aviso aún no apareció» en vez de dejar el guion colgado
//   CORREO_PRUEBA   obligatoria sin MAILPIT_URL: es la casilla externa donde se confirma la recepción; con MAILPIT_URL, si
//                   se define, el mensaje de Mailpit tiene que estar dirigido a esa casilla (si no, no hay verde)
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
// Tope de cada consulta a Mailpit: sin él, un Mailpit que acepta la conexión y no contesta cuelga el guion.
// Un valor no finito (`Infinity`, `NaN`), vacío o no positivo cae al valor por omisión: `AbortSignal.timeout(Infinity)` lanza
// TypeError. Un valor enorme se acota a TOPE_MAXIMO_MAILPIT_MS para que una consulta nunca pueda colgar el guion.
const TOPE_POR_OMISION_MAILPIT_MS = 5000
const TOPE_MAXIMO_MAILPIT_MS = 60000
const topeSolicitado = Number(process.env.MAILPIT_TIMEOUT_MS)
const topeMailpitMs = Number.isFinite(topeSolicitado) && topeSolicitado > 0
  ? Math.min(topeSolicitado, TOPE_MAXIMO_MAILPIT_MS)
  : TOPE_POR_OMISION_MAILPIT_MS
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

// Contrato de la respuesta: `{resultado, nuevo, enviado}` (pinnado en
// `supabase/functions/solicitar-acceso/handler.test.ts`).
//   `nuevo`   → el pedido del día se creó en esta corrida.
//   `enviado` → ESTA corrida envió el aviso y el SMTP lo aceptó.
// Con `enviado: false` esta corrida NO mandó nada: el aviso ya había salido hoy o lo está mandando otra
// invocación. Por eso `enviado` es el que decide: un «Solicitud de acceso» en Mailpit o un `nuevo: true`
// NO prueban que esta corrida haya enviado nada.
if (typeof cuerpo.enviado !== 'boolean') {
  console.error('La respuesta de `solicitar-acceso` no dice si esta corrida envió el aviso (`enviado`): actualizá la Edge Function en el servidor y volvé a correr.')
  process.exit(1)
}
if (!cuerpo.enviado) {
  if (cuerpo.nuevo) {
    console.error('Esta corrida NO envió el aviso: otra invocación ganó el reclamo del envío y está avisando.')
    console.error('Esperá a que termine y volvé a correr.')
  } else {
    console.error('Esta corrida NO envió el aviso: el pedido del día ya estaba notificado (idempotencia).')
    console.error('Repetí con otra SECCION o con otra persona sin acceso para que el pedido sea nuevo.')
  }
  process.exit(1)
}

if (mailpit) {
  // Mailpit puede tardar un instante en indexar el mensaje.
  for (let intento = 0; intento < 10; intento += 1) {
    const lista = await fetch(`${mailpit}/api/v1/messages`, { signal: AbortSignal.timeout(topeMailpitMs) }).then((r) => r.json()).catch(() => null)
    // Si hay CORREO_PRUEBA, el aviso tiene que ir a esa casilla: un «Solicitud de acceso» para otra persona no es evidencia.
    const paraLaCasilla = (m) => !correoPrueba || (m.To ?? []).some((t) => (t.Address ?? '').toLowerCase() === correoPrueba.toLowerCase())
    const mensaje = (lista?.messages ?? []).find((m) => /Solicitud de acceso/.test(m.Subject ?? '') && Date.parse(m.Created) >= inicio - 5000 && paraLaCasilla(m))
    if (mensaje) {
      console.log(`OK: el correo «${mensaje.Subject}» llegó a Mailpit para ${(mensaje.To ?? []).map((t) => t.Address).join(', ')}.`)
      process.exit(0)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error('El correo no apareció en Mailpit: esta corrida no produjo un aviso en Mailpit.')
  process.exit(1)
}

if (!cuerpo.nuevo) {
  console.log('El pedido del día ya estaba registrado, pero esta corrida sí envió el aviso (reintento de un envío que había fallado).')
}
console.log('El aviso salió del flujo: el SMTP del servidor lo aceptó.')
console.log(`Destinatario real: los administradores activos de la organización (la casilla de prueba es ${correoPrueba}).`)
console.log('VERIFICACIÓN MANUAL PENDIENTE: esto NO es evidencia de que el correo haya llegado.')
console.log(`Confirmá a mano que el aviso llegó a ${correoPrueba}, guardá la captura y completá el registro en docs/verificacion-salida-correo.md.`)
process.exit(3)
