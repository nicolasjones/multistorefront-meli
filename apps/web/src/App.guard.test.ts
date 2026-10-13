import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESTINOS_PANEL } from './components/navegacion/destinosPanel'

// `inicio` (ruta "/") queda fuera a propósito: es la pantalla a la que se
// redirige a quien no tiene acceso, así que envolverla produciría un bucle.
const SIN_GUARD = new Set(['inicio'])

// Convención F-ROL-03 (docs/permisos-por-rol.md): toda ruta de una sección con
// `seccionPermiso` se envuelve en RequiereAccesoSeccion. Este test la hace valer.
describe('guard de rutas por sección (F-ROL-03)', () => {
  const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')
  const rutas = [...app.matchAll(/<Route\s+path="([^"]+)"[\s\S]*?\/>\s*(?=<Route|<\/Route|\n\s*<\/)/g)]

  const destinos = DESTINOS_PANEL.filter((d) => d.seccionPermiso && !SIN_GUARD.has(d.id))

  it.each(destinos.map((d) => [d.id, d] as const))('las rutas de %s están guardadas', (_id, destino) => {
    const propias = rutas.filter(([, ruta]) => ruta === destino.ruta || ruta.startsWith(`${destino.ruta}/`))
    expect(propias.length).toBeGreaterThan(0)
    for (const [bloque, ruta] of propias) {
      expect(bloque, `ruta ${ruta}`).toContain(`<RequiereAccesoSeccion seccion="${destino.seccionPermiso}"`)
    }
  })
})
