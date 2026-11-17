import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('./supabase', () => {
  const q: Record<string, unknown> = {}
  q.schema = () => q
  q.from = () => q
  q.select = () => q
  q.eq = () => q
  q.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { rpc: mocks.rpc, schema: q.schema } }
})

import { ErrorGuardadoAnalitica, analiticaIgual, guardarAnalitica, leerAnalitica, normalizarAnalitica, validarAnalitica } from './tiendaAnalitica'

describe('validarAnalitica', () => {
  it('acepta vacíos (sin herramienta) y formatos válidos tras normalizar', () => {
    expect(validarAnalitica({ ga4_id: '', meta_pixel_id: '' })).toEqual({})
    expect(validarAnalitica({ ga4_id: ' g-abc1234 ', meta_pixel_id: ' 12345678 ' })).toEqual({})
  })

  it('marca el campo inválido de cada herramienta', () => {
    const errores = validarAnalitica({ ga4_id: 'UA-123', meta_pixel_id: '123' })
    expect(Object.keys(errores)).toEqual(['ga4_id', 'meta_pixel_id'])
    expect(validarAnalitica({ ga4_id: 'G-ABC', meta_pixel_id: '' }).ga4_id).toMatch(/Google Analytics 4/)
    expect(validarAnalitica({ ga4_id: '', meta_pixel_id: '1234567a' }).meta_pixel_id).toMatch(/solo números/)
  })

  it('respeta los límites de largo del Meta Pixel (8 a 20 dígitos)', () => {
    expect(validarAnalitica({ ga4_id: '', meta_pixel_id: '1'.repeat(20) })).toEqual({})
    expect(validarAnalitica({ ga4_id: '', meta_pixel_id: '1'.repeat(21) }).meta_pixel_id).toBeDefined()
  })
})

describe('normalizarAnalitica y analiticaIgual', () => {
  it('recorta y pasa GA4 a mayúsculas sin tocar el pixel más que recortarlo', () => {
    expect(normalizarAnalitica({ ga4_id: ' g-ab12 ', meta_pixel_id: ' 99 ' })).toEqual({ ga4_id: 'G-AB12', meta_pixel_id: '99' })
  })

  it('considera iguales valores que solo difieren en formato', () => {
    expect(analiticaIgual({ ga4_id: 'g-abcd', meta_pixel_id: '' }, { ga4_id: ' G-ABCD ', meta_pixel_id: '' })).toBe(true)
    expect(analiticaIgual({ ga4_id: 'G-ABCD', meta_pixel_id: '' }, { ga4_id: 'G-ABCE', meta_pixel_id: '' })).toBe(false)
  })
})

describe('ErrorGuardadoAnalitica', () => {
  it('solo conserva como campo los dos conocidos', () => {
    expect(new ErrorGuardadoAnalitica('x', 'ga4_id').campo).toBe('ga4_id')
    expect(new ErrorGuardadoAnalitica('x', 'otro').campo).toBeNull()
    expect(new ErrorGuardadoAnalitica('x', null, '42501').codigo).toBe('42501')
  })
})

describe('lectura y guardado', () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.maybeSingle.mockReset() })

  it('leerAnalitica devuelve vacíos si no hay fila y lanza si la base falla', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(leerAnalitica('e1')).resolves.toEqual({ ga4_id: '', meta_pixel_id: '' })
    mocks.maybeSingle.mockResolvedValue({ data: { ga4_id: 'G-ABCD', meta_pixel_id: null }, error: null })
    await expect(leerAnalitica('e1')).resolves.toEqual({ ga4_id: 'G-ABCD', meta_pixel_id: '' })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(leerAnalitica('e1')).rejects.toThrow('boom')
  })

  it('guardarAnalitica manda los valores normalizados', async () => {
    mocks.rpc.mockResolvedValue({ data: { ga4_id: 'G-ABCD', meta_pixel_id: null }, error: null })
    await expect(guardarAnalitica('e1', { ga4_id: ' g-abcd', meta_pixel_id: '' })).resolves.toEqual({ ga4_id: 'G-ABCD', meta_pixel_id: '' })
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_analitica_tienda', { p_empresa_id: 'e1', p_ga4_id: 'G-ABCD', p_meta_pixel_id: '' })
  })

  it('guardarAnalitica convierte el error de la base en uno que nombra el campo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'formato', hint: 'meta_pixel_id', code: '23514' } })
    await expect(guardarAnalitica('e1', { ga4_id: '', meta_pixel_id: 'x' })).rejects.toMatchObject({ campo: 'meta_pixel_id', codigo: '23514', message: 'formato' })
  })
})
