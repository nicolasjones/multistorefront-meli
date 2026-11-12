import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEstadoCotizacion: vi.fn(),
  useCotizacionDelDia: vi.fn(),
  useNivelSeccion: vi.fn(),
  recargarEstado: vi.fn(),
  recargarDia: vi.fn(),
  configuracion: vi.fn(),
  empresaActivaId: vi.fn(),
}))
vi.mock('../../hooks/useConfiguracionCotizacion', () => ({ useConfiguracionCotizacion: () => mocks.configuracion() }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({ empresas: [{ id: 'e-1', nombre: 'Mundo JC' }], empresaActivaId: mocks.empresaActivaId() }),
}))
vi.mock('../../hooks/useCotizacion', () => ({ useEstadoCotizacion: mocks.useEstadoCotizacion }))
vi.mock('../../hooks/useCotizacionDelDia', () => ({ useCotizacionDelDia: mocks.useCotizacionDelDia }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('./DialogoCargarDolar', () => ({
  DialogoCargarDolar: ({ onCerrar, onConfirmada }: { onCerrar: () => void; onConfirmada: (c: unknown) => void }) => (
    <div role="dialog" aria-label="Cargar dólar del día">
      <button onClick={onCerrar}>Cerrar diálogo</button>
      <button onClick={() => onConfirmada({ recalculoAplicado: false, preciosRecalculados: 0 })}>Simular carga</button>
    </div>
  ),
}))

import { AvisoCotizacion } from './AvisoCotizacion'

const ESTADO = {
  vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' },
  productosUsd: 38,
  pendiente: null,
}
const SIN_CARGA_HOY = { cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null, avisoActivo: true }
const CARGADA_HOY = { cargadaHoy: true, cargadaEn: '2026-10-23T13:32:00Z', cargadaPor: 'Administrador', valor: 1490, avisoActivo: true }
const CONFIGURACION = { alcance: 'sistema', redondeoPesos: 10, umbralPct: 1, confirmacionPct: 15, avisoActivo: true }

type Opciones = { empresaActiva?: string | null; configuracion?: unknown; nivel?: string | null; estado?: unknown; delDia?: unknown; cargando?: boolean; hayError?: boolean }

const montar = ({ empresaActiva = 'e-1', configuracion = CONFIGURACION, nivel = 'edicion', estado = ESTADO, delDia = SIN_CARGA_HOY, cargando = false, hayError = false }: Opciones = {}) => {
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.configuracion.mockReturnValue({ configuracion, cargando: false, hayError: false, recargar: vi.fn() })
  mocks.empresaActivaId.mockReturnValue(empresaActiva)
  mocks.useEstadoCotizacion.mockReturnValue({ estado, cargando, hayError, recargar: mocks.recargarEstado })
  mocks.useCotizacionDelDia.mockReturnValue({ delDia, cargando, hayError: false, recargar: mocks.recargarDia })
  return render(<AvisoCotizacion />)
}

describe('AvisoCotizacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sin carga hoy avisa con el valor vigente y su última carga (FR-020)', () => {
    montar()
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(
      screen.getByText('Los precios en dólares se siguen calculando con $ 1.465 (Última carga: vie 25/09 por Javier).'),
    ).toBeInTheDocument()
  })

  it('con una carga confirmada hoy el aviso no aparece', () => {
    montar({ delDia: CARGADA_HOY })
    expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar ahora' })).not.toBeInTheDocument()
  })

  it('«Cargar ahora» abre el diálogo «Cargar dólar del día» (carga diferida) y se puede cerrar', async () => {
    montar()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    expect(await screen.findByRole('dialog', { name: 'Cargar dólar del día' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('tras cargar cierra el diálogo, avisa que queda pendiente y vuelve a consultar «hoy»', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar ahora' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Simular carga' }))
    expect(await screen.findByText('Cotización registrada · variación menor al umbral, precios sin cambios')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.recargarDia).toHaveBeenCalledTimes(1)
  })

  it.each(['lectura'])('con %s ve el aviso pero no «Cargar ahora»', (nivel) => {
    montar({ nivel })
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar ahora' })).not.toBeInTheDocument()
  })

  it.each(['ninguno', null])('con nivel %s no muestra nada ni consulta la cotización', (nivel) => {
    const { container } = montar({ nivel })
    expect(container).toBeEmptyDOMElement()
    expect(mocks.useEstadoCotizacion).not.toHaveBeenCalled()
    expect(mocks.useCotizacionDelDia).not.toHaveBeenCalled()
  })

  it('mientras carga no muestra el aviso (evita un parpadeo falso)', () => {
    const { container } = montar({ cargando: true, estado: null, delDia: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('si no hay ninguna cotización vigente lo dice sin inventar un valor', () => {
    montar({ estado: { ...ESTADO, vigente: null } })
    expect(screen.getByText('Todavía no hay una cotización vigente para calcular los precios en dólares.')).toBeInTheDocument()
  })

  it('un error no queda en silencio: avisa y permite reintentar', () => {
    montar({ hayError: true, estado: null, delDia: null })
    expect(screen.getByText('No pudimos comprobar si se cargó el dólar de hoy.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargarEstado).toHaveBeenCalledTimes(1)
    expect(mocks.recargarDia).toHaveBeenCalledTimes(1)
  })

  it('con «Aviso en Inicio» apagado no avisa aunque no se haya cargado el dólar (F-PRE-06)', () => {
    montar({ delDia: { ...SIN_CARGA_HOY, avisoActivo: false } })
    expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
  })

  it('con alcance por empresa pide el estado de la empresa activa y no ofrece cargar en «Todas mis empresas»', () => {
    const porEmpresa = { ...CONFIGURACION, alcance: 'empresa' }
    montar({ configuracion: porEmpresa })
    expect(mocks.useEstadoCotizacion).toHaveBeenLastCalledWith('e-1')
    expect(mocks.useCotizacionDelDia).toHaveBeenLastCalledWith(true, 'e-1')
    expect(screen.getByRole('button', { name: 'Cargar ahora' })).toBeInTheDocument()
    cleanup()
    montar({ configuracion: porEmpresa, empresaActiva: null })
    expect(mocks.useEstadoCotizacion).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('button', { name: 'Cargar ahora' })).not.toBeInTheDocument()
  })

  it('con alcance por empresa y «Todas mis empresas» pide elegir una empresa (no muestra una cotización que no es de nadie)', () => {
    montar({ configuracion: { ...CONFIGURACION, alcance: 'empresa' }, empresaActiva: null })
    expect(screen.getByText('Todavía no se cargó el dólar de hoy')).toBeInTheDocument()
    expect(screen.getByText('La cotización es una por empresa: elegí una empresa en la barra superior para ver y cargar su dólar de hoy.')).toBeInTheDocument()
    expect(screen.queryByText(/se siguen calculando/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar ahora' })).not.toBeInTheDocument()
  })

  it('con alcance por empresa y una empresa elegida no pide elegir otra', () => {
    montar({ configuracion: { ...CONFIGURACION, alcance: 'empresa' }, empresaActiva: 'e-1' })
    expect(screen.queryByText(/elegí una empresa/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar ahora' })).toBeInTheDocument()
  })

  it('informa la cotización APLICADA (la de los precios) aunque la última carga haya quedado bajo el umbral', () => {
    montar({ estado: { ...ESTADO, aplicada: 1000, vigente: { valor: 1040, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' } } })
    expect(screen.getByText('Los precios en dólares se siguen calculando con $ 1.000.')).toBeInTheDocument()
  })
})
