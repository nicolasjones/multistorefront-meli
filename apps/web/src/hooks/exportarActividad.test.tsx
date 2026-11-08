import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILTROS_ACTIVIDAD_INICIALES } from '../lib/actividad'

const mocks = vi.hoisted(() => ({ traer: vi.fn(), descargar: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))
vi.mock('../lib/exportarActividad', async (importar) => ({
  ...(await importar<typeof import('../lib/exportarActividad')>()),
  traerActividadParaExportar: mocks.traer,
  descargarCsvActividad: mocks.descargar,
}))

import { useExportarActividad } from './useExportarActividad'

const filtros = (empresa: string | null = null) => ({ ...FILTROS_ACTIVIDAD_INICIALES, empresa })

describe('useExportarActividad (F-AUD-03, FR-013)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('exporta con los filtros de la pantalla y muestra «exportando» mientras corre', async () => {
    let terminar: (valor: unknown) => void = () => undefined
    mocks.traer.mockReturnValue(new Promise((resolver) => { terminar = resolver }))
    const f = filtros('e-1')
    const { result } = renderHook(() => useExportarActividad(f))

    act(() => { void result.current.exportar() })
    await waitFor(() => expect(result.current.exportando).toBe(true))
    expect(mocks.traer).toHaveBeenCalledWith(expect.anything(), f)

    await act(async () => { terminar({ estado: 'completo', filas: [{ detalle: 'x' }], total: 1 }) })
    await waitFor(() => expect(result.current.exportando).toBe(false))
    expect(mocks.descargar).toHaveBeenCalledTimes(1)
    expect(result.current.mensaje).toBeNull()
  })

  it('avisa que no hay actividad y no descarga nada', async () => {
    mocks.traer.mockResolvedValue({ estado: 'vacio' })
    const { result } = renderHook(() => useExportarActividad(filtros()))
    await act(async () => { await result.current.exportar() })
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(result.current.mensaje).toEqual({ tipo: 'aviso', texto: 'No hay actividad para exportar.' })
  })

  it('si falla muestra el error, no descarga y permite reintentar', async () => {
    mocks.traer.mockRejectedValueOnce(new Error('red caída')).mockResolvedValueOnce({ estado: 'completo', filas: [{}], total: 1 })
    const { result } = renderHook(() => useExportarActividad(filtros()))
    await act(async () => { await result.current.exportar() })
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(result.current.mensaje?.tipo).toBe('error')
    expect(result.current.exportando).toBe(false)

    await act(async () => { await result.current.exportar() })
    expect(mocks.descargar).toHaveBeenCalledTimes(1)
    expect(result.current.mensaje).toBeNull()
  })

  it('si el filtro supera las 50.000 filas no descarga y deja un aviso que pide acotar con el total real (CA-AUD-03-3)', async () => {
    mocks.traer.mockResolvedValue({ estado: 'excede', total: 80_000 })
    const { result } = renderHook(() => useExportarActividad(filtros()))
    await act(async () => { await result.current.exportar() })
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(result.current.mensaje?.tipo).toBe('aviso')
    expect(result.current.mensaje?.texto).toContain('80.000')
    expect(result.current.mensaje?.texto).toContain('50.000')
    expect(result.current.mensaje?.texto).toContain('acotá el período')
  })

  it('si faltan filas (exportación incompleta) es un error con reintento y no descarga nada', async () => {
    mocks.traer.mockRejectedValue(new Error('Se esperaban 10 filas y llegaron 3.'))
    const { result } = renderHook(() => useExportarActividad(filtros()))
    await act(async () => { await result.current.exportar() })
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(result.current.mensaje?.tipo).toBe('error')
  })

  it('no empieza otra exportación mientras hay una en curso', async () => {
    mocks.traer.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useExportarActividad(filtros()))
    act(() => { void result.current.exportar(); void result.current.exportar() })
    expect(mocks.traer).toHaveBeenCalledTimes(1)
  })

  it('si cambia la empresa activa a mitad de la exportación, descarta lo traído (Principio VIII)', async () => {
    let terminar: (valor: unknown) => void = () => undefined
    mocks.traer.mockReturnValue(new Promise((resolver) => { terminar = resolver }))
    const { result, rerender } = renderHook(({ f }) => useExportarActividad(f), { initialProps: { f: filtros('e-1') } })

    act(() => { void result.current.exportar() })
    await waitFor(() => expect(result.current.exportando).toBe(true))
    rerender({ f: filtros('e-2') })
    await act(async () => { terminar({ estado: 'completo', filas: [{}], total: 1 }) })

    await waitFor(() => expect(result.current.exportando).toBe(false))
    expect(mocks.descargar).not.toHaveBeenCalled()
    expect(result.current.mensaje).toBeNull()
  })
})
