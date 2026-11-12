import { describe, expect, it } from 'vitest'
import { decodificarEntidades, limpiarDescripcionPublica, limpiarTextoPublico, limpiarTextoPublicoOpcional, quitarPrefijoImportacion } from './tiendaTextos'

describe('quitarPrefijoImportacion (MSF-828)', () => {
  it.each([
    ['&ua ADAPTADOR HDMI A DVI 24+1 (3010)', 'ADAPTADOR HDMI A DVI 24+1 (3010)'],
    ['&uu BOTÓN', 'BOTÓN'],
    ['&u+ MOCHILA', 'MOCHILA'],
    ['&+ COOLER PS2 70X', 'COOLER PS2 70X'],
    ['&u++ KIT', 'KIT'],
    ['&uaCONSOLA', 'CONSOLA'],
    ['& CABLE', 'CABLE'],
    ['Joystick Pro', 'Joystick Pro'],
    ['Cables &ua', 'Cables &ua'],
  ])('%s → %s', (entrada, salida) => {
    expect(quitarPrefijoImportacion(entrada)).toBe(salida)
  })

  it('no vacía un nombre que es solo el prefijo y respeta las entidades HTML', () => {
    expect(quitarPrefijoImportacion('&ua')).toBe('&ua')
    expect(quitarPrefijoImportacion('&amp; Compañía')).toBe('&amp; Compañía')
  })
})

describe('decodificarEntidades', () => {
  it('decodifica las comunes y deja literal lo desconocido', () => {
    expect(decodificarEntidades('Tom &amp; Jerry &#39;x&#39; &#x41; &uacute;til &raro;')).toBe("Tom & Jerry 'x' A útil &raro;")
  })
  it('un código fuera de rango queda literal', () => {
    expect(decodificarEntidades('&#99999999;')).toBe('&#99999999;')
  })
})

describe('limpiarTextoPublico', () => {
  it('quita el prefijo, decodifica y compacta espacios', () => {
    expect(limpiarTextoPublico('&ua  CABLE   HDMI &amp; VGA ')).toBe('CABLE HDMI & VGA')
  })
  it('la versión opcional devuelve null con vacío o null', () => {
    expect(limpiarTextoPublicoOpcional(null)).toBeNull()
    expect(limpiarTextoPublicoOpcional('   ')).toBeNull()
    expect(limpiarTextoPublicoOpcional('&ua DESCRIPCIÓN')).toBe('DESCRIPCIÓN')
  })
})

describe('limpiarDescripcionPublica', () => {
  it('respeta los saltos de línea', () => {
    expect(limpiarDescripcionPublica('&ua Línea 1\nLínea 2 &amp; más')).toBe('Línea 1\nLínea 2 & más')
    expect(limpiarDescripcionPublica(null)).toBeNull()
    expect(limpiarDescripcionPublica('  ')).toBeNull()
  })
})
