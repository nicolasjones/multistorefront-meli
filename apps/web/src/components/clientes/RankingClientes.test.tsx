import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useRankingClientes: vi.fn(), refetch: vi.fn(), usePuedeAccion: vi.fn(), exportar: vi.fn(), descargar: vi.fn() }))

vi.mock('../../hooks/usePuedeAccion', () => ({ usePuedeAccion: mocks.usePuedeAccion }))
vi.mock('../../lib/exportarRanking', async (original) => ({
  ...(await original<typeof import('../../lib/exportarRanking')>()),
  exportarRanking: mocks.exportar,
}))
vi.mock('../../lib/exportarClientes', async (original) => ({
  ...(await original<typeof import('../../lib/exportarClientes')>()),
  descargarArchivo: mocks.descargar,
}))

vi.mock('../../hooks/useRankingClientes', () => ({ useRankingClientes: mocks.useRankingClientes }))
vi.mock('../../lib/periodosRanking', async (original) => {
  const real = await original<typeof import('../../lib/periodosRanking')>()
  // «Hoy» fijo: 15/10/2026.
  return { ...real, rangoDeAtajo: (atajo: Parameters<typeof real.rangoDeAtajo>[0]) => real.rangoDeAtajo(atajo, new Date('2026-10-15T15:00:00Z')) }
})

import { ExportacionCancelada } from '../../lib/exportarClientes'
import type { FilaRanking } from '../../hooks/useRankingClientes'
import { RankingClientes } from './RankingClientes'

const fila = (n: number, extra: Partial<FilaRanking> = {}): FilaRanking => ({
  posicion: n, cliente_id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, tipo: 'minorista',
  comprobantes: 3, facturado: 1234567, participacion: 12.5, ...extra,
})

