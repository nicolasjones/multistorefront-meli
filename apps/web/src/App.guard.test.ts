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

// La importación del historial es solo de administradores: la ruta lo exige antes de montar la pantalla.
// Quita comentarios de bloque (`/* */`, `{/* */}`) y de línea para que el texto de un comentario no cuente como código.
// Recorre el texto carácter a carácter y respeta las cadenas ('...', "...", `...`): un `//` dentro de una cadena (una URL,
// un path) NO es un comentario. El texto JSX suelto no se trata como cadena (un apóstrofo en un párrafo no abre una).
function sinComentarios(texto: string): string {
  let salida = ''
  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    const siguiente = texto[i + 1]
    if (c === '/' && siguiente === '*') {
      const fin = texto.indexOf('*/', i + 2)
      i = fin === -1 ? texto.length : fin + 2
    } else if (c === '/' && siguiente === '/') {
      const fin = texto.indexOf('\n', i)
      i = fin === -1 ? texto.length : fin
    } else if ((c === '"' || c === "'" || c === '`') && !/\w/.test(texto[i - 1] ?? '')) {
      // Una comilla pegada a una letra («l'x», «don't») es texto JSX (un apóstrofo), no abre una cadena.
      let j = i + 1
      while (j < texto.length && texto[j] !== c && !(c !== '`' && texto[j] === '\n')) j += texto[j] === '\\' ? 2 : 1
      if (texto[j] !== c && c !== '`') {
        // Sin cierre en la misma línea no es una cadena: la comilla es un carácter común y el resto de la línea se sigue analizando.
        salida += c
        i++
        continue
      }
      salida += texto.slice(i, j + 1)
      i = j + 1
    } else {
      salida += c
      i++
    }
  }
  return salida
}

describe('sinComentarios (helper de esta guarda)', () => {
  it('un apóstrofo en texto JSX no oculta un comentario posterior de la misma línea', () => {
    expect(sinComentarios("<p>No hay l'x</p> // <Route path=\"/oculta\" />")).toBe('<p>No hay l\'x</p> ')
    expect(sinComentarios("<p>Don't</p> {/* <Route /> */}")).toBe('<p>Don\'t</p> {}')
    expect(sinComentarios("<p>Hay un ' suelto</p> // comentario\n<b/>")).toBe("<p>Hay un ' suelto</p> \n<b/>")
  })
  it('una URL dentro de una cadena no es un comentario', () => {
    expect(sinComentarios("const u = 'https://x.test/a' // nota")).toBe("const u = 'https://x.test/a' ")
    expect(sinComentarios('const u = "http://x" /* c */ + `//y`')).toBe('const u = "http://x"  + `//y`')
  })
})

describe('rutas solo de administradores', () => {
  it('/historial/importar se envuelve en RequiereAdministrador', () => {
    const bloque = sinComentarios(app).split(/<Route\b/).find((trozo) => /^\s+path="\/historial\/importar"/.test(trozo))
    expect(bloque).toBeDefined()
    expect(bloque).toContain('<RequiereAdministrador')
  })

  it.each(['/empresas', '/empresas/edit/:id'])('%s se envuelve en RequiereAccesoSeccion de «empresas»', (ruta) => {
    const bloque = sinComentarios(app).split(/<Route\b/).find((trozo) => trozo.trimStart().startsWith(`path="${ruta}"`))
    expect(bloque).toBeDefined()
    expect(bloque).toContain('<RequiereAccesoSeccion seccion="empresas">')
  })

  it('/stock/motivos se envuelve en RequiereAdministrador', () => {
    const bloque = sinComentarios(app).split(/<Route\b/).find((trozo) => /^\s+path="\/stock\/motivos"/.test(trozo))
    expect(bloque).toBeDefined()
    expect(bloque).toContain('<RequiereAdministrador')
  })

  it('un comentario con el nombre del guard no engaña al chequeo', () => {
    const falso = '<Route path="/x" element={<A />} />{/* <RequiereAdministrador> */}\n  // <RequiereAdministrador>'
    expect(sinComentarios(falso)).not.toContain('RequiereAdministrador')
  })

  it('un // dentro de una cadena no se toma por comentario y lo que sigue se conserva', () => {
    const codigo = '<Route path="/x" element={<A href="https://example.com/a" />}>\n<RequiereAdministrador />\n</Route> // nota'
    const limpio = sinComentarios(codigo)
    expect(limpio).toContain('https://example.com/a')
    expect(limpio).toContain('<RequiereAdministrador />')
    expect(limpio).not.toContain('nota')
    // Un guard después de una cadena con // en la misma línea sigue contando.
    expect(sinComentarios("const u = 'a //b'; <RequiereAdministrador>")).toContain('RequiereAdministrador')
    expect(sinComentarios('/* <RequiereAdministrador> */ ok')).not.toContain('RequiereAdministrador')
  })
})
