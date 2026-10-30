import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useDetalle: vi.fn(), useNivelSeccion: vi.fn(), refetch: vi.fn() }))

vi.mock('../../../hooks/useHistorialCorreoMasivo', () => ({ useDetalleCampanaCorreo: mocks.useDetalle }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: () => ({ empresaActivaId: null }) }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CorreoMasivoDetalle } from './detalle'

const datos = {
  campana: {
    id: 'c-1', asunto: 'Ofertas de octubre', mensaje: 'Hola <b>mundo</b>\nSegunda línea', estado: 'completada', creada_en: '2026-10-30T15:05:00Z',
    autor: 'Ana Admin', empresa_id: null, destinatarios: 3, enviados: 1, fallidos: 1, omitidos: 1, pendientes: 0, bajas: 1,
  },
  total: 3,
  destinatarios: [
    { cliente_id: 'k-1', nombre: 'Alfa', correo: 'alfa@example.com', estado: 'enviado', error: null, baja: true },
    { cliente_id: 'k-2', nombre: 'Beta', correo: 'beta@example.com', estado: 'fallido', error: 'No se pudo entregar', baja: false },
    { cliente_id: 'k-3', nombre: 'Gama', correo: 'gama@example.com', estado: 'omitido', error: null, baja: false },
  ],
}

const abrir = () => render(
  <MemoryRouter initialEntries={['/clientes/correo-masivo/historial/c-1']}>
    <Routes><Route path="/clientes/correo-masivo/historial/:id" element={<CorreoMasivoDetalle />} /></Routes>
  </MemoryRouter>,
)

// F-CLI-13, FR-031 y FR-033. [MSF-376:T023] [F-CLI-13#2]
describe('Correo masivo · Detalle de campaña', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useDetalle.mockReturnValue({ datos, noExiste: false, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch })
  })

  it('FR-031: muestra el asunto y el mensaje enviados como texto (nunca HTML)', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Ofertas de octubre' })).toBeInTheDocument()
    expect(screen.getByLabelText('Mensaje enviado').textContent).toBe('Hola <b>mundo</b>\nSegunda línea')
    expect(document.querySelector('b')).toBeNull()
  })

  it('FR-031: lista cada destinatario con cliente, correo usado, estado y error corto', () => {
    abrir()
    const filas = screen.getAllByRole('row')
    const beta = within(filas[2])
    expect(beta.getByText('Beta')).toBeInTheDocument()
    expect(beta.getByText('beta@example.com')).toBeInTheDocument()
    expect(beta.getByText('Fallido')).toBeInTheDocument()
    expect(beta.getByText('No se pudo entregar')).toBeInTheDocument()
  })

  it('FR-033: cuenta y marca las bajas de la campaña', () => {
    abrir()
    expect(screen.getByText(/1 baja\b/)).toBeInTheDocument()
    expect(within(screen.getAllByRole('row')[1]).getByText('Se dio de baja')).toBeInTheDocument()
  })

  it('FR-034: sin acciones de edición ni reenvío', () => {
    abrir()
    expect(screen.queryByRole('button', { name: /editar|borrar|eliminar|reenviar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al historial' })).toHaveAttribute('href', '/clientes/correo-masivo/historial')
  })

  it('FR-035: campaña inexistente o de otra organización', () => {
    mocks.useDetalle.mockReturnValue({ datos: null, noExiste: true, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch })
    abrir()
    expect(screen.getByText('No encontramos esa campaña.')).toBeInTheDocument()
  })

  it('FR-035: error con reintento', () => {
    mocks.useDetalle.mockReturnValue({ datos: null, noExiste: false, isLoading: false, isFetching: false, isError: true, refetch: mocks.refetch })
    abrir()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
