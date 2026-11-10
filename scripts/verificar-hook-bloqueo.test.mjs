// MSF-470 (T022): el Auth Hook de bloqueo solo protege si el URI de config.toml
// apunta a una función que existe con la firma que espera GoTrue. Sin Docker,
// este chequeo estático evita que un renombre deje el bloqueo server-side inactivo.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const config = readFileSync('supabase/config.toml', 'utf8')
const migraciones = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n')

test('el hook password_verification_attempt está activo y apunta a una función existente', () => {
  const bloque = config.match(/^\[auth\.hook\.password_verification_attempt\]\n([^[]*)/m)?.[1]
  assert.ok(bloque, 'falta [auth.hook.password_verification_attempt] en config.toml')
  assert.match(bloque, /^enabled\s*=\s*true\s*$/m)
  const uri = bloque.match(/^uri\s*=\s*"pg-functions:\/\/postgres\/([^/"]+)\/([^/"]+)"\s*$/m)
  assert.ok(uri, 'el uri debe ser pg-functions://postgres/<esquema>/<función>')
  const [, esquema, funcion] = uri
  assert.match(
    migraciones,
    new RegExp(`create or replace function ${esquema}\\.${funcion}\\s*\\(\\s*event\\s+jsonb\\s*\\)\\s+returns\\s+jsonb`),
    `${esquema}.${funcion}(event jsonb) returns jsonb no existe en las migraciones`,
  )
  assert.match(
    migraciones,
    new RegExp(`grant execute on function ${esquema}\\.${funcion}\\(jsonb\\) to supabase_auth_admin`),
    'supabase_auth_admin debe poder ejecutar el hook',
  )
})

test('el mensaje de rechazo del hook es el mismo que muestra el cliente', () => {
  const cliente = readFileSync('apps/web/src/providers/authProvider.ts', 'utf8')
  const textoCliente = cliente.match(/mensajeIngresoBloqueado =\s*'([^']+)'/)?.[1]
  assert.ok(textoCliente, 'no se encontró mensajeIngresoBloqueado en authProvider.ts')
  assert.ok(
    migraciones.includes(`'message', '${textoCliente}'`),
    'el mensaje del hook en SQL difiere de authProvider.mensajeIngresoBloqueado',
  )
})

// F-CLI-06 (MSF-428, FR-025): el bloqueo por intentos alcanza al correo de una cuenta web del cliente SIN cambios.
// La cuenta web es un usuario de Auth sin fila en `usuarios_organizacion`; el hook debe depender solo del correo
// del usuario de Auth (no de ser miembro del panel ni de tener cuenta web), así que un cambio que lo condicione a
// una de esas tablas dejaría la cuenta web sin bloqueo y este test lo detecta.
test('el hook de bloqueo se resuelve por el correo de auth.users, sin depender de membresía ni de cuenta web', () => {
  const inicio = migraciones.indexOf('create or replace function public.verificar_intento_acceso')
  assert.ok(inicio >= 0, 'no se encontró public.verificar_intento_acceso')
  const cuerpo = migraciones.slice(inicio).split(/\n\$\$;/)[0]
  assert.match(cuerpo, /from auth\.users/, 'el hook debe resolver el correo desde auth.users')
  assert.doesNotMatch(cuerpo, /usuarios_organizacion|cuentas_cliente|clientes/, 'el hook no puede condicionarse a membresía ni a cuenta web')
})

test('la tienda de la cuenta web ingresa por el mismo endpoint de Auth (signInWithPassword) que el hook protege', () => {
  const tienda = readFileSync('apps/web/src/lib/tiendaCuenta.ts', 'utf8')
  assert.match(tienda, /supabaseClient\.auth\.signInWithPassword/, 'el ingreso del cliente debe pasar por /auth/v1/token (hook)')
  assert.doesNotMatch(tienda, /rpc\(['"]verificar_intento_acceso/, 'el cliente no debe saltarse ni reimplementar el hook')
})
