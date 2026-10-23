import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: {} }))

import {
  contrasteBlancoSobre, esColorValido, evaluarContraste, familiasACargar, formatearContraste, normalizarColor,
  rutaArchivo, svgEsSeguro, tiposAceptados, urlFuentes, validarImagen,
} from './tiendaIdentidad'

const archivo = (nombre: string, tipo: string, bytes: number | string) =>
  new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], nombre, { type: tipo })

describe('contraste del texto blanco sobre el primario (FR-023)', () => {
  it('el negro y el blanco dan los extremos 21:1 y 1:1', () => {
    expect(contrasteBlancoSobre('#000000')).toBeCloseTo(21, 1)
    expect(contrasteBlancoSobre('#FFFFFF')).toBeCloseTo(1, 1)
  })

  it('caso límite AA: #767676 cumple (4,5:1) y #777777 no', () => {
    expect(evaluarContraste('#767676')?.cumpleAA).toBe(true)
    expect(evaluarContraste('#777777')?.cumpleAA).toBe(false)
  })

  it('el texto con AA sigue la redacción del prototipo y sin AA advierte sin bloquear', () => {
    const bueno = evaluarContraste('#A3111D')
    expect(bueno?.texto).toMatch(/^Contraste de texto blanco sobre el primario: \d,\d:1 \(AA\)\.$/)
    const malo = evaluarContraste('#FFEB3B')
    expect(malo?.cumpleAA).toBe(false)
    expect(malo?.texto).toContain('No cumple AA')
    expect(malo?.texto).toContain('Podés guardar igual')
  })

  it('redondea hacia abajo para no mostrar 4,5 cuando no llega', () => {
    expect(formatearContraste(4.46)).toBe('4,4')
    expect(formatearContraste(7.49)).toBe('7,4')
  })

  it('un color inválido no tiene contraste', () => {
    expect(contrasteBlancoSobre('rojo')).toBeNull()
    expect(evaluarContraste('#FFF')).toBeNull()
  })
})

describe('colores (FR-022)', () => {
  it('acepta solo #RRGGBB y normaliza a mayúsculas', () => {
    expect(esColorValido('#a3111d')).toBe(true)
    expect(esColorValido(' #A3111D ')).toBe(true)
    expect(esColorValido('#FFF')).toBe(false)
    expect(esColorValido('A3111D')).toBe(false)
    expect(esColorValido('#GGGGGG')).toBe(false)
    expect(normalizarColor(' #a3111d ')).toBe('#A3111D')
  })
})

