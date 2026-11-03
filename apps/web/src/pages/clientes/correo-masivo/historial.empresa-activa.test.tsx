import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  estado: { empresaActiva: 'e-1' as string | null },
  useHistorial: vi.fn(),
  useDetalle: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../../hooks/useHistorialCorreoMasivo', () => ({ useHistorialCorreoMasivo: mocks.useHistorial, useDetalleCampanaCorreo: mocks.useDetalle }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
    valor: mocks.estado.empresaActiva, cambiar: vi.fn(), empresaActivaId: mocks.estado.empresaActiva, cargando: false, hayError: false,
  }),
}))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CorreoMasivoHistorial } from './historial'
import { CorreoMasivoDetalle } from './detalle'

const historialDe = (empresa: string | null) => ({
  filas: [{
    id: `c-${empresa}`, creada_en: '2026-10-30T15:05:00Z', asunto: `Campaña de ${empresa}`, autor: 'Ana', estado: 'completada',
    destinatarios: 1, enviados: 1, fallidos: 0, omitidos: 0, pendientes: 0, bajas: 0,
  }],
  total: 1, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
})

const detalleDe = (empresa: string | null) => ({
  datos: {
    campana: { id: 'c-1', asunto: 'Campaña', mensaje: 'Mensaje', estado: 'completada', creada_en: '2026-10-30T15:05:00Z', autor: 'Ana', empresa_id: empresa, destinatarios: 0, enviados: 0, fallidos: 0, omitidos: 0, pendientes: 0, bajas: 0 },
    total: 0, destinatarios: [],
  },
  noExiste: false, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
})

const rutas = (entrada: string) => (
  <MemoryRouter initialEntries={[entrada]}>
    <Routes>
      <Route path="/clientes/correo-masivo/historial" element={<CorreoMasivoHistorial />} />
      <Route path="/clientes/correo-masivo/historial/:id" element={<CorreoMasivoDetalle />} />
    </Routes>
  </MemoryRouter>
)

// F-CLI-13, FR-036 (Principio VIII). [MSF-376:T025] [F-CLI-13#5]
describe('Correo masivo · Historial · empresa activa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.estado.empresaActiva = 'e-1'
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useHistorial.mockImplementation(({ empresaId }: { empresaId: string | null }) => historialDe(empresaId))
    mocks.useDetalle.mockImplementation(() => detalleDe('e-1'))
  })

  it('al cambiar de empresa el historial se reencuadra: pide la nueva, vuelve a la página 1 y no muestra la anterior', () => {
    const { rerender } = render(rutas('/clientes/correo-masivo/historial'))
    expect(screen.getByText('Campaña de e-1')).toBeInTheDocument()
    expect(mocks.useHistorial).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: 'e-1', pagina: 1 }))

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas('/clientes/correo-masivo/historial'))
    expect(mocks.useHistorial).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: 'e-2', pagina: 1 }))
    expect(screen.getByText('Campaña de e-2')).toBeInTheDocument()
    expect(screen.queryByText('Campaña de e-1')).not.toBeInTheDocument()
  })

  it('mientras llega la respuesta de la nueva empresa no queda ninguna fila ni total de la anterior', () => {
    mocks.estado.empresaActiva = 'e-2'
    mocks.useHistorial.mockReturnValue({ filas: [], total: 0, isLoading: true, isFetching: true, isError: false, refetch: vi.fn() })
    render(rutas('/clientes/correo-masivo/historial'))
    expect(screen.queryByText(/Campaña de/)).not.toBeInTheDocument()
    expect(screen.queryByText(/campañas?$/)).not.toBeInTheDocument()
  })

  it('el detalle abierto vuelve al historial cuando cambia la empresa activa', async () => {
    const { rerender } = render(rutas('/clientes/correo-masivo/historial/c-1'))
    expect(screen.getByRole('heading', { name: 'Campaña' })).toBeInTheDocument()

    mocks.estado.empresaActiva = 'e-2'
    rerender(rutas('/clientes/correo-masivo/historial/c-1'))
    await waitFor(() => expect(screen.getByText('Campaña de e-2')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Campaña' })).not.toBeInTheDocument()
  })

  it('una campaña armada con otra tienda no se muestra bajo la empresa activa', () => {
    mocks.useDetalle.mockImplementation(() => detalleDe('e-2'))
    render(rutas('/clientes/correo-masivo/historial/c-1'))
    expect(screen.getByText('No encontramos esa campaña.')).toBeInTheDocument()
    expect(screen.queryByText('Mensaje')).not.toBeInTheDocument()
  })
})
