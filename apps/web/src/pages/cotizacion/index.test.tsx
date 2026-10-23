import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEstadoCotizacion: vi.fn(),
  useNivelSeccion: vi.fn(),
  recargar: vi.fn(),
  useCotizacionDelDia: vi.fn(),
  recargarHistorial: vi.fn(),
}))
vi.mock('../../hooks/useCotizacion', () => ({
  useEstadoCotizacion: mocks.useEstadoCotizacion,
  useCargarCotizacion: () => ({ cargar: vi.fn(), enviando: false }),
}))
vi.mock('../../hooks/useCotizacionDelDia', () => ({ useCotizacionDelDia: mocks.useCotizacionDelDia }))
vi.mock('../../hooks/useHistorialCargasCotizacion', () => ({
  useHistorialCargasCotizacion: () => ({
    filas: [], numeroPagina: 1, haySiguiente: false, hayAnterior: false, cargando: false, hayError: false,
    siguiente: vi.fn(), anterior: vi.fn(), recargar: mocks.recargarHistorial,
  }),
}))
vi.mock('../../components/cotizacion/AvisoCotizacion', () => ({ AvisoCotizacion: () => <div>Aviso montado</div> }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../../components/cotizacion/DialogoCargarDolar', () => ({
  DialogoCargarDolar: ({ onCerrar, onConfirmada }: { onCerrar: () => void; onConfirmada: (c: unknown) => void }) => (
    <div role="dialog" aria-label="Cargar dólar del día">
      <button onClick={onCerrar}>Cerrar diálogo</button>
      <button onClick={() => onConfirmada({ id: 'c1', recalculoAplicado: true, preciosRecalculados: 89 })}>Simular recálculo</button>
      <button onClick={() => onConfirmada({ id: 'c2', recalculoAplicado: false, preciosRecalculados: 0 })}>Simular registro</button>
    </div>
  ),
}))

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { CotizacionPage } from './index'

const ESTADO = {
  vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' },
  productosUsd: 38,
  pendiente: null,
}

const SIN_CARGA_HOY = { cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null }

const montar = (
  { estado = ESTADO, nivel = 'edicion', cargando = false, hayError = false, delDia = SIN_CARGA_HOY }: { estado?: unknown; nivel?: string; cargando?: boolean; hayError?: boolean; delDia?: unknown } = {},
) => {
  mocks.useCotizacionDelDia.mockReturnValue({ delDia, cargando: false, hayError: false, recargar: vi.fn() })
  mocks.useEstadoCotizacion.mockReturnValue({ estado, cargando, hayError, recargar: mocks.recargar })
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  return render(<CotizacionPage />)
}

describe('CotizacionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el encabezado y la tarjeta «Vigente» con valor, última carga y productos en USD', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Cotización del dólar' })).toBeInTheDocument()
    expect(screen.getByText('Valor que se carga cada día para calcular los precios de los productos en USD.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vigente' })).toBeInTheDocument()
    expect(screen.getByText('$ 1.465')).toBeInTheDocument()
    expect(screen.getByText('Última carga: vie 25/09 por Javier')).toBeInTheDocument()
    expect(screen.getByText('Productos con precio en USD')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText('Organización: Uno')).toBeInTheDocument()
  })

  it('con edición ofrece «Cargar cotización»', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Cargar cotización' })).toBeEnabled()
  })

  it.each(['lectura', 'ninguno'])('con %s no ofrece «Cargar cotización» pero sí la cotización', (nivel) => {
    montar({ nivel })
    expect(screen.queryByRole('button', { name: 'Cargar cotización' })).not.toBeInTheDocument()
    expect(screen.getByText('$ 1.465')).toBeInTheDocument()
  })

  it('abre el diálogo (carga diferida) y lo cierra', async () => {
    montar()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar cotización' }))
    expect(await screen.findByRole('dialog', { name: 'Cargar dólar del día' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('tras confirmar con recálculo cierra el diálogo, avisa cuántos precios y recarga el estado', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar cotización' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Simular recálculo' }))
    expect(await screen.findByText('Cotización aplicada · 89 precios recalculados')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tras confirmar bajo el umbral avisa que solo se registró y los precios no cambiaron', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar cotización' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Simular registro' }))
    expect(await screen.findByText('Cotización registrada · variación menor al umbral, precios sin cambios')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
  })

  it('cambiar la empresa activa de la barra superior no cambia la pantalla ni recarga (la cotización es de la organización)', () => {
    montar()
    expect(screen.getByText('$ 1.465')).toBeInTheDocument()
    act(() => notificarEmpresaActivaCambiada())
    expect(screen.getByText('$ 1.465')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText('Última carga: vie 25/09 por Javier')).toBeInTheDocument()
    expect(mocks.recargar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cargar cotización' })).toBeEnabled()
  })

  it('mientras carga muestra el estado de carga compartido', () => {
    montar({ estado: null, cargando: true })
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByText('$ 1.465')).not.toBeInTheDocument()
  })

  it('ante un error muestra el estado de error con «Reintentar»', () => {
    montar({ estado: null, hayError: true })
    expect(screen.getByText('No pudimos leer la cotización del dólar.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
  })

  it('sin cotización cargada muestra el estado vacío (y no inventa un valor)', () => {
    montar({ estado: { vigente: null, productosUsd: 0, pendiente: null } })
    expect(screen.getByText('Todavía no hay una cotización cargada')).toBeInTheDocument()
    expect(screen.getByText('Cargá el dólar del día para calcular los precios de los productos en USD.')).toBeInTheDocument()
  })

  it('el estado vacío sin edición no invita a cargar', () => {
    montar({ estado: { vigente: null, productosUsd: 0, pendiente: null }, nivel: 'lectura' })
    expect(screen.getByText('Cuando se cargue el dólar del día lo vas a ver acá.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar cotización' })).not.toBeInTheDocument()
  })
  it('monta el aviso de cotización no cargada (FR-021)', () => {
    montar()
    expect(screen.getByText('Aviso montado')).toBeInTheDocument()
  })

  it('sin carga hoy, la tarjeta dice «Sin cargar hoy» y conserva la última carga (FR-022)', () => {
    montar()
    expect(screen.getByText('Sin cargar hoy')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
    expect(screen.getByText('Última carga: vie 25/09 por Javier')).toBeInTheDocument()
  })

  it('con carga hoy, la tarjeta dice «Al día» y «Cargada hoy <hora> por <quién>» (FR-022)', () => {
    montar({ delDia: { cargadaHoy: true, cargadaEn: '2026-10-23T13:32:00Z', cargadaPor: 'Administrador', valor: 1490 } })
    expect(screen.getByText('Al día')).toBeInTheDocument()
    expect(screen.queryByText('Sin cargar hoy')).not.toBeInTheDocument()
    expect(screen.getByText('Cargada hoy 10:32 por Administrador')).toBeInTheDocument()
  })

  it('sin saber si se cargó hoy (cargando o con error), la tarjeta no muestra indicador', () => {
    montar({ delDia: null as never })
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin cargar hoy')).not.toBeInTheDocument()
    expect(screen.getByText('Última carga: vie 25/09 por Javier')).toBeInTheDocument()
  })
})
