import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ estado: vi.fn(), dia: vi.fn(), config: vi.fn(), empresas: vi.fn(), recargarEstado: vi.fn(), recargarDia: vi.fn() }))
vi.mock('../../../hooks/useCotizacion', () => ({ useEstadoCotizacion: mocks.estado }))
vi.mock('../../../hooks/useCotizacionDelDia', () => ({ useCotizacionDelDia: mocks.dia }))
vi.mock('../../../hooks/useConfiguracionCotizacion', () => ({ useConfiguracionCotizacion: mocks.config }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.empresas }))
// El diálogo real se prueba en su propio archivo: acá se verifica cuándo y con qué datos se monta.
vi.mock('../../../components/cotizacion/DialogoCargarDolarConImpacto', () => ({
  DialogoCargarDolarConImpacto: (props: { empresaId: string | null; nombreEmpresa: string | null; confirmacionPct?: number; onConfirmada: (c: unknown) => void; onCerrar: () => void }) => (
    <div role="dialog" aria-label="Cargar dólar del día">
      <span>empresa:{props.empresaId ?? 'ninguna'}</span>
      <span>pct:{props.confirmacionPct}</span>
      <button onClick={() => props.onConfirmada({ id: 'c1', recalculoAplicado: true, preciosRecalculados: 60 })}>confirmar</button>
      <button onClick={() => props.onConfirmada({ id: 'c2', recalculoAplicado: false, preciosRecalculados: 0 })}>registrar</button>
      <button onClick={props.onCerrar}>cerrar</button>
    </div>
  ),
}))

import { TarjetaDolar } from '../TarjetaDolar'

const VIGENTE = { vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }, aplicada: 1465, productosUsd: 3, pendiente: null }
const SIN_CARGAR = { cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null }
const montar = (puedeEditar: boolean, delDia: unknown, alcance: 'sistema' | 'empresa' = 'sistema', empresaActiva: string | null = null) => {
  mocks.config.mockReturnValue({ configuracion: { alcance, redondeoPesos: 10, umbralPct: 1, confirmacionPct: 15, avisoActivo: true }, cargando: false, hayError: false, recargar: vi.fn() })
  mocks.empresas.mockReturnValue({ empresas: [{ id: 'e1', nombre: 'Mundo JC' }, { id: 'e2', nombre: 'San Javucho' }], empresaActivaId: empresaActiva, isLoading: false, isError: false })
  mocks.estado.mockReturnValue({ estado: VIGENTE, cargando: false, hayError: false, recargar: mocks.recargarEstado })
  mocks.dia.mockReturnValue({ delDia, cargando: false, hayError: false, recargar: mocks.recargarDia })
  return render(<TarjetaDolar puedeEditar={puedeEditar} />)
}

describe('Tarjeta de dólar (FR-006, F-INI-07)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cargado hoy: muestra la cotización vigente y no avisa', () => {
    montar(true, { cargadaHoy: true, cargadaEn: '2026-10-23T13:00:00Z', cargadaPor: 'Admin', valor: 1490 })
    expect(screen.getByText(/1\.465/)).toBeInTheDocument()
    expect(screen.getByText(/Última carga/)).toBeInTheDocument()
    expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
  })

  it('sin cargar hoy con edición: avisa y «Cargar ahora» abre el diálogo (CA-INI-07-1)', async () => {
    montar(true, SIN_CARGAR)
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    expect(await screen.findByRole('dialog', { name: 'Cargar dólar del día' })).toBeInTheDocument()
    expect(screen.getByText('pct:15')).toBeInTheDocument()
  })

  it('sin edición (operador) no ve el aviso ni el botón (CA-INI-07-7)', () => {
    montar(false, SIN_CARGAR)
    expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar ahora' })).not.toBeInTheDocument()
    expect(screen.getByText(/1\.465/)).toBeInTheDocument()
  })

  it('al confirmar cierra el diálogo, actualiza el aviso y recarga sin recargar la página (CA-INI-07-5)', async () => {
    montar(true, SIN_CARGAR)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    fireEvent.click(await screen.findByRole('button', { name: 'confirmar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Cotización aplicada · 60 precios recalculados')).toBeInTheDocument()
    expect(mocks.recargarEstado).toHaveBeenCalled()
    expect(mocks.recargarDia).toHaveBeenCalled()
  })

  it('bajo el umbral avisa que solo se registró', async () => {
    montar(true, SIN_CARGAR)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    fireEvent.click(await screen.findByRole('button', { name: 'registrar' }))
    expect(screen.getByText(/Cotización registrada · variación menor al umbral/)).toBeInTheDocument()
  })

  it('cancelar cierra sin avisar ni recargar (CA-INI-07-6)', async () => {
    montar(true, SIN_CARGAR)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    fireEvent.click(await screen.findByRole('button', { name: 'cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.recargarEstado).not.toHaveBeenCalled()
  })

  it('con alcance por empresa y una empresa elegida, el diálogo es de esa empresa', async () => {
    montar(true, SIN_CARGAR, 'empresa', 'e1')
    expect(mocks.estado).toHaveBeenCalledWith('e1', true)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    expect(await screen.findByText('empresa:e1')).toBeInTheDocument()
  })

  it('con alcance por empresa y «Todas mis empresas», pide elegir una y no abre el diálogo', () => {
    montar(true, SIN_CARGAR, 'empresa', null)
    expect(screen.getByText(/Elegí una empresa en la barra superior/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar ahora' })).toBeDisabled()
  })
})
