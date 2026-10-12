import { createTheme, type Theme } from '@mui/material'

// Contrato de la identidad visual de una empresa para su tienda pública
// (FR-007). Su configuración vive en Empresa · Identidad visual (otra épica);
// acá solo se define cómo se convierte en tema.
export type IdentidadTienda = {
  tipografiaTitulos: string
  tipografiaTexto: string
  colorPrimario: string
  colorTexto: string
  colorFondo: string
}

const FALLBACK_SISTEMA = 'system-ui, -apple-system, "Segoe UI", sans-serif'

// Tema por defecto cuando la empresa no configuró identidad. Deliberadamente
// neutro y distinto del tema del panel.
export const IDENTIDAD_TIENDA_POR_DEFECTO: IdentidadTienda = {
  tipografiaTitulos: 'system-ui',
  tipografiaTexto: 'system-ui',
  colorPrimario: '#222222',
  colorTexto: '#1A1A1A',
  colorFondo: '#FFFFFF',
}

// Identidades de ejemplo para validar el mecanismo; no son datos de negocio.
export const IDENTIDADES_EJEMPLO = {
  mundoJc: {
    tipografiaTitulos: 'Barlow Condensed',
    tipografiaTexto: 'Barlow',
    colorPrimario: '#C8102E',
    colorTexto: '#1A1A1A',
    colorFondo: '#FFFFFF',
  },
  sanJavucho: {
    tipografiaTitulos: 'Playfair Display',
    tipografiaTexto: 'Lato',
    colorPrimario: '#2E6B3F',
    colorTexto: '#22281F',
    colorFondo: '#FAF7F0',
  },
} satisfies Record<string, IdentidadTienda>

// La identidad llegará desde BD (otra épica): se valida antes de llegar al CSS
// para que un valor mal formado o malicioso no inyecte estilos.
const COLOR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const NOMBRE_TIPOGRAFIA = /^[\p{L}\p{N} _-]{1,60}$/u

function valido<K extends keyof IdentidadTienda>(clave: K, valor: unknown): IdentidadTienda[K] {
  const defecto = IDENTIDAD_TIENDA_POR_DEFECTO[clave]
  if (typeof valor !== 'string') return defecto
  const v = valor.trim()
  const ok = clave.startsWith('tipografia') ? NOMBRE_TIPOGRAFIA.test(v) : COLOR_HEX.test(v)
  return ok ? v : defecto
}

const pila = (tipografia: string) => `"${tipografia}", ${FALLBACK_SISTEMA}`

// Una identidad parcial, ausente o inválida se completa con el tema por defecto, para
// que una tienda sin configurar nunca se rompa.
export function crearTemaTienda(identidad?: Partial<IdentidadTienda> | null): Theme {
  const i: IdentidadTienda = {
    tipografiaTitulos: valido('tipografiaTitulos', identidad?.tipografiaTitulos),
    tipografiaTexto: valido('tipografiaTexto', identidad?.tipografiaTexto),
    colorPrimario: valido('colorPrimario', identidad?.colorPrimario),
    colorTexto: valido('colorTexto', identidad?.colorTexto),
    colorFondo: valido('colorFondo', identidad?.colorFondo),
  }
  const titulos = { fontFamily: pila(i.tipografiaTitulos) }
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: i.colorPrimario },
      text: { primary: i.colorTexto },
      background: { default: i.colorFondo, paper: i.colorFondo },
    },
    typography: {
      fontFamily: pila(i.tipografiaTexto),
      h1: titulos, h2: titulos, h3: titulos, h4: titulos, h5: titulos, h6: titulos,
    },
  })
}
