import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useHistorial: vi.fn(), useNivelSeccion: vi.fn(), refetch: vi.fn(), elegirEmpresa: vi.fn() }))

vi.mock('../../../hooks/useHistorialCorreoMasivo', () => ({ useHistorialCorreoMasivo: mocks.useHistorial }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({
  useFiltroPorEmpresaActiva: () => ({
    empresas: [{ id: 'e-1', nombre: 'San Javucho' }], valor: null, cambiar: mocks.elegirEmpresa, empresaActivaId: null, cargando: false, hayError: false,
  }),
}))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CorreoMasivoHistorial } from './historial'
import type { CampanaHistorial } from '../../../lib/correoMasivoHistorial'

const campana = (n: number, extra: Partial<CampanaHistorial> = {}): CampanaHistorial => ({
  id: `c-${n}`, creada_en: '2026-10-30T15:05:00Z', asunto: `Asunto ${n}`, autor: 'Ana Admin', estado: 'completada',
  destinatarios: 10, enviados: 7, fallidos: 1, omitidos: 2, pendientes: 0, bajas: 3, ...extra,
})

const respuesta = (sobre: object = {}) => ({
  filas: [campana(2), campana(1)], total: 2, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...sobre,
})

const abrir = () => render(
  <MemoryRouter initialEntries={['/clientes/correo-masivo/historial']}>
    <Routes><Route path="/clientes/correo-masivo/historial" element={<CorreoMasivoHistorial />} /></Routes>
  </MemoryRouter>,
)

// F-CLI-13, FR-030 y FR-035. [MSF-376:T022] [MSF-376:T024] [F-CLI-13#1]
describe('Correo masivo · Historial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    mocks.useHistorial.mockReturnValue(respuesta())
  })

  it('FR-030: lista las campañas en el orden recibido con fecha, asunto, autor, estado y totales', () => {
    abrir()
    const filas = screen.getAllByRole('row')
    expect(within(filas[1]).getByText('Asunto 2')).toBeInTheDocument()
    expect(within(filas[2]).getByText('Asunto 1')).toBeInTheDocument()
    for (const encabezado of ['Fecha', 'Asunto', 'Enviada por', 'Estado', 'Destinatarios', 'Enviados', 'Fallidos', 'Omitidos', 'Bajas']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    const primera = within(filas[1])
    expect(primera.getByText('30/10/2026 12:05')).toBeInTheDocument()
    expect(primera.getByText('Ana Admin')).toBeInTheDocument()
    expect(primera.getByText('Completada')).toBeInTheDocument()
    expect(primera.getAllByRole('cell').map((c) => c.textContent).slice(-5)).toEqual(['10', '7', '1', '2', '3'])
  })

  it('una campaña en curso muestra su progreso', () => {
    mocks.useHistorial.mockReturnValue(respuesta({ filas: [campana(1, { estado: 'en_curso', pendientes: 4 })], total: 1 }))
    abrir()
    expect(screen.getByText('En curso')).toBeInTheDocument()
    expect(screen.getByText('6 de 10 procesados')).toBeInTheDocument()
  })

  it('FR-030: pide la página al cambiar de página', () => {
    mocks.useHistorial.mockReturnValue(respuesta({ total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    expect(mocks.useHistorial).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 2, tamano: 25 }))
  })

  it('FR-035: cada asunto es un enlace por teclado al detalle', () => {
    abrir()
    expect(screen.getByRole('link', { name: 'Ver la campaña Asunto 2' })).toHaveAttribute('href', '/clientes/correo-masivo/historial/c-2')
  })

  it('FR-034: es solo lectura (sin editar, borrar ni reenviar) y «Nueva campaña» no se ofrece con lectura', () => {
    abrir()
    expect(screen.queryByRole('button', { name: /editar|borrar|eliminar|reenviar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Nueva campaña' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true')
  })

  it('FR-035: con edición se ofrece «Nueva campaña»', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    abrir()
    expect(screen.getByRole('tab', { name: 'Nueva campaña' })).toHaveAttribute('href', '/clientes/correo-masivo')
  })

  it('FR-035: carga', () => {
    mocks.useHistorial.mockReturnValue(respuesta({ filas: [], total: 0, isLoading: true, isFetching: true }))
    abrir()
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
  })

  it('FR-035: vacío «Todavía no se envió ninguna campaña»', () => {
    mocks.useHistorial.mockReturnValue(respuesta({ filas: [], total: 0 }))
    abrir()
    expect(screen.getByText('Todavía no se envió ninguna campaña')).toBeInTheDocument()
  })

  it('FR-035: error con reintento', () => {
    mocks.useHistorial.mockReturnValue(respuesta({ filas: [], total: 0, isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar el historial de campañas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('FR-035: éxito anunciado al lector de pantalla', () => {
    abrir()
    expect(screen.getAllByRole('status').some((s) => s.textContent === '2 campañas')).toBe(true)
  })

  it('FR-034: sin acceso a Clientes no se ve el historial', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    abrir()
    expect(screen.getByText('Sin permiso')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
