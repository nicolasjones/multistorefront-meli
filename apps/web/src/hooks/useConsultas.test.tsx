import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarConsultas: vi.fn(),
  contarConsultasNuevas: vi.fn(),
  leerConsulta: vi.fn(),
  listarResponsables: vi.fn(),
  organizacionId: 'o-1' as string | null,
}))

vi.mock('../lib/consultas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/consultas')>()),
  listarConsultas: mocks.listarConsultas,
  contarConsultasNuevas: mocks.contarConsultasNuevas,
  leerConsulta: mocks.leerConsulta,
  listarResponsables: mocks.listarResponsables,
}))
vi.mock('./useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({
    organizacionActiva: mocks.organizacionId ? { id: mocks.organizacionId, nombre: 'Org' } : null,
    isLoading: false,
  }),
}))

import type { Consulta } from '../lib/consultas'
import { notificarCambioConsultas } from '../lib/consultas'
import { useBandejaConsultas, useConsulta, useConsultasNuevas, useResponsablesConsultas } from './useConsultas'

const fila = (id: string, extra: Partial<Consulta> = {}): Consulta => ({
  id,
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  origen: 'formulario',
  nombre: 'Ana',
  contacto: 'ana@example.com',
  mensaje: 'Hola',
  producto_id: null,
  producto_nombre: null,
  estado: 'nueva',
  responsable_id: null,
  responsable_nombre: null,
  nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z',
  updated_at: '2026-10-23T11:48:00.000Z',
  ...extra,
})

const filtros = (empresaId: string | null) => ({
  empresaId, estado: null, texto: '', desde: '', hasta: '', pagina: 1, tamano: 25,
})

function diferido<T>() {
  let resolver!: (valor: T) => void
  let rechazar!: (error: unknown) => void
  const promesa = new Promise<T>((resolve, reject) => {
    resolver = resolve
    rechazar = reject
  })
  return { promesa, resolver, rechazar }
}

describe('useBandejaConsultas (FR-008: el ámbito manda, nunca se arrastran filas)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacionId = 'o-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('carga la página con los filtros recibidos', async () => {
    mocks.listarConsultas.mockResolvedValue({ filas: [fila('c-1')], total: 1 })
    const { result } = renderHook(() => useBandejaConsultas(filtros('e-1')))
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.listarConsultas).toHaveBeenCalledWith(filtros('e-1'))
    expect(result.current.consultas.map((c) => c.id)).toEqual(['c-1'])
    expect(result.current.total).toBe(1)
  })

  it('al cambiar la empresa descarta lo de la anterior y descarta su respuesta tardía', async () => {
    const primera = diferido<{ filas: Consulta[]; total: number }>()
    const segunda = diferido<{ filas: Consulta[]; total: number }>()
    mocks.listarConsultas.mockReturnValueOnce(primera.promesa).mockReturnValueOnce(segunda.promesa)

    const { result, rerender } = renderHook(
      ({ empresaId }: { empresaId: string | null }) => useBandejaConsultas(filtros(empresaId)),
      { initialProps: { empresaId: 'e-1' } },
    )
    rerender({ empresaId: 'e-2' })

    expect(result.current.consultas).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      primera.resolver({ filas: [fila('vieja')], total: 99 })
      await primera.promesa
    })
    expect(result.current.consultas).toEqual([])
    expect(result.current.total).toBe(0)

    await act(async () => {
      segunda.resolver({ filas: [fila('nueva')], total: 1 })
      await segunda.promesa
    })
    expect(result.current.consultas.map((c) => c.id)).toEqual(['nueva'])
    expect(result.current.total).toBe(1)
    expect(result.current.isLoading).toBe(false)
  })

  it('un error se expone sin dejar filas viejas y permite reintentar', async () => {
    mocks.listarConsultas.mockResolvedValueOnce({ filas: [fila('c-1')], total: 1 })
    const { result } = renderHook(() => useBandejaConsultas(filtros('e-1')))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mocks.listarConsultas.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      await result.current.refetch()
    })
    expect(result.current.isError).toBe(true)
    expect(result.current.consultas).toEqual([])
  })

  it('sin habilitar no consulta', () => {
    renderHook(() => useBandejaConsultas(filtros('e-1'), { habilitado: false }))
    expect(mocks.listarConsultas).not.toHaveBeenCalled()
  })
})

