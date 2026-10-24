import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Guarda estática de la cuenta web del cliente (F-CLI-05, FR-007): no hay auto-registro. Las cuentas se crean solo
// por invitación desde el panel (D2), así que `enable_signup` sigue en `false` y la tienda no expone ruta de registro.
// Vitest corre con cwd en `apps/web`; no se usa import.meta.url porque en jsdom es una URL http.
const RAIZ = resolve(process.cwd(), '../..')

// Contenido de una sección de `config.toml` (hasta el siguiente encabezado `[...]`).
function seccion(toml: string, nombre: string): string {
  const inicio = toml.search(new RegExp(`^\\[${nombre.replace('.', '\\.')}\\]\\s*$`, 'm'))
  expect(inicio, `falta la sección [${nombre}] en supabase/config.toml`).toBeGreaterThanOrEqual(0)
  const resto = toml.slice(inicio).split('\n').slice(1)
  const fin = resto.findIndex((linea) => /^\[/.test(linea))
  return (fin === -1 ? resto : resto.slice(0, fin)).join('\n')
}

describe('configuración de Auth · sin auto-registro (FR-007)', () => {
  const toml = readFileSync(resolve(RAIZ, 'supabase/config.toml'), 'utf8')

  it('`enable_signup` global sigue en false', () => {
    expect(seccion(toml, 'auth')).toMatch(/^enable_signup\s*=\s*false\s*(#.*)?$/m)
  })

  it('la tienda pública no expone ninguna ruta de registro', () => {
    const carpeta = resolve(process.cwd(), 'src/pages/tienda-publica/rutas')
    expect(existsSync(carpeta)).toBe(true)
    const prohibidas = readdirSync(carpeta).filter((archivo) => /registr|signup|sign-up|crear-cuenta|alta/i.test(archivo))
    expect(prohibidas).toEqual([])
  })
})