describe('SVG seguro (FR-021, SC-005)', () => {
  it('acepta un SVG limpio', () => {
    expect(svgEsSeguro('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>')).toBe(true)
  })

  it.each([
    ['<script>', '<svg><script>alert(1)</script></svg>'],
    ['<SCRIPT con espacio', '<svg>< SCRIPT src="x.js"></svg>'],
    ['onload', '<svg onload="alert(1)"></svg>'],
    ['onclick en un hijo', '<svg><rect width="1" height="1" onclick = "x()"/></svg>'],
    ['href javascript:', '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['<svg/onload=…> (separador /)', '<svg/onload=alert(1)>'],
    ['onload tras comilla sin espacio', '<svg a="1"onload="alert(1)">'],
    ['foreignObject', '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ['href data:', '<svg><a href="data:text/html,<script>1</script>"><text>x</text></a></svg>'],
    ['entidad numérica (ofuscación)', '<svg><a href="jav&#x61;script:alert(1)"><text>x</text></a></svg>'],
    ['DOCTYPE/ENTITY', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'],
    ['referencia externa', '<svg><image href="https://evil.example/x.png"/></svg>'],
    ['animate/set', '<svg><a><set attributeName="href" to="x"/></a></svg>'],
    ['> dentro de un atributo', '<svg a=">" onload="alert(1)">'],
    ['tab dentro del esquema', '<svg><a href="jav\tascript:alert(1)"><text>x</text></a></svg>'],
    ['salto de línea dentro del esquema', '<svg><a href="java\nscript:alert(1)"><text>x</text></a></svg>'],
    ['<style> con @import', '<svg><style>@import "https://evil.example/x.css";</style></svg>'],
    ['<style> con url externa', '<svg><style>rect{fill:url(https://evil.example/x)}</style></svg>'],
  ])('rechaza %s', (_caso, contenido) => {
    expect(svgEsSeguro(contenido)).toBe(false)
  })
})

describe('validación de archivos (FR-021, FR-025, FR-026)', () => {
  it('logo: acepta PNG y SVG limpio; rechaza JPG, y avisa el formato', async () => {
    expect(await validarImagen('logo', archivo('logo.png', 'image/png', 100))).toBeNull()
    expect(await validarImagen('logo', archivo('logo.svg', 'image/svg+xml', '<svg></svg>'))).toBeNull()
    expect(await validarImagen('logo', archivo('logo.jpg', 'image/jpeg', 100))).toMatch(/no es un formato admitido.*PNG o SVG/)
  })

  it('logo: el tope es 1 MB y el mensaje lo dice', async () => {
    expect(await validarImagen('logo', archivo('justo.png', 'image/png', 1024 * 1024))).toBeNull()
    expect(await validarImagen('logo', archivo('grande.png', 'image/png', 1024 * 1024 + 1))).toBe('«grande.png» supera el máximo de 1 MB.')
  })

  it('logo SVG con script o eventos se rechaza con un mensaje claro', async () => {
    const mensaje = await validarImagen('logo', archivo('malo.svg', 'image/svg+xml', '<svg onload="x()"></svg>'))
    expect(mensaje).toContain('contiene código')
  })

  it('banners: PNG, JPG y WebP hasta 3 MB; SVG no se admite', async () => {
    for (const clave of ['banner', 'bannerMovil'] as const) {
      expect(await validarImagen(clave, archivo('b.webp', 'image/webp', 2 * 1024 * 1024))).toBeNull()
      expect(await validarImagen(clave, archivo('b.jpg', 'image/jpeg', 100))).toBeNull()
      expect(await validarImagen(clave, archivo('b.svg', 'image/svg+xml', '<svg></svg>'))).toMatch(/no es un formato admitido.*PNG, JPG o WebP/)
      expect(await validarImagen(clave, archivo('b.png', 'image/png', 3 * 1024 * 1024 + 1))).toBe('«b.png» supera el máximo de 3 MB.')
    }
  })

  it('los tipos aceptados del input coinciden con las reglas', () => {
    expect(tiposAceptados('logo')).toBe('image/png,image/svg+xml')
    expect(tiposAceptados('banner')).toBe('image/png,image/jpeg,image/webp')
  })

  it('la ruta queda en la carpeta <organización>/<empresa>/ con extensión según el tipo', () => {
    const ruta = rutaArchivo('org-1', 'emp-1', 'bannerMovil', archivo('x.jpg', 'image/jpeg', 10))
    expect(ruta).toMatch(/^org-1\/emp-1\/banner-movil-[0-9a-f-]{36}\.jpg$/)
    expect(rutaArchivo('org-1', 'emp-1', 'logo', archivo('x.svg', 'image/svg+xml', 10))).toMatch(/^org-1\/emp-1\/logo-[0-9a-f-]{36}\.svg$/)
  })
})

describe('tipografías (FR-024)', () => {
  it('carga solo las familias de la lista cerrada y omite la del sistema', () => {
    expect(familiasACargar({ tipografiaTitulos: 'Barlow Condensed', tipografiaTexto: 'Barlow' })).toEqual(['Barlow Condensed', 'Barlow'])
    expect(familiasACargar({ tipografiaTitulos: 'system-ui', tipografiaTexto: 'system-ui' })).toEqual([])
    expect(familiasACargar({ tipografiaTitulos: 'Lato', tipografiaTexto: 'Lato' })).toEqual(['Lato'])
  })

  it('arma la URL de fuentes y rechaza lo que no está en la lista', () => {
    expect(urlFuentes(['Barlow Condensed', 'Lato'])).toBe('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Lato:wght@400;500;600;700&display=swap')
    expect(urlFuentes(['x;}body{display:none'])).toBeNull()
    expect(urlFuentes([])).toBeNull()
  })
})