describe('useConsultasNuevas (contador del menú y chip «Nuevas (n)»)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacionId = 'o-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('cuenta las nuevas del ámbito y vuelve a null al cambiar de empresa', async () => {
    mocks.contarConsultasNuevas.mockResolvedValue(4)
    const { result, rerender } = renderHook(
      ({ empresaId }: { empresaId: string | null }) => useConsultasNuevas(empresaId),
      { initialProps: { empresaId: 'e-1' } },
    )
    await waitFor(() => expect(result.current.total).toBe(4))
    expect(mocks.contarConsultasNuevas).toHaveBeenCalledWith('e-1')

    const siguiente = diferido<number>()
    mocks.contarConsultasNuevas.mockImplementationOnce(() => siguiente.promesa)
    rerender({ empresaId: 'e-2' })
    expect(result.current.total).toBeNull()

    await act(async () => {
      siguiente.resolver(2)
      await siguiente.promesa
    })
    expect(result.current.total).toBe(2)
  })

  it('un error deja el contador nulo sin romper el menú', async () => {
    mocks.contarConsultasNuevas.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useConsultasNuevas('e-1'))
    await waitFor(() => expect(mocks.contarConsultasNuevas).toHaveBeenCalled())
    expect(result.current.total).toBeNull()
  })
})

describe('useConsulta (enlace ?consulta=<id>)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacionId = 'o-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('sin id no consulta ni se queda cargando', () => {
    const { result } = renderHook(() => useConsulta(null))
    expect(mocks.leerConsulta).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.consulta).toBeNull()
  })

  it('lee la consulta y distingue «no encontrada» de un error', async () => {
    mocks.leerConsulta.mockResolvedValueOnce(null)
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useConsulta(id), {
      initialProps: { id: 'c-1' as string | null },
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.noEncontrada).toBe(true)

    mocks.leerConsulta.mockRejectedValueOnce(new Error('boom'))
    rerender({ id: 'c-2' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.noEncontrada).toBe(false)
  })

  // MSF-698: el `updated_at` del detalle es el sello del bloqueo optimista. Si queda viejo, la
  // acción siguiente choca con el control de concurrencia y obliga a recargar (con lo que se
  // pierden los cambios sin guardar).
  it('se relee cuando cambia una consulta', async () => {
    mocks.leerConsulta.mockResolvedValue(fila('c-1', { updated_at: '2026-10-24T10:00:00.000Z' }))
    const { result } = renderHook(() => useConsulta('c-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mocks.leerConsulta).toHaveBeenCalledTimes(1)
    expect(result.current.consulta?.updated_at).toBe('2026-10-24T10:00:00.000Z')

    await act(async () => {
      notificarCambioConsultas()
    })
    await waitFor(() => expect(mocks.leerConsulta).toHaveBeenCalledTimes(2))
  })
})

describe('useResponsablesConsultas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organizacionId = 'o-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('carga los responsables de la empresa y sin empresa no llama', async () => {
    mocks.listarResponsables.mockResolvedValue([{ user_id: 'u-1', nombre: 'Ana' }])
    const { result, rerender } = renderHook(
      ({ empresaId }: { empresaId: string | null }) => useResponsablesConsultas(empresaId),
      { initialProps: { empresaId: null as string | null } },
    )
    expect(mocks.listarResponsables).not.toHaveBeenCalled()
    rerender({ empresaId: 'e-1' })
    await waitFor(() => expect(result.current.responsables).toHaveLength(1))
    expect(mocks.listarResponsables).toHaveBeenCalledWith('e-1')
  })
})
