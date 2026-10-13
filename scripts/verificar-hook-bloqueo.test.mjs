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
    new RegExp(`create or replace function ${esquema}\\.${funcion}\\(event jsonb\\)\\s+returns jsonb`),
    `${esquema}.${funcion}(event jsonb) returns jsonb no existe en las migraciones`,
  )
  assert.match(
    migraciones,
    new RegExp(`grant execute on function ${esquema}\\.${funcion}\\(jsonb\\) to supabase_auth_admin`),
    'supabase_auth_admin debe poder ejecutar el hook',
  )
})
