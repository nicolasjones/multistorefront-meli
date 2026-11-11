import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
vi.mock('../../components/service/EnlaceSeguimientoDialog', () => ({
  EnlaceSeguimientoDialog: ({ codigo, onCerrar }: { codigo: string; onCerrar: () => void }) => (
    <div role="dialog" aria-label={`Enlace de ${codigo}`}><button onClick={onCerrar}>Cerrar enlace</button></div>
  ),
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

const abrirDetalle = () =>
  render(
    <MemoryRouter initialEntries={['/service-tecnico/reparaciones/r-1']}>
      <Routes>
        <Route
          path="/service-tecnico/reparaciones/:id"
          element={<ServicioReparacion />}
        />
      </Routes>
    </MemoryRouter>,
  )

describe('Service técnico · Enlace de seguimiento en el detalle (FR-046)', () => {
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
  })

  it('con edición ofrece «Enlace de seguimiento» y abre el diálogo de la reparación', async () => {
    abrirDetalle()
    fireEvent.click(await screen.findByRole('button', { name: 'Enlace de seguimiento' }))
    expect(await screen.findByRole('dialog', { name: 'Enlace de R-0001' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar enlace' }))
    expect(screen.queryByRole('dialog', { name: 'Enlace de R-0001' })).not.toBeInTheDocument()
  })

  it('con lectura el botón no aparece', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrirDetalle()
    expect(await screen.findByText('Estado: Entregado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enlace de seguimiento' })).not.toBeInTheDocument()
  })
})
