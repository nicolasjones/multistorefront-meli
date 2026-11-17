import { describe, expect, it } from 'vitest'
import { normalizarBusqueda } from './busquedaTexto'

describe('normalización del texto de búsqueda', () => {
  it('pasa a minúsculas y quita las tildes', () => {
    expect(normalizarBusqueda('Cámara ÓPTICA')).toBe('camara optica')
  })

  it('la eñe se reduce a «n», igual que la columna calculada de la base', () => {
    expect(normalizarBusqueda('Pestaña')).toBe('pestana')
    expect(normalizarBusqueda('ÑANDÚ')).toBe('nandu')
  })

  it('quita diéresis y otras marcas combinadas', () => {
    expect(normalizarBusqueda('Pingüino Ångström')).toBe('pinguino angstrom')
  })

  it('colapsa espacios, tabulaciones y saltos de línea en un único espacio', () => {
    expect(normalizarBusqueda('cable   usb\t\tc\n3m')).toBe('cable usb c 3m')
  })

  it('no recorta los extremos: deja un espacio si había espacios', () => {
    expect(normalizarBusqueda('  hola  ')).toBe(' hola ')
  })

  it('el texto vacío o sin letras se mantiene', () => {
    expect(normalizarBusqueda('')).toBe('')
    expect(normalizarBusqueda('1234-AB/9')).toBe('1234-ab/9')
  })

  it('es idempotente', () => {
    const una = normalizarBusqueda('  ÁRBOL   Ñu ')
    expect(normalizarBusqueda(una)).toBe(una)
  })

  it('el texto con tildes en forma compuesta o descompuesta da el mismo resultado', () => {
    expect(normalizarBusqueda('Café')).toBe(normalizarBusqueda('Café'))
  })
})
