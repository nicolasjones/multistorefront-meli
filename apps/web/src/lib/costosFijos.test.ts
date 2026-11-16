import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BANDERA_MARGEN_COSTOS_FIJOS, leerBanderaMargenCostosFijos, urlParamsCostosFijos } from './costosFijos'

const clienteCon = (resultado: { data: { activa: boolean } | null; error: unknown }) => {
  const eq = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(resultado) })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { cliente: { from } as unknown as SupabaseClient, from, select, eq }
}

describe('leerBanderaMargenCostosFijos', () => {
  it('lee la fila de la bandera por su clave', async () => {
    const { cliente, from, eq } = clienteCon({ data: { activa: true }, error: null })
    await expect(leerBanderaMargenCostosFijos(cliente)).resolves.toBe(true)
    expect(from).toHaveBeenCalledWith('banderas_plataforma')
    expect(eq).toHaveBeenCalledWith('clave', BANDERA_MARGEN_COSTOS_FIJOS)
  })

  it('apagada o sin fila cuenta como apagada', async () => {
    await expect(leerBanderaMargenCostosFijos(clienteCon({ data: { activa: false }, error: null }).cliente)).resolves.toBe(false)
    await expect(leerBanderaMargenCostosFijos(clienteCon({ data: null, error: null }).cliente)).resolves.toBe(false)
  })

  it('propaga el error para que el hook falle cerrado', async () => {
    await expect(leerBanderaMargenCostosFijos(clienteCon({ data: null, error: new Error('x') }).cliente)).rejects.toThrow('x')
  })
})

describe('urlParamsCostosFijos', () => {
  it('sin tienda no preselecciona nada (todas las accesibles del token)', () => {
    expect(urlParamsCostosFijos(null)).toEqual({})
  })

  it('con tienda arma el filtro nativo y escapa los caracteres de rison', () => {
    expect(urlParamsCostosFijos('San Javucho').native_filters).toContain("val:!('San Javucho')")
    expect(urlParamsCostosFijos("O'Brien !").native_filters).toContain("'O!'Brien !!'")
  })
})
