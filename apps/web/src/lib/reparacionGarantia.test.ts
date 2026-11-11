import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  admiteReingresoGarantia,
  errorDeCampoGarantia,
  mensajeDeErrorGarantia,
  obtenerVinculosGarantia,
  reingresarPorGarantia,
  validarGarantia,
  formularioGarantiaVacio,
} from './reparacionGarantia'

describe('reparacionGarantia · validaciones de pantalla (FR-022, FR-024)', () => {
  it('la falla del reingreso es obligatoria', () => {
    expect(validarGarantia(formularioGarantiaVacio(), '2026-10-28').falla).toBe('Describí la falla del reingreso')
    expect(validarGarantia({ ...formularioGarantiaVacio(), falla: '   ' }, '2026-10-28').falla).toBe(
      'Describí la falla del reingreso',
    )
    expect(validarGarantia({ ...formularioGarantiaVacio(), falla: 'Se apaga' }, '2026-10-28').falla).toBeUndefined()
  })

  it('la entrega prevista no puede ser anterior al ingreso de hoy', () => {
    expect(
      validarGarantia({ ...formularioGarantiaVacio(), falla: 'Falla', entrega_prevista: '2026-10-27' }, '2026-10-28')
        .entrega_prevista,
    ).toBe('La entrega prevista no puede ser anterior al ingreso')
    expect(
      validarGarantia({ ...formularioGarantiaVacio(), falla: 'Falla', entrega_prevista: '2026-10-28' }, '2026-10-28')
        .entrega_prevista,
    ).toBeUndefined()
  })

  it('solo se reingresa una reparación entregada y no anulada', () => {
    expect(admiteReingresoGarantia({ entrega_real: '2026-10-05', anulada_en: null })).toBe(true)
    expect(admiteReingresoGarantia({ entrega_real: null, anulada_en: null })).toBe(false)
    expect(admiteReingresoGarantia({ entrega_real: '2026-10-05', anulada_en: '2026-10-06T10:00:00Z' })).toBe(false)
  })
})

describe('reparacionGarantia · llamadas a la base (FR-021, FR-023)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('reingresar_por_garantia manda la falla sin espacios y los vacíos como nulo', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'r-2', codigo: 'R-0002' }, error: null })
    await reingresarPorGarantia('r-1', { falla: '  Se apaga sola  ', tecnico: '', entrega_prevista: '' })
    expect(mocks.rpc).toHaveBeenCalledWith('reingresar_por_garantia', {
      p_reparacion_origen: 'r-1',
      p_falla: 'Se apaga sola',
      p_tecnico: null,
      p_entrega_prevista: null,
    })
  })

  it('obtener_vinculos_garantia devuelve el origen y los reingresos', async () => {
    mocks.rpc.mockResolvedValue({
      data: { origen: { id: 'r-1', codigo: 'R-0001' }, reingresos: [{ id: 'r-2', codigo: 'R-0002', estado: 'Recibido', ingreso: '2026-10-28' }] },
      error: null,
    })
    const vinculos = await obtenerVinculosGarantia('r-2')
    expect(mocks.rpc).toHaveBeenCalledWith('obtener_vinculos_garantia', { p_reparacion: 'r-2' })
    expect(vinculos.origen).toEqual({ id: 'r-1', codigo: 'R-0001' })
    expect(vinculos.reingresos).toHaveLength(1)
  })

  it('si la base responde sin datos, los vínculos vienen vacíos y no rompen la pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await obtenerVinculosGarantia('r-2')).toEqual({ origen: null, reingresos: [] })
  })

  it('el error de la base se propaga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(reingresarPorGarantia('r-1', formularioGarantiaVacio())).rejects.toMatchObject({ code: '42501' })
  })
})

describe('reparacionGarantia · errores (FR-022)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('el error de campo se ubica por el hint de la base', () => {
    expect(errorDeCampoGarantia({ code: '22023', hint: 'falla', message: 'Máximo 1000 caracteres' })).toEqual({
      campo: 'falla',
      mensaje: 'Máximo 1000 caracteres',
    })
    expect(errorDeCampoGarantia({ code: '22023', hint: 'otro', message: 'x' })).toBeNull()
    expect(errorDeCampoGarantia({ code: '55000', message: 'x' })).toBeNull()
  })

  it('los mensajes de la base se traducen a castellano claro', () => {
    expect(mensajeDeErrorGarantia({ code: '55000' }, 'por defecto')).toMatch(/entregada y no anulada/)
    expect(mensajeDeErrorGarantia({ code: '42501' }, 'por defecto')).toMatch(/permiso para reingresar/)
    expect(mensajeDeErrorGarantia({ code: 'P0002' }, 'por defecto')).toMatch(/no existe/)
    expect(mensajeDeErrorGarantia({ code: '22023', message: 'Describí la falla del reingreso' }, 'por defecto')).toBe(
      'Describí la falla del reingreso',
    )
    expect(mensajeDeErrorGarantia({ code: 'XX000' }, 'por defecto')).toBe('por defecto')
  })
})
