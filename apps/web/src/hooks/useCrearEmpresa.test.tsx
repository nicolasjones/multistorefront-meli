import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc } }))

import { MENSAJE_NOMBRE_REPETIDO, MENSAJE_NOMBRE_VACIO, useCrearEmpresa } from './useCrearEmpresa'

const llamar = async (nombre: string, origen: string | null = null) => {
  const { result } = renderHook(() => useCrearEmpresa())
  let resultado: Awaited<ReturnType<typeof result.current.crear>> | undefined
  await act(async () => { resultado = await result.current.crear(nombre, origen) })
  return resultado
}

describe('useCrearEmpresa', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('llama a la RPC con el nombre recortado y el origen', async () => {
    expect(await llamar('  Tienda Oeste ', 'e-1')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('crear_empresa', { p_nombre: 'Tienda Oeste', p_copiar_de: 'e-1' })
  })

  it('rechaza un nombre vacío sin llamar al servidor', async () => {
    expect(await llamar('  ')).toEqual({ ok: false, tipo: 'nombre', mensaje: MENSAJE_NOMBRE_VACIO })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('traduce el nombre repetido (23505) al campo Nombre', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'x' } })
    expect(await llamar('Mundo JC')).toEqual({ ok: false, tipo: 'nombre', mensaje: MENSAJE_NOMBRE_REPETIDO })
  })

  it('traduce cualquier otro fallo, incluida una excepción de red, a error de servidor', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    expect(await llamar('A')).toMatchObject({ ok: false, tipo: 'servidor' })

    rpc.mockRejectedValueOnce(new Error('red'))
    expect(await llamar('C')).toMatchObject({ ok: false, tipo: 'servidor' })
  })
})
