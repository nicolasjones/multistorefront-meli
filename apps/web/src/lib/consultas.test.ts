import { describe, expect, it } from 'vitest'
import {
  ErrorConsulta,
  esConflicto,
  formatearCuando,
  limitesDeFecha,
  mensajeDeError,
  nombreProducto,
  textoParaBusqueda,
} from './consultas'

describe('textoParaBusqueda (FR-004: filtro `or` de PostgREST, nunca sintaxis del cliente)', () => {
  it('trata comas, paréntesis, comillas, barras y comodines como separadores', () => {
    expect(textoParaBusqueda('  Ana, (Pérez)%_  ')).toBe('Ana Pérez')
    expect(textoParaBusqueda('"x"\\y*z')).toBe('x y z')
  })

  it('sin nada que buscar devuelve cadena vacía', () => {
    expect(textoParaBusqueda('%_,()')).toBe('')
    expect(textoParaBusqueda('   ')).toBe('')
  })
})

describe('limitesDeFecha (FR-006: rango por día local, «hasta» exclusivo)', () => {
  it('desde las 00:00 del primer día hasta las 00:00 del siguiente al último', () => {
    const { desde, hastaExclusivo } = limitesDeFecha('2026-10-01', '2026-10-03')
    expect(new Date(desde!).getTime()).toBe(new Date('2026-10-01T00:00:00').getTime())
    expect(new Date(hastaExclusivo!).getTime()).toBe(new Date('2026-10-04T00:00:00').getTime())
  })

  it('una fecha mal formada se ignora en vez de romper la consulta', () => {
    expect(limitesDeFecha('ayer', '2026-13-99')).toEqual({ desde: null, hastaExclusivo: null })
  })
})

describe('formatearCuando (columna «Cuándo»)', () => {
  const ahora = new Date(2026, 9, 23, 12, 0, 0)

  it('usa Hoy, Ayer y la fecha corta', () => {
    expect(formatearCuando(new Date(2026, 9, 23, 11, 48).toISOString(), ahora)).toBe('Hoy 11:48')
    expect(formatearCuando(new Date(2026, 9, 22, 19, 30).toISOString(), ahora)).toBe('Ayer 19:30')
    expect(formatearCuando(new Date(2026, 8, 26, 16, 40).toISOString(), ahora)).toBe('26/09 16:40')
    expect(formatearCuando(new Date(2025, 8, 26, 16, 40).toISOString(), ahora)).toBe('26/09/2025 16:40')
  })

  it('una fecha inválida no rompe la celda', () => {
    expect(formatearCuando('no-es-fecha', ahora)).toBe('—')
  })
})

describe('errores de las RPC (FR-003 y FR-007)', () => {
  it('40001 se reconoce como conflicto y muestra un mensaje claro', () => {
    const error = new ErrorConsulta('duplicate key', '40001')
    expect(esConflicto(error)).toBe(true)
    expect(mensajeDeError(error, 'otro')).toContain('Otra persona modificó')
  })

  it('42501 y 22023 no filtran el texto crudo de la base', () => {
    expect(mensajeDeError(new ErrorConsulta('permission denied for table', '42501'), 'x')).toContain('No tenés permiso')
    expect(mensajeDeError(new ErrorConsulta('invalid input syntax', '22023'), 'x')).toContain('Revisá los datos')
  })

  it('un error desconocido usa el mensaje por defecto y no es conflicto', () => {
    const desconocido = new Error('boom')
    expect(esConflicto(desconocido)).toBe(false)
    expect(mensajeDeError(desconocido, 'No pudimos guardar.')).toBe('No pudimos guardar.')
  })
})

describe('nombreProducto (FR-004: «Sin producto»)', () => {
  it('cae al texto del prototipo cuando la consulta no tiene producto', () => {
    expect(nombreProducto({ producto_nombre: null })).toBe('Sin producto')
    expect(nombreProducto({ producto_nombre: 'Funda' })).toBe('Funda')
  })
})
