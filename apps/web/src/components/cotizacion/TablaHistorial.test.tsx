import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CargaCotizacion } from '../../lib/cotizacionHistorial'
import { TablaHistorial } from './TablaHistorial'

// matchMedia que evalúa `max-width` / `min-width` contra un ancho de ventana simulado.
function simularAncho(ancho: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const matches = (!max || ancho <= Number(max[1])) && (!min || ancho >= Number(min[1]))
    return {
      matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }
  }) as unknown as typeof window.matchMedia
}

const carga = (n: number, extra: Partial<CargaCotizacion> = {}): CargaCotizacion => ({
  id: `c-${n}`,
  cargadaEn: '2026-09-25T12:12:00Z',
  valor: 1465,
  variacionPct: 0.69,
  cargadaPorNombre: 'Javier',
  recalculoAplicado: true,
  preciosRecalculados: 89,
  ...extra,
})

const FILAS = [
  carga(1),
  carga(2, { cargadaEn: '2026-09-24T12:30:00Z', valor: 1455, variacionPct: -1.2, cargadaPorNombre: null, recalculoAplicado: false, preciosRecalculados: 0 }),
  carga(3, { cargadaEn: '2026-09-23T13:02:00Z', valor: 1450, variacionPct: null, preciosRecalculados: 1 }),
]

const props = {
  filas: FILAS,
  numeroPagina: 1,
  haySiguiente: false,
  hayAnterior: false,
  cargando: false,
  hayError: false,
  onSiguiente: vi.fn(),
  onAnterior: vi.fn(),
  onReintentar: vi.fn(),
}

describe('TablaHistorial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    simularAncho(1440)
  })
  afterEach(() => vi.restoreAllMocks())

  it('muestra título, subtítulo, columnas y el pie de trazabilidad', () => {
    render(<TablaHistorial {...props} />)
    expect(screen.getByRole('heading', { name: 'Historial de cargas' })).toBeInTheDocument()
    expect(screen.getByText('Quién cargó cada valor y qué se recalculó')).toBeInTheDocument()
    for (const nombre of ['Fecha', 'Valor', 'Variación', 'Cargó', 'Precios']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(screen.queryByRole('columnheader', { name: 'Mercado Libre' })).not.toBeInTheDocument()
    expect(screen.getByText('Cada cambio de precio guarda la cotización usada, para reconstruir la rentabilidad de cualquier fecha.')).toBeInTheDocument()
  })

  it('cada fila trae fecha con hora, valor, variación, quién cargó y precios', () => {
    render(<TablaHistorial {...props} />)
    const filas = screen.getAllByRole('row')
    const primera = within(filas[1])
    expect(primera.getByText('vie 25/09 · 09:12')).toBeInTheDocument()
    expect(primera.getByText('$ 1.465')).toBeInTheDocument()
    expect(primera.getByText('+0,7 %')).toBeInTheDocument()
    expect(primera.getByText('Javier')).toBeInTheDocument()
    expect(primera.getByText('89 precios')).toBeInTheDocument()
    const segunda = within(filas[2])
    expect(segunda.getByText('−1,2 %')).toBeInTheDocument()
    expect(segunda.getByText('Sin cambios (< 1 %)')).toBeInTheDocument()
    expect(segunda.getByText('—')).toBeInTheDocument() // quién cargó ya no existe
    const tercera = within(filas[3])
    expect(tercera.getAllByText('—')).toHaveLength(1) // primera carga: sin variación
    expect(tercera.getByText('1 precio')).toBeInTheDocument()
  })

  it('la variación lleva tono: sube advertencia, baja éxito, sin dato neutro', () => {
    render(<TablaHistorial {...props} />)
    expect(screen.getByText('+0,7 %').closest('.MuiChip-root')).toHaveClass('MuiChip-colorWarning')
    expect(screen.getByText('−1,2 %').closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess')
    const neutra = within(screen.getAllByRole('row')[3]).getAllByText('—')[0].closest('.MuiChip-root')
    expect(neutra).toHaveClass('MuiChip-colorDefault')
  })

  it('pagina por cursor: Siguiente y Anterior según haya más páginas', () => {
    const { rerender } = render(<TablaHistorial {...props} haySiguiente />)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(props.onSiguiente).toHaveBeenCalledTimes(1)
    rerender(<TablaHistorial {...props} numeroPagina={2} hayAnterior />)
    expect(screen.getByText('Página 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(props.onAnterior).toHaveBeenCalledTimes(1)
  })

  it('vacío: estado compartido, sin tabla, y mantiene el pie', () => {
    render(<TablaHistorial {...props} filas={[]} />)
    expect(screen.getByText('Todavía no hay cargas')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('cargando: estado de carga, sin tabla', () => {
    render(<TablaHistorial {...props} filas={[]} cargando />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay cargas')).not.toBeInTheDocument()
  })

  it('error: mensaje claro y reintento', () => {
    render(<TablaHistorial {...props} filas={[]} hayError />)
    expect(screen.getByText('No pudimos leer el historial de cargas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(props.onReintentar).toHaveBeenCalledTimes(1)
  })

  it.each([
    [1440, true],
    [768, true],
    [320, false],
  ])('a %i px %s tabla', (ancho, esTabla) => {
    simularAncho(ancho)
    render(<TablaHistorial {...props} />)
    if (esTabla) expect(screen.getByRole('table', { name: 'Historial de cargas de la cotización' })).toBeInTheDocument()
    else expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // Los mismos datos en cualquier ancho.
    expect(screen.getAllByText('89 precios').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Javier').length).toBeGreaterThan(0)
  })
})
