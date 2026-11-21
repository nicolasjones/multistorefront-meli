import { describe, expect, it } from 'vitest'
import { preconnectSupabase } from './vite.config'

// FR-047 / SC-009 (MSF-560): la API y el Storage de la tienda están en otro origen. La
// preconexión se inyecta en el build (y no como `%VITE_SUPABASE_URL%` en `index.html`) porque, sin
// la variable en el entorno, Vite deja el marcador literal en el HTML y el navegador pediría esa
// dirección inexistente.
describe('preconexión al origen de la API en el build (FR-047)', () => {
  it('con la URL del entorno, inyecta el enlace de preconexión', () => {
    const etiquetas = preconnectSupabase('https://api.ejemplo.com').transformIndexHtml('<html></html>')
    expect(etiquetas).toMatchObject({
      tags: [{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://api.ejemplo.com' }, injectTo: 'head-prepend' }],
    })
  })

  it('sin la URL del entorno, no inyecta nada (no queda un marcador literal)', () => {
    expect(preconnectSupabase('').transformIndexHtml('<html></html>')).toBe('<html></html>')
  })
})
