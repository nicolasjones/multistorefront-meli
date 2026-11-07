import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ rpcPublico: vi.fn(), firmar: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: nombre === 'publico' ? mocks.rpcPublico : vi.fn() }) },
}))
vi.mock('./imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import { leerRelacionados, useRelacionados } from './tiendaRelacionados'

const ID = 'a1000000-0000-4000-8000-000000000001'
const FILA = { id: 'a1000000-0000-4000-8000-000000000002', nombre: 'Alfa', precio: '1100.00', disponible: true, imagen: 'o/p/1.png', categoria_id: 'c1' }

describe('leerRelacionados (FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.firmar.mockResolvedValue({ 'o/p/1.png': 'https://firmada/1' })
  })

  it('llama a publico.relacionados_por_dominio, convierte el precio y firma las imágenes', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { productos: [FILA] }, error: null })
    const r = await leerRelacionados('mundojc.localhost', ID)
    expect(mocks.rpcPublico).toHaveBeenCalledWith('relacionados_por_dominio', { host: 'mundojc.localhost', producto: ID })
    expect(r.productos).toEqual([{ id: FILA.id, nombre: 'Alfa', precio: 1100, disponible: true, imagen: 'o/p/1.png', categoriaId: 'c1', destacado: false }])
    expect(r.imagenes).toEqual({ 'o/p/1.png': 'https://firmada/1' })
  })

  it('null de la base → sin relacionados', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: null, error: null })
    expect(await leerRelacionados('x', ID)).toEqual({ productos: [], imagenes: {} })
  })

  it('un id que no es UUID no llega a la base', async () => {
    expect(await leerRelacionados('x', 'no-es-un-id')).toEqual({ productos: [], imagenes: {} })
    expect(mocks.rpcPublico).not.toHaveBeenCalled()
  })

  it('un error de la base se propaga', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: null, error: { message: 'caído' } })
    await expect(leerRelacionados('x', ID)).rejects.toThrow('caído')
  })
})

describe('useRelacionados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.firmar.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('pasa de cargando a lista', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { productos: [FILA] }, error: null })
    const { result } = renderHook(() => useRelacionados('h', ID))
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
  })

  it('sin productos → vacia', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { productos: [] }, error: null })
    const { result } = renderHook(() => useRelacionados('h', ID))
    await waitFor(() => expect(result.current.fase).toBe('vacia'))
  })

  it('falla → error', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: null, error: { message: 'caído' } })
    const { result } = renderHook(() => useRelacionados('h', ID))
    await waitFor(() => expect(result.current.fase).toBe('error'))
  })

  it('al cambiar de producto vuelve a cargando y no muestra los anteriores', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { productos: [FILA] }, error: null })
    const { result, rerender } = renderHook(({ id }) => useRelacionados('h', id), { initialProps: { id: ID } })
    await waitFor(() => expect(result.current.fase).toBe('lista'))
    rerender({ id: 'a1000000-0000-4000-8000-000000000009' })
    expect(result.current.fase).toBe('cargando')
    await waitFor(() => expect(result.current.fase).toBe('lista'))
  })
})