const respuesta = (filas: FilaRanking[], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const ultimosParametros = () => mocks.useRankingClientes.mock.calls.at(-1)![0]
const abrir = () => render(<MemoryRouter><RankingClientes /></MemoryRouter>)

describe('RankingClientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeAccion.mockReturnValue({ puede: false, isLoading: false })
    mocks.useRankingClientes.mockReturnValue(respuesta([fila(1), fila(2, { tipo: 'mayorista', facturado: 500000, participacion: 6.25 })]))
  })

  it('arranca en «Este mes», sin Consumidor final y sin IVA', () => {
    abrir()
    expect(ultimosParametros()).toEqual({
      desde: '2026-10-01', hasta: '2026-10-15', tipo: null, incluirConsumidorFinal: false, conIva: false, empresaId: null, pagina: 1, tamano: 25,
    })
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-10-15')
  })

  it('recibe la tienda elegida en la pantalla y la manda al ranking', () => {
    render(<MemoryRouter><RankingClientes empresaId="e-7" /></MemoryRouter>)
    expect(ultimosParametros().empresaId).toBe('e-7')
  })

  it('muestra las columnas, el formato argentino y el enlace a la ficha', () => {
    abrir()
    for (const encabezado of ['#', 'Cliente', 'Tipo', 'Comprobantes', 'Facturado (sin IVA)', 'Participación']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByText('$ 1.234.567')).toBeInTheDocument()
    expect(screen.getByText('12,5 %')).toBeInTheDocument()
    expect(screen.getByText('6,3 %')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Mayorista' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cliente 2' })).toHaveAttribute('href', '/clientes/show/c-2')
  })

  it('no consulta hasta pulsar «Aplicar» y luego manda el rango elegido volviendo a la página 1', () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-01' } })
    expect(ultimosParametros().desde).toBe('2026-10-01')
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(ultimosParametros()).toMatchObject({ desde: '2026-09-01', hasta: '2026-10-15', pagina: 1 })
  })

  it('con un rango inválido muestra el error en el campo y no consulta', () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('Hasta no puede ser anterior a Desde.')).toBeInTheDocument()
    expect(screen.getByLabelText('Hasta')).toBeInvalid()
    expect(ultimosParametros()).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15' })
  })

  it('con una fecha vacía indica el campo y no consulta', () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('Indicá la fecha Desde.')).toBeInTheDocument()
    expect(ultimosParametros().desde).toBe('2026-10-01')
  })

  it('los atajos completan Desde/Hasta y aplican', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-09-30')
    expect(ultimosParametros()).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-30' })
    fireEvent.click(screen.getByRole('button', { name: 'Año en curso' }))
    expect(ultimosParametros()).toMatchObject({ desde: '2026-01-01', hasta: '2026-10-15' })
    fireEvent.click(screen.getByRole('button', { name: 'Últimos 90 días' }))
    expect(ultimosParametros()).toMatchObject({ desde: '2026-07-18', hasta: '2026-10-15' })
    fireEvent.click(screen.getByRole('button', { name: 'Este mes' }))
    expect(ultimosParametros()).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15' })
  })

  it('el tipo, Consumidor final y «Ver con IVA» cambian la consulta y el rótulo de la base', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(ultimosParametros().tipo).toBe('mayorista')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Consumidor final' }))
    expect(ultimosParametros().incluirConsumidorFinal).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ver con IVA' }))
    expect(ultimosParametros().conIva).toBe(true)
    expect(screen.getByRole('columnheader', { name: 'Facturado (con IVA)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(ultimosParametros().tipo).toBeNull()
  })

  it('pagina en el servidor conservando período y filtros, y vuelve a la 1 al cambiar un filtro', () => {
    mocks.useRankingClientes.mockReturnValue(respuesta([fila(1)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Minorista' }))
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    expect(ultimosParametros()).toMatchObject({ pagina: 2, tipo: 'minorista', desde: '2026-10-01', hasta: '2026-10-15' })
    expect(screen.getByText('26–50 de 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ver con IVA' }))
    expect(ultimosParametros()).toMatchObject({ pagina: 1, conIva: true })
  })

  it('sin facturación muestra el vacío compartido', () => {
    mocks.useRankingClientes.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Sin facturación en el período')).toBeInTheDocument()
    expect(screen.getByText('Probá con otro rango de fechas.')).toBeInTheDocument()
  })

  it('ante un error muestra el estado de error y reintenta', () => {
    mocks.useRankingClientes.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('mientras carga muestra el estado de carga y no la tabla', () => {
    mocks.useRankingClientes.mockReturnValue(respuesta([], { isLoading: true, isFetching: true }))
    abrir()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  })

  it('no muestra identificadores internos', () => {
    abrir()
    expect(screen.queryByText(/c-1/)).not.toBeInTheDocument()
  })

  describe('Exportar a Excel (F-CLI-09)', () => {
    const permitir = () => mocks.usePuedeAccion.mockReturnValue({ puede: true, isLoading: false })

    it('no muestra el botón sin la acción exportar', () => {
      abrir()
      expect(mocks.usePuedeAccion).toHaveBeenCalledWith('clientes', 'exportar')
      expect(screen.queryByRole('button', { name: 'Exportar a Excel' })).not.toBeInTheDocument()
    })

    it('queda deshabilitado con el ranking vacío', () => {
      permitir()
      mocks.useRankingClientes.mockReturnValue(respuesta([]))
      abrir()
      expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
    })

    it('exporta con el período y los filtros aplicados, informa el progreso y confirma', async () => {
      permitir()
      mocks.exportar.mockImplementation(async (_p, { alProgresar }) => {
        alProgresar({ descargados: 10, total: 40 })
        return new Blob(['x'])
      })
      abrir()
      fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
      expect(mocks.exportar.mock.calls[0][0]).toEqual({
        desde: '2026-10-01', hasta: '2026-10-15', tipo: null, incluirConsumidorFinal: false, conIva: false, empresaId: null,
      })
      expect(await screen.findByText(/Exportación lista/)).toBeInTheDocument()
      expect(mocks.descargar.mock.calls[0][1]).toBe('ranking-clientes-2026-10-01_2026-10-15.xlsx')
    })

    it('deshabilita el botón en curso, permite cancelar y no descarga', async () => {
      permitir()
      mocks.exportar.mockImplementation((_p, { alProgresar, signal }) => new Promise((_ok, fallar) => {
        alProgresar({ descargados: 10, total: 40 })
        signal.addEventListener('abort', () => fallar(new ExportacionCancelada()))
      }))
      abrir()
      fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
      expect(await screen.findByText(/Exportando 10 de 40 clientes/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeDisabled()
      expect(screen.getByRole('progressbar', { name: 'Progreso de la exportación' })).toHaveAttribute('aria-valuenow', '25')
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar exportación' }))
      await waitFor(() => expect(screen.queryByText(/Exportando/)).not.toBeInTheDocument())
      expect(mocks.descargar).not.toHaveBeenCalled()
    })

    it('ante un error lo informa y permite reintentar', async () => {
      permitir()
      mocks.exportar.mockRejectedValueOnce(new Error('se cayó la red')).mockResolvedValueOnce(new Blob(['x']))
      abrir()
      fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
      expect(await screen.findByText('se cayó la red')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
      expect(await screen.findByText(/Exportación lista/)).toBeInTheDocument()
      expect(mocks.exportar).toHaveBeenCalledTimes(2)
    })
  })
})
