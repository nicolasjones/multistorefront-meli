import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  usePuedeAccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  listarModelos: vi.fn(),
  listarEstados: vi.fn(),
  listarHistorial: vi.fn(),
  listarTecnicos: vi.fn(),
  obtenerReparacion: vi.fn(),
  reingresarPorGarantia: vi.fn(),
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
// F-SVC-20 y F-SVC-21: las secciones de fotos y de vínculos tienen su propio test.
vi.mock('../../components/service/AdjuntosReparacion', () => ({ AdjuntosReparacion: () => null }))
vi.mock('../../components/service/VinculosGarantia', () => ({ VinculosGarantia: () => null }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/serviceTecnico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/serviceTecnico')>()),
  listarModelos: mocks.listarModelos,
  listarEstados: mocks.listarEstados,
}))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  listarTecnicos: mocks.listarTecnicos,
  listarHistorial: mocks.listarHistorial,
  obtenerReparacion: mocks.obtenerReparacion,
}))
vi.mock('../../lib/reparacionGarantia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionGarantia')>()),
  reingresarPorGarantia: mocks.reingresarPorGarantia,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../components/service/ClienteSelector', () => ({ ClienteSelector: () => <div /> }))
vi.mock('../../components/service/AltaRapidaClienteDialog', () => ({ AltaRapidaClienteDialog: () => null }))

import { type Reparacion } from '../../lib/reparaciones'
import { ServicioReparacion } from './reparacion'

const REPARACION: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1',
  cliente: 'Ana Pérez', contacto: '', modelo_id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite',
  estado_id: 's-3', estado: 'Entregado', estado_cierra: true, estado_tono: 'exito', numero_serie: null,
  accesorios: '', falla: '', puede_ver_costos: false, costo_mano_obra: null, costo_repuestos: null,
  tecnico_id: null, ingreso_en: '2026-10-01', entrega_prevista: null, entrega_real: '2026-10-05',
  entregado_por: 'Ana', anulada_en: null, anulada_motivo: null, updated_at: '2026-10-05T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

const NUEVA: Reparacion = { ...REPARACION, id: 'r-2', numero: 2, codigo: 'R-0002' }

function RutaActual() {
  const ubicacion = useLocation()
  return <span data-testid="ruta">{ubicacion.pathname}</span>
}

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route
          path="/service-tecnico/reparaciones/:id"
          element={
            <>
              <ServicioReparacion />
              <RutaActual />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

describe('Service técnico · Reingreso por garantía en el detalle (FR-022, FR-024, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], empresaActivaId: 'e-1', isLoading: false, isError: false,
    })
    mocks.listarModelos.mockResolvedValue([])
    mocks.listarTecnicos.mockResolvedValue([])
    mocks.listarEstados.mockResolvedValue([])
    mocks.listarHistorial.mockResolvedValue([])
    mocks.obtenerReparacion.mockResolvedValue(REPARACION)
    mocks.reingresarPorGarantia.mockResolvedValue(NUEVA)
  })

  it('con edición y una reparación entregada ofrece el botón «Reingresar por garantía»', async () => {
    abrirDetalle()
    expect(await screen.findByRole('button', { name: 'Reingresar por garantía' })).toBeInTheDocument()
  })

  it('con lectura el botón no aparece', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrirDetalle()
    expect(await screen.findByText('Estado: Entregado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reingresar por garantía' })).not.toBeInTheDocument()
  })

  it('una reparación no entregada no ofrece el botón', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, entrega_real: null, estado_cierra: false, estado: 'Recibido' })
    abrirDetalle()
    expect(await screen.findByRole('combobox', { name: 'Estado' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reingresar por garantía' })).not.toBeInTheDocument()
  })

  it('una reparación anulada no ofrece el botón', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...REPARACION, anulada_en: '2026-10-06T10:00:00Z', anulada_motivo: 'Duplicada' })
    abrirDetalle()
    expect(await screen.findByText('Motivo: Duplicada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reingresar por garantía' })).not.toBeInTheDocument()
  })

  it('el botón abre el diálogo y, al reingresar, lleva al detalle de la nueva', async () => {
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Reingresar por garantía' }))
    const dialogo = await screen.findByRole('dialog', { name: /Reingresar por garantía · R-0001/ })
    fireEvent.change(within(dialogo).getByLabelText(/Falla del reingreso/), { target: { value: 'Se apaga sola' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    await waitFor(() => expect(mocks.reingresarPorGarantia).toHaveBeenCalledWith('r-1', {
      falla: 'Se apaga sola', tecnico: '', entrega_prevista: '',
    }))
    await waitFor(() =>
      expect(screen.getByTestId('ruta')).toHaveTextContent('/service-tecnico/reparaciones/r-2'),
    )
    expect(await screen.findByText('Reparación R-0002 creada por garantía')).toBeInTheDocument()
  })
})
