import { describe, expect, it } from 'vitest'
import app from './App.tsx?raw'
import { DESTINOS_PANEL } from './components/navegacion/destinosPanel'

// `inicio` (ruta "/") queda fuera a propósito: es la pantalla a la que se
// redirige a quien no tiene acceso, así que envolverla produciría un bucle.
const SIN_GUARD = new Set(['inicio'])

// Convención F-ROL-03 (docs/permisos-por-rol.md): toda ruta de una sección con
// `seccionPermiso` se envuelve en RequiereAccesoSeccion. Este test la hace valer.
describe('guard de rutas por sección (F-ROL-03)', () => {
  // Cada bloque va desde un `<Route` hasta el siguiente, sin depender del
  // formato (una línea o varias) ni de lo que siga a la ruta.
  const rutas = app
    .split(/<Route\b/)
    .slice(1)
    .flatMap((bloque) => {
      const ruta = /^\s+path="([^"]+)"/.exec(bloque)?.[1]
      return ruta ? [[bloque, ruta] as const] : []
    })

  const destinos = DESTINOS_PANEL.filter((d) => d.seccionPermiso && !SIN_GUARD.has(d.id))

  it.each(destinos.map((d) => [d.id, d] as const))('las rutas de %s están guardadas', (_id, destino) => {
    const propias = rutas.filter(([, ruta]) => ruta === destino.ruta || ruta.startsWith(`${destino.ruta}/`))
    expect(propias.length).toBeGreaterThan(0)
    for (const [bloque, ruta] of propias) {
      expect(bloque, `ruta ${ruta}`).toContain(`<RequiereAccesoSeccion seccion="${destino.seccionPermiso}"`)
    }
  })
})

// FR-019: Usuarios absorbe a Miembros; los marcadores y enlaces viejos deben
// seguir llegando a la pantalla nueva en vez de caer en un 404.
describe('rutas heredadas de Miembros (FR-019)', () => {
  it.each([
    ['/miembros', '/usuarios'],
    ['/miembros/create', '/usuarios/create'],
  ])('%s redirige a %s', (origen, destino) => {
    expect(app).toContain(`<Route path="${origen}" element={<Navigate to="${destino}" replace />} />`)
  })
})
