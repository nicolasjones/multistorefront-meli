import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leerInformeConciliacion } from '../../lib/migracion'

const mocks = vi.hoisted(() => ({
  usePuedeEscribir: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc, from: mocks.from } }))

import { InformeConciliacion } from './InformeConciliacion'
import { MigracionInformes } from './informes'

const informeBase = {
  carga: 'carga-1',
  entidad: 'clientes',
  archivo: 'clientes-sinteticos.csv',
  estado: 'aplicada',
  creada_en: '2026-12-01T10:00:00Z',
  cerrada_en: '2026-12-01T10:01:00Z',
  origen: { filas: 3 },
  cargado: { nuevos: 2, actualizados: 0, con_error: 1, omitidos: 0 },
  diferencia: 0,
  destino: { verificadas: 2, diferencia: 0 },
  conciliado: true,
  errores: [{ fila: 4, motivo: 'Falta el nombre o la razón social' }],
}

describe('leerInformeConciliacion', () => {
  it('normaliza el informe de la base', () => {
    const informe = leerInformeConciliacion(informeBase)
    expect(informe).toMatchObject({
      filasOrigen: 3, nuevos: 2, actualizados: 0, conError: 1, omitidos: 0,
      diferencia: 0, destinoVerificadas: 2, destinoDiferencia: 0, conciliado: true,
    })
    expect(informe.errores).toEqual([{ fila: 4, motivo: 'Falta el nombre o la razón social' }])
  })

  it('conserva la diferencia negativa y no da por conciliado lo que la base no confirma', () => {
    const informe = leerInformeConciliacion({ ...informeBase, diferencia: -1, conciliado: 'si' })
    expect(informe.diferencia).toBe(-1)
    expect(informe.conciliado).toBe(false)
  })

  it('rechaza una respuesta vacía', () => {
    expect(() => leerInformeConciliacion(null)).toThrow()
  })
})

describe('InformeConciliacion', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('muestra origen vs. cargado y avisa que está conciliado', async () => {
    mocks.rpc.mockResolvedValue({ data: informeBase, error: null })
    render(<InformeConciliacion carga="carga-1" />)
    expect(await screen.findByText(/Conciliado: el archivo y lo cargado cuadran/)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('informe_conciliacion_migracion', { p_carga: 'carga-1' })
    const tabla = screen.getByRole('table', { name: 'Detalle de la conciliación' })
    expect(tabla).toHaveTextContent('Filas del archivo de origen3')
    expect(tabla).toHaveTextContent('Nuevos2')
    expect(tabla).toHaveTextContent('Con error1')
    expect(screen.getByRole('table', { name: 'Filas con error de la carga' })).toHaveTextContent('Falta el nombre')
  })

  it('advierte las diferencias cuando la carga está incompleta', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...informeBase,
        estado: 'fallida',
        cargado: { nuevos: 1, actualizados: 0, con_error: 0, omitidos: 2 },
        diferencia: 2,
        destino: { verificadas: 1, diferencia: 0 },
        conciliado: false,
        errores: [],
      },
      error: null,
    })
    render(<InformeConciliacion carga="carga-1" />)
    expect(await screen.findByText(/Hay diferencias: la carga no está completa/)).toHaveTextContent('Faltan o sobran 2 filas')
  })

  it('muestra el error y permite reintentar', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    mocks.rpc.mockResolvedValueOnce({ data: informeBase, error: null })
    render(<InformeConciliacion carga="carga-1" />)
    expect(await screen.findByText('Solo un administrador puede importar datos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/Conciliado/)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})

describe('MigracionInformes', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
  })

  const cadena = (resultado: unknown) => ({
    select: () => ({ order: () => ({ limit: async () => resultado }) }),
  })

  it('lista las cargas con enlace a su informe', async () => {
    mocks.from.mockReturnValue(cadena({
      data: [{ id: 'c-1', entidad: 'proveedores', archivo: 'proveedores-sinteticos.csv', estado: 'aplicada', filas_total: 5, created_at: '2026-12-01T10:00:00Z' }],
      error: null,
    }))
    render(<MemoryRouter><MigracionInformes /></MemoryRouter>)
    expect(await screen.findByText('proveedores-sinteticos.csv')).toBeInTheDocument()
    expect(mocks.from).toHaveBeenCalledWith('migracion_cargas')
    expect(screen.getByRole('link', { name: 'Ver informe de proveedores-sinteticos.csv' })).toHaveAttribute('href', '/migracion/informes/c-1')
  })

  it('muestra el estado vacío', async () => {
    mocks.from.mockReturnValue(cadena({ data: [], error: null }))
    render(<MemoryRouter><MigracionInformes /></MemoryRouter>)
    expect(await screen.findByText('Todavía no hay cargas de migración.')).toBeInTheDocument()
  })

  it('no ofrece las cargas a quien no es Administrador', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<MemoryRouter><MigracionInformes /></MemoryRouter>)
    expect(await screen.findByText('Sin permiso')).toBeInTheDocument()
    await waitFor(() => expect(mocks.from).not.toHaveBeenCalled())
  })
})
