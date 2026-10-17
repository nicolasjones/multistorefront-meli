import { describe, expect, it, vi } from 'vitest'
import {
  fechaDeHoy, formularioMovimientoVacio, mensajeDeErrorStock, motivosDelTipo, parsearCantidad, stockResultante,
  validarMovimiento, type FormularioMovimiento, type MotivoMovimiento,
} from './stock'

const valido: FormularioMovimiento = {
  tipo: 'entrada', producto_id: 'p-1', cantidad: '10', fecha: '2026-10-17', motivo_id: 'm-1', nota: '',
}

describe('stock', () => {
  it('parsea solo enteros sin signo ni decimales', () => {
    expect(parsearCantidad(' 12 ')).toBe(12)
    expect(parsearCantidad('0')).toBe(0)
    for (const texto of ['', '-1', '1,5', '1.5', 'abc', '1e3', '12345678901']) {
      expect(parsearCantidad(texto)).toBeNull()
    }
  })

  it('calcula el stock resultante de los tres tipos (entrada 10, salida 4, ajuste a 3)', () => {
    expect(stockResultante('entrada', 0, '10')).toBe(10)
    expect(stockResultante('salida', 10, '4')).toBe(6)
    expect(stockResultante('ajuste', 6, '3')).toBe(3)
    expect(stockResultante('entrada', 0, '')).toBeNull()
  })

  it('valida entrada/salida (> 0) y ajuste (≥ 0)', () => {
    expect(validarMovimiento(valido, '2026-10-17')).toEqual({})
    expect(validarMovimiento({ ...valido, cantidad: '0' }, '2026-10-17').cantidad).toBeDefined()
    expect(validarMovimiento({ ...valido, tipo: 'salida', cantidad: '-3' }, '2026-10-17').cantidad).toBeDefined()
    expect(validarMovimiento({ ...valido, tipo: 'ajuste', cantidad: '0' }, '2026-10-17')).toEqual({})
    expect(validarMovimiento({ ...valido, tipo: 'ajuste', cantidad: '' }, '2026-10-17').cantidad).toBeDefined()
  })

  it('exige producto, motivo y fecha no futura, y acota la nota', () => {
    const errores = validarMovimiento({ ...valido, producto_id: '', motivo_id: '', fecha: '2026-10-18', nota: 'x'.repeat(501) }, '2026-10-17')
    expect(Object.keys(errores).sort()).toEqual(['fecha', 'motivo_id', 'nota', 'producto_id'])
  })

  it('ofrece solo motivos activos que aplican al tipo', () => {
    const motivos: MotivoMovimiento[] = [
      { id: 'a', nombre: 'Compra', aplica_a: ['entrada'], activo: true },
      { id: 'b', nombre: 'Venta', aplica_a: ['salida'], activo: true },
      { id: 'c', nombre: 'Vieja', aplica_a: ['entrada'], activo: false },
    ]
    expect(motivosDelTipo(motivos, 'entrada').map((m) => m.id)).toEqual(['a'])
  })

  it('arma la fecha local como YYYY-MM-DD y el formulario vacío arranca hoy', () => {
    expect(fechaDeHoy(new Date(2026, 9, 7))).toBe('2026-10-07')
    expect(formularioMovimientoVacio('p-9')).toMatchObject({ tipo: 'entrada', producto_id: 'p-9', fecha: fechaDeHoy() })
  })

  it('traduce los errores sin exponer el texto crudo de la base', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeErrorStock({ code: '42501', message: 'row-level security' }, 'x')).toMatch(/No tenés permiso/)
    expect(mensajeDeErrorStock({ code: '22023', message: 'interno' }, 'x')).toMatch(/Algún dato no es válido/)
    expect(mensajeDeErrorStock({ code: '23505' }, 'x')).toBe('Ya existe un motivo con ese nombre.')
    expect(mensajeDeErrorStock({ code: 'XX000', message: 'boom' }, 'por defecto')).toBe('por defecto')
  })
})
