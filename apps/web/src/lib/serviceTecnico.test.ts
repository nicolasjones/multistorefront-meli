import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: {} }))

import {
  esEstadoRepetido,
  esModeloRepetido,
  mensajeDeErrorService,
  MENSAJE_CONFLICTO,
  MENSAJE_ESTADO_REPETIDO,
  MENSAJE_MODELO_REPETIDO,
  parsearImporte,
  validarEstado,
  validarModelo,
} from './serviceTecnico'

describe('parsearImporte', () => {
  it('acepta enteros y decimales con coma o punto, y vacío como cero', () => {
    expect(parsearImporte('25000')).toBe(25000)
    expect(parsearImporte('25000,50')).toBe(25000.5)
    expect(parsearImporte(' 100.5 ')).toBe(100.5)
    expect(parsearImporte('')).toBe(0)
  })

  it('rechaza negativos, letras, tres decimales y montos que no caben en numeric(12,2)', () => {
    expect(parsearImporte('-1')).toBeNull()
    expect(parsearImporte('abc')).toBeNull()
    expect(parsearImporte('1,234')).toBeNull()
    expect(parsearImporte('10000000000')).toBeNull()
  })
})

describe('validarModelo', () => {
  it('pide equipo y modelo y valida el importe', () => {
    expect(validarModelo({ equipo: ' ', modelo: '', mano_obra_base: 'x' })).toEqual({
      equipo: 'Ingresá el equipo.',
      modelo: 'Ingresá el modelo.',
      mano_obra_base: expect.stringContaining('importe'),
    })
  })

  it('limita el largo y acepta un formulario válido', () => {
    expect(validarModelo({ equipo: 'a'.repeat(101), modelo: 'm', mano_obra_base: '1' }).equipo).toBe('Máximo 100 caracteres.')
    expect(validarModelo({ equipo: 'Nintendo Switch', modelo: 'Switch 2', mano_obra_base: '25000' })).toEqual({})
  })
})

describe('validarEstado', () => {
  it('pide el nombre y limita nombre y descripción', () => {
    expect(validarEstado({ nombre: ' ', descripcion: '', avisa_cliente: false }).nombre).toBe('Ingresá el nombre del estado.')
    expect(validarEstado({ nombre: 'a'.repeat(81), descripcion: '', avisa_cliente: false }).nombre).toBe('Máximo 80 caracteres.')
    expect(validarEstado({ nombre: 'ok', descripcion: 'd'.repeat(501), avisa_cliente: false }).descripcion).toBe('Máximo 500 caracteres.')
    expect(validarEstado({ nombre: 'Presupuesto aprobado', descripcion: '', avisa_cliente: true })).toEqual({})
  })
})

describe('mensajeDeErrorService', () => {
  it('traduce los códigos de la base a mensajes claros sin filtrar detalle técnico', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeErrorService({ code: '42501', message: 'policy x' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeErrorService({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorService({ code: '22023' }, 'x')).toContain('no es válido')
    expect(mensajeDeErrorService({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeErrorService({ code: '23505', message: 'índice modelos_equipo_org_equipo_modelo_key' }, 'x')).toBe(MENSAJE_MODELO_REPETIDO)
    expect(mensajeDeErrorService({ code: '23505', message: 'índice estados_reparacion_org_nombre_key' }, 'x')).toBe(MENSAJE_ESTADO_REPETIDO)
    expect(mensajeDeErrorService(new Error('boom'), 'Por defecto')).toBe('Por defecto')
  })

  it('distingue qué índice único se repitió', () => {
    expect(esModeloRepetido({ code: '23505', message: 'modelos_equipo_org_equipo_modelo_key' })).toBe(true)
    expect(esModeloRepetido({ code: '23505', message: 'estados_reparacion_org_nombre_key' })).toBe(false)
    expect(esEstadoRepetido({ code: '23505', message: 'estados_reparacion_org_nombre_key' })).toBe(true)
    expect(esEstadoRepetido({ code: '42501', message: 'estados_reparacion_org_nombre_key' })).toBe(false)
  })
})
