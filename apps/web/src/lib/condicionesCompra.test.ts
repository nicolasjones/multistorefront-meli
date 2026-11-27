import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MENSAJE_CONFLICTO_CONDICIONES,
  SIN_CONDICIONES,
  aFormularioCondiciones,
  esConflictoCondiciones,
  guardarCondiciones,
  hayCambiosCondiciones,
  leerCondiciones,
  mensajeErrorCondiciones,
  parsearPlazo,
  textoPlazo,
  validarCondiciones,
} from './condicionesCompra'

const rpc = vi.fn()
const cliente = { rpc } as unknown as SupabaseClient
const vacio = { plazo: '', minimo: '', moneda: '' as const, notas: '' }

describe('parsearPlazo', () => {
  // Frontera en una sola tabla: 0 y 365 válidos, -1 y 366 no; vacío = sin dato.
  it.each([
    ['', null], ['   ', null], ['0', 0], ['1', 1], [' 30 ', 30], ['364', 364], ['365', 365],
    ['366', undefined], ['-1', undefined], ['1.5', undefined], ['1,5', undefined], ['abc', undefined], ['1000', undefined],
  ])('«%s» -> %s', (texto, esperado) => {
    expect(parsearPlazo(texto)).toBe(esperado)
  })
})

describe('validarCondiciones', () => {
  it('un formulario vacío es válido (todo es opcional)', () => {
    expect(validarCondiciones(vacio)).toEqual({})
  })
  it('un mínimo sin moneda se rechaza y con moneda pasa', () => {
    expect(validarCondiciones({ ...vacio, minimo: '100' })).toEqual({ moneda: 'Elegí la moneda del mínimo de compra.' })
    expect(validarCondiciones({ ...vacio, minimo: '100', moneda: 'ARS' })).toEqual({})
  })
  it.each([['1000,50', true], ['1000.5', true], ['10,555', false], ['-1', false], ['abc', false], ['1234567890123', false]])(
    'mínimo «%s» válido: %s', (minimo, valido) => {
      const errores = validarCondiciones({ ...vacio, minimo, moneda: 'USD' })
      expect(errores.minimo === undefined).toBe(valido)
    },
  )
  it('el plazo fuera de rango muestra el mensaje con el máximo', () => {
    expect(validarCondiciones({ ...vacio, plazo: '366' }).plazo).toBe('Ingresá los días de plazo, de 0 a 365.')
    expect(validarCondiciones({ ...vacio, plazo: '365' }).plazo).toBeUndefined()
  })
  it.each([[1000, true], [1001, false]])('notas de %i caracteres válidas: %s', (largo, valido) => {
    expect(validarCondiciones({ ...vacio, notas: 'x'.repeat(largo) }).notas === undefined).toBe(valido)
  })
  it('las notas se miden recortadas', () => {
    expect(validarCondiciones({ ...vacio, notas: `  ${'x'.repeat(1000)}  ` }).notas).toBeUndefined()
  })
})

describe('leerCondiciones', () => {
  beforeEach(() => rpc.mockReset())

  it('sin fila devuelve «sin condiciones» y llama a la función con el proveedor', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(leerCondiciones(cliente, 'prv-1')).resolves.toEqual(SIN_CONDICIONES)
    expect(rpc).toHaveBeenCalledWith('obtener_condiciones_compra_proveedor', { p_proveedor_id: 'prv-1' })
  })
  it('convierte el numeric de texto a número y conserva el updated_at textual', async () => {
    rpc.mockResolvedValue({
      data: [{ plazo_pago_dias: 30, minimo_compra: '1500.50', moneda: 'ARS', notas: 'N', updated_at: '2026-11-26T10:00:00.123456+00:00' }],
      error: null,
    })
    await expect(leerCondiciones(cliente, 'prv-1')).resolves.toEqual({
      plazoPagoDias: 30, minimoCompra: 1500.5, moneda: 'ARS', notas: 'N', actualizadoEn: '2026-11-26T10:00:00.123456+00:00',
    })
  })
  it('propaga el error de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(leerCondiciones(cliente, 'prv-1')).rejects.toEqual({ code: '42501' })
  })
})

