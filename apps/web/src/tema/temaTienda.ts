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
  // Opcionales: la vista previa y los ejemplos antiguos no los traen; se completan con el primario y la barra por defecto.
  colorPrimarioOscuro?: string
  colorAcento?: string
  // Barra superior y pie (MSF-841).
  colorBarra?: string
}

// Colores derivados que usa el front público (MSF-841): se leen con `theme.tienda` (el tema del panel no lo trae).
export type ColoresTienda = {
  primarioOscuro: string
  acento: string
  barra: string
  // Texto sobre la barra y el pie.
  textoBarra: string
  // Fondo de tarjetas y bloques (prototipo: `--sf`), derivado del fondo de la tienda.
  superficie: string
  // Tipografía de títulos (prototipo: `.fh`) para precios y nombres que no son un encabezado.
  fuenteTitulos: string
}

declare module '@mui/material/styles' {
  interface Theme { tienda?: ColoresTienda }
  interface ThemeOptions { tienda?: ColoresTienda }
}

export const COLOR_BARRA_POR_DEFECTO = '#222222'

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

// Mezcla `color` con `con` (0 = color, 1 = con). Ambos #RGB/#RRGGBB ya validados.
function mezclar(color: string, con: string, parte: number): string {
  const canales = (hex: string) => {
    const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1)
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  const [a, b] = [canales(color), canales(con)]
  return `#${a.map((c, i) => Math.round(c * (1 - parte) + b[i] * parte).toString(16).padStart(2, '0')).join('')}`
}

function luminancia(hex: string): number {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

// Texto secundario: el de la tienda atenuado hacia el fondo, pero sin bajar de 4,5:1 (AA) ni sobre el fondo ni sobre
// la superficie de las tarjetas (que es el fondo algo más oscuro). Si ni el atenuado mínimo llega, queda el texto pleno.
function textoSecundario(texto: string, fondo: string, superficie: string): string {
  for (let parte = 0.35; parte > 0; parte -= 0.05) {
    const color = mezclar(texto, fondo, parte)
    if (contraste(color, fondo) >= 4.5 && contraste(color, superficie) >= 4.5) return color
  }
  return texto
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
  const primarioOscuro = COLOR_HEX.test(identidad?.colorPrimarioOscuro?.trim() ?? '') ? identidad!.colorPrimarioOscuro!.trim() : i.colorPrimario
  const acento = COLOR_HEX.test(identidad?.colorAcento?.trim() ?? '') ? identidad!.colorAcento!.trim() : i.colorPrimario
  const barra = COLOR_HEX.test(identidad?.colorBarra?.trim() ?? '') ? identidad!.colorBarra!.trim() : COLOR_BARRA_POR_DEFECTO
  const superficie = mezclar(i.colorFondo, '#000000', 0.043)
  const titulos = { fontFamily: pila(i.tipografiaTitulos) }
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: i.colorPrimario, dark: primarioOscuro },
      secondary: { main: acento },
      text: { primary: i.colorTexto, secondary: textoSecundario(i.colorTexto, i.colorFondo, superficie) },
      background: { default: i.colorFondo, paper: i.colorFondo },
    },
    typography: {
      fontFamily: pila(i.tipografiaTexto),
      h1: titulos, h2: titulos, h3: titulos, h4: titulos, h5: titulos, h6: titulos,
    },
    tienda: { primarioOscuro, acento, barra, textoBarra: '#FFFFFF', superficie, fuenteTitulos: titulos.fontFamily },
  })
}
