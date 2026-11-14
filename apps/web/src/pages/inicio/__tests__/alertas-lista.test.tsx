import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ alertas: vi.fn(), calculo: vi.fn() }))
vi.mock('../../../lib/inicio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/inicio')>()),
  leerAlertasInicio: mocks.alertas,
  leerUltimoCalculoAlertas: mocks.calculo,
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({
    empresaActivaId: 'e1',
    isLoading: false,
    empresas: [{ id: 'e1', nombre: 'San Javucho', esActiva: true, rolId: null }],
  }),
}))

const nivel = vi.hoisted(() => ({ dolar: 'edicion' as string }))
vi.mock('../../../hooks/useNivelSeccion', () => ({
  useNivelSeccion: (seccion: string) => ({ nivel: seccion === 'cotizacion_dolar' ? nivel.dolar : 'edicion', isLoading: false, error: false }),
}))

import { AlertasInicio } from '../AlertasInicio'

const alerta = (tipo: string, cantidad: number, empresaId: string | null = null) => ({
  id: `${tipo}-${empresaId ?? 'org'}`, empresaId, tipo, cantidad, calculadaEn: new Date().toISOString(),
})

describe('Lista de alertas de Inicio (FR-025, FR-026)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nivel.dolar = 'edicion'
    mocks.calculo.mockResolvedValue(new Date().toISOString())
  })

  it('cada alerta enlaza a la pantalla donde se resuelve', async () => {
    mocks.alertas.mockResolvedValue([
      alerta('sin_stock', 3),
      alerta('stock_bajo', 1),
      alerta('consultas_sin_atender', 2, 'e1'),
      alerta('dolar_sin_cargar', 1),
      alerta('margen_negativo', 4, 'e1'),
    ])
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    const lista = await screen.findByRole('list', { name: 'Alertas' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'Ver: 3 productos sin stock' })).toHaveAttribute('href', '/stock')
    expect(screen.getByRole('link', { name: 'Ver: 1 producto con stock bajo' })).toHaveAttribute('href', '/stock')
    expect(screen.getByRole('link', { name: 'Abrir: 2 consultas nuevas sin atender' })).toHaveAttribute('href', '/consultas')
    expect(screen.getByRole('link', { name: 'Abrir: Todavía no se cargó el dólar de hoy' })).toHaveAttribute('href', '/cotizacion')
    expect(screen.getByRole('link', { name: 'Ver: 4 productos con margen negativo' })).toHaveAttribute('href', '/rentabilidad/productos')
    expect(screen.getAllByText('San Javucho')).toHaveLength(2)
  })

  it('pide las alertas de la empresa activa de la barra superior', async () => {
    mocks.alertas.mockResolvedValue([])
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    await screen.findByText('Todo al día')
    expect(mocks.alertas).toHaveBeenCalledWith('e1')
  })

  it('sin alertas muestra el estado vacío compartido «Todo al día»', async () => {
    mocks.alertas.mockResolvedValue([])
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Alertas' })).not.toBeInTheDocument()
  })

  it('si la lectura falla muestra el error de la tarjeta y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.alertas.mockRejectedValue(new Error('boom'))
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    expect(await screen.findByText('No pudimos cargar este dato')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('quien solo tiene lectura del dólar no ve la alerta de carga y las demás siguen igual (CA-INI-07-7)', async () => {
    mocks.alertas.mockResolvedValue([alerta('sin_stock', 3), alerta('dolar_sin_cargar', 1), alerta('margen_negativo', 4, 'e1')])
    for (const sinEdicion of ['lectura', 'ninguno']) {
      nivel.dolar = sinEdicion
      const { unmount } = render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
      const lista = await screen.findByRole('list', { name: 'Alertas' })
      expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
      expect(screen.queryByText('Todavía no se cargó el dólar de hoy')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Ver: 3 productos sin stock' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Ver: 4 productos con margen negativo' })).toBeInTheDocument()
      unmount()
    }
  })

  it('el administrador (edición del dólar) sí ve la alerta de carga', async () => {
    mocks.alertas.mockResolvedValue([alerta('dolar_sin_cargar', 1)])
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Abrir: Todavía no se cargó el dólar de hoy' })).toBeInTheDocument()
  })

  it('si la única alerta es la del dólar y no puede editarla, muestra «Todo al día»', async () => {
    nivel.dolar = 'lectura'
    mocks.alertas.mockResolvedValue([alerta('dolar_sin_cargar', 1)])
    render(<MemoryRouter><AlertasInicio /></MemoryRouter>)
    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
  })
})