describe('guardarCondiciones', () => {
  beforeEach(() => rpc.mockReset())

  it('envía los valores normalizados y la marca de concurrencia', async () => {
    rpc.mockResolvedValue({ data: '2026-11-26T11:00:00+00:00', error: null })
    const nueva = await guardarCondiciones(cliente, 'prv-1', { plazo: ' 30 ', minimo: '1500,5', moneda: 'ARS', notas: ' Hola ' }, '2026-11-26T10:00:00+00:00')
    expect(nueva).toBe('2026-11-26T11:00:00+00:00')
    expect(rpc).toHaveBeenCalledWith('guardar_condiciones_compra_proveedor', {
      p_proveedor_id: 'prv-1', p_plazo_pago_dias: 30, p_minimo_compra: 1500.5, p_moneda: 'ARS', p_notas: 'Hola', p_actualizado: '2026-11-26T10:00:00+00:00',
    })
  })
  it('lo vacío viaja como nulo y la marca nula si no había condiciones', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(guardarCondiciones(cliente, 'prv-1', vacio, null)).resolves.toBeNull()
    expect(rpc).toHaveBeenCalledWith('guardar_condiciones_compra_proveedor', {
      p_proveedor_id: 'prv-1', p_plazo_pago_dias: null, p_minimo_compra: null, p_moneda: null, p_notas: null, p_actualizado: null,
    })
  })
  it('el plazo 0 (contado) viaja como 0, no como nulo', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await guardarCondiciones(cliente, 'prv-1', { ...vacio, plazo: '0' }, null)
    expect(rpc.mock.calls[0][1].p_plazo_pago_dias).toBe(0)
  })
  it('un formulario inválido no llega a la base', async () => {
    await expect(guardarCondiciones(cliente, 'prv-1', { ...vacio, plazo: '400' }, null)).rejects.toThrow('Las condiciones no son válidas')
    await expect(guardarCondiciones(cliente, 'prv-1', { ...vacio, minimo: 'abc', moneda: 'ARS' }, null)).rejects.toThrow('Las condiciones no son válidas')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('formulario y mensajes', () => {
  it('aFormularioCondiciones y hayCambiosCondiciones', () => {
    const inicial = aFormularioCondiciones({ plazoPagoDias: 0, minimoCompra: 1500.5, moneda: 'USD', notas: 'x', actualizadoEn: 't' })
    expect(inicial).toEqual({ plazo: '0', minimo: '1500,5', moneda: 'USD', notas: 'x' })
    expect(hayCambiosCondiciones(inicial, inicial)).toBe(false)
    expect(hayCambiosCondiciones({ ...inicial, notas: ' x ' }, inicial)).toBe(false)
    for (const cambio of [{ plazo: '1' }, { minimo: '2' }, { moneda: 'ARS' as const }, { notas: 'y' }]) {
      expect(hayCambiosCondiciones({ ...inicial, ...cambio }, inicial)).toBe(true)
    }
  })
  it('textoPlazo', () => {
    expect([textoPlazo(null), textoPlazo(0), textoPlazo(1), textoPlazo(30)]).toEqual(['—', 'Contado', '1 día', '30 días'])
  })
  it('los conflictos se reconocen con el código viejo y el nuevo y se explican en castellano', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(esConflictoCondiciones({ code: 'PT412' })).toBe(true)
    expect(esConflictoCondiciones({ code: '40001' })).toBe(true)
    expect(esConflictoCondiciones({ code: '42501' })).toBe(false)
    expect(mensajeErrorCondiciones({ code: 'PT412' }, 'x')).toBe(MENSAJE_CONFLICTO_CONDICIONES)
    expect(mensajeErrorCondiciones({ code: 'PT404' }, 'x')).toBe('El proveedor ya no existe o no pertenece a tu organización.')
    expect(mensajeErrorCondiciones({ code: '22023', message: 'detalle interno' }, 'x')).toBe('Algún dato no es válido. Revisá el formulario e intentá de nuevo.')
    expect(mensajeErrorCondiciones({ code: 'XX000', message: 'detalle interno' }, 'por defecto')).toBe('por defecto')
  })
})
