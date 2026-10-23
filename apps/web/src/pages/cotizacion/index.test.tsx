import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEstadoCotizacion: vi.fn(),
  useNivelSeccion: vi.fn(),
  recargar: vi.fn(),
}))
vi.mock('../../hooks/useCotizacion', () => ({
  useEstadoCotizacion: mocks.useEstadoCotizacion,
  useCargarCotizacion: () => ({ cargar: vi.fn(), enviando: false }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../../components/cotizacion/DialogoCargarDolar', () => ({
  DialogoCargarDolar: ({ onCerrar, onCargada }: { onCerrar: () => void; onCargada: (c: unknown) => void }) => (
    <div role="dialog" aria-label="Cargar dólar del día">
      <button onClick={onCerrar}>Cerrar diálogo</button>
      <button onClick={() => onCargada({ valor: 1490 })}>Simular carga</button>
    </div>
  ),
}))

import { AVISO_COTIZACION_CARGADA, CotizacionPage } from './index'

const ESTADO = {
  vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' },
  productosUsd: 38,
  pendiente: null,
}

const montar = (
  { estado = ESTADO, nivel = 'edicion', cargando = false, hayError = false }: { estado?: unknown; nivel?: string; cargando?: boolean; hayError?: boolean } = {},
) => {
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

  it('tras cargar cierra el diálogo, avisa que queda pendiente y recarga el estado', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar cotización' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Simular carga' }))
    expect(await screen.findByText(AVISO_COTIZACION_CARGADA)).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
})
