import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), organizacionId: 'org-1' as string | null }))

vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId } : null, isLoading: false }),
}))
vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { useDestinatariosCorreoMasivo, type FiltrosDestinatarios } from './useDestinatariosCorreoMasivo'

const base: FiltrosDestinatarios = { texto: '', tipo: null, empresaId: null, conCuentaWeb: false, clientes: null, pagina: 1, tamano: 25 }
const lista = { total: 40, filas: [{ id: 'c-1', numero: 1, nombre: 'Ana', correo: 'ana@example.com' }] }
const resumen = { elegibles: 40, sin_correo: 2, no_aceptan: 5 }

const responder = () => mocks.rpc.mockImplementation((nombre: string) =>
  Promise.resolve({ data: nombre === 'listar_destinatarios_correo_masivo' ? lista : resumen, error: null }))

describe('useDestinatariosCorreoMasivo', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.organizacionId = 'org-1'
  })

  it('llama a la lista y al resumen con los mismos filtros y devuelve total, filas y resumen', async () => {
    responder()
    const { result } = renderHook(() => useDestinatariosCorreoMasivo({
      ...base, texto: '  ana ', tipo: 'mayorista', empresaId: 'e-1', conCuentaWeb: true, clientes: ['c-1', 'c-2'], pagina: 2,
    }))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const filtros = { p_texto: 'ana', p_tipo: 'mayorista', p_empresa: 'e-1', p_con_cuenta_web: true, p_clientes: ['c-1', 'c-2'] }
    expect(mocks.rpc).toHaveBeenCalledWith('listar_destinatarios_correo_masivo', { ...filtros, p_pagina: 2, p_tamano: 25 })
    expect(mocks.rpc).toHaveBeenCalledWith('resumen_destinatarios_correo_masivo', filtros)
    expect(result.current.total).toBe(40)
    expect(result.current.filas).toHaveLength(1)
    expect(result.current.resumen).toEqual(resumen)
  })

  it('sin selección manda p_clientes y p_texto en null', async () => {
    responder()
    const { result } = renderHook(() => useDestinatariosCorreoMasivo(base))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_clientes: null, p_texto: null, p_empresa: null })
  })

  it('un error de cualquiera de las dos consultas deja el estado de error y sin filas', async () => {
    mocks.rpc.mockImplementation((nombre: string) =>
      Promise.resolve(nombre === 'listar_destinatarios_correo_masivo' ? { data: lista, error: null } : { data: null, error: { message: 'x' } }))
    const { result } = renderHook(() => useDestinatariosCorreoMasivo(base))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isError).toBe(true)
    expect(result.current.filas).toEqual([])
    expect(result.current.resumen).toBeNull()
  })

  it('al cambiar de empresa vuelve a cargar y no muestra las filas de la anterior mientras llega la respuesta', async () => {
    responder()
    const { result, rerender } = renderHook((props: FiltrosDestinatarios) => useDestinatariosCorreoMasivo(props), { initialProps: { ...base, empresaId: 'e-1' } })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.filas).toHaveLength(1)

    rerender({ ...base, empresaId: 'e-2' })
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.rpc.mock.calls.at(-1)![1]).toMatchObject({ p_empresa: 'e-2' })
  })
})
