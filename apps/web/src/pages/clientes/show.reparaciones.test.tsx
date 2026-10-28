import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useOne: vi.fn(),
  useNivelSeccion: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  listar: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: () => ({ empresas: [], isLoading: false, isError: false }) }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({
  useEmpresasDeCliente: () => ({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useCuentasWebDeCliente', () => ({
  useCuentasWebDeCliente: () => ({ cuentas: [], isLoading: false, isError: false, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'o-1' } }) }))
vi.mock('../../components/clientes/ComprasCliente', () => ({ ComprasCliente: () => <div data-testid="compras" /> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: async (_nombre: string, a: { p_cliente: string; p_empresa: string | null; p_pagina: number; p_tamano: number }) => {
      try {
        const r = await mocks.listar(a.p_cliente, a.p_empresa, a.p_pagina, a.p_tamano)
        return { data: { total_filas: r.total, filas: r.filas }, error: null }
      } catch (error) {
        return { data: null, error }
      }
    },
  },
}))

import type { Cliente } from '../../lib/clientes'
import type { ReparacionDeCliente } from '../../lib/reparacionesDeCliente'
import { celular } from '../../test/matchMedia'
import { ClienteShow } from './show'

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: '30-71234567-8', correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: 'Rosario', provincia: null, expreso_preferido: null,
  archivado_en: null, tipo: 'mayorista', es_consumidor_final: false, created_at: '2026-10-16T10:00:00Z',
}

const fila = (n: number, extra: Partial<ReparacionDeCliente> = {}): ReparacionDeCliente => ({
  id: `r-${n}`, numero: `R-${String(n).padStart(4, '0')}`, empresa: 'San Javucho', equipo: 'Nintendo Switch', modelo: 'Estándar',
  estado: 'En diagnóstico', estado_tono: 'info', ingreso_en: '2026-10-20', entrega_prevista: '2026-10-25', total: 150, ...extra,
})

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/clientes/show/c-1']}>
      <Routes>
        <Route path="/clientes/show/:id" element={<ClienteShow />} />
        <Route path="/service-tecnico/reparaciones/:id" element={<div>Detalle de reparación</div>} />
      </Routes>
    </MemoryRouter>,
  )

const abrirPestana = async () => {
  abrir()
  fireEvent.click(await screen.findByRole('tab', { name: 'Reparaciones' }))
}

describe('Ficha del cliente · pestaña Reparaciones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    celular(false)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useOne.mockReturnValue({ query: { data: { data: cliente }, isLoading: false, isError: false, refetch: vi.fn() } })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.listar.mockResolvedValue({ total: 2, filas: [fila(238), fila(12, { total: 0, entrega_prevista: null })] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('muestra la pestaña y deja el contenido previo en «Datos»', async () => {
    abrir()
    expect(await screen.findByRole('tab', { name: 'Datos', selected: true })).toBeTruthy()
    expect(screen.getByText('30-71234567-8')).toBeTruthy()
    expect(screen.getByTestId('compras')).toBeTruthy()
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('lista columnas, contador, «A presupuestar» y «—»', async () => {
    await abrirPestana()
    expect(await screen.findByText('2 reparaciones')).toBeTruthy()
    const tabla = screen.getByRole('table', { name: 'Reparaciones del cliente' })
    for (const e of ['Reparación', 'Tienda', 'Equipo', 'Estado', 'Ingreso', 'Entrega', 'Total']) {
      expect(within(tabla).getByRole('columnheader', { name: e })).toBeTruthy()
    }
    expect(within(tabla).getByText('R-0238')).toBeTruthy()
    expect(within(tabla).getAllByText('Estándar').length).toBe(2)
    expect(within(tabla).getByText('A presupuestar')).toBeTruthy()
    expect(within(tabla).getAllByText('20/10/2026').length).toBe(2)
    expect(within(tabla).getByText('—')).toBeTruthy()
    expect(mocks.listar).toHaveBeenCalledWith('c-1', null, 1, 25)
  })

  it('abre el detalle al elegir la reparación', async () => {
    await abrirPestana()
    fireEvent.click(await screen.findByRole('link', { name: 'R-0238' }))
    expect(await screen.findByText('Detalle de reparación')).toBeTruthy()
  })

  it('muestra el estado de carga mientras llegan las reparaciones', async () => {
    let resolver: (v: { total: number; filas: ReparacionDeCliente[] }) => void = () => undefined
    mocks.listar.mockReturnValue(new Promise((r) => { resolver = r }))
    await abrirPestana()
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeTruthy()
    expect(screen.queryByText('R-0238')).toBeNull()
    resolver({ total: 1, filas: [fila(238)] })
    expect(await screen.findByText('R-0238')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).toBeNull()
  })

  it('muestra el estado vacío', async () => {
    mocks.listar.mockResolvedValue({ total: 0, filas: [] })
    await abrirPestana()
    expect(await screen.findByText('Este cliente todavía no tiene reparaciones')).toBeTruthy()
  })

  it('informa el error y reintenta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.listar.mockRejectedValueOnce(new Error('falla'))
    await abrirPestana()
    expect(await screen.findByText('No pudimos cargar las reparaciones del cliente.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('R-0238')).toBeTruthy()
  })

  it('pagina en el servidor con tamaño 25', async () => {
    mocks.listar.mockResolvedValue({ total: 30, filas: [fila(1)] })
    await abrirPestana()
    await screen.findByText('30 reparaciones')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente|Go to next page/i }))
    await waitFor(() => expect(mocks.listar).toHaveBeenLastCalledWith('c-1', null, 2, 25))
  })

  it('al cambiar de empresa activa recarga, vuelve a la página 1 y no muestra filas de la anterior', async () => {
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-1', isLoading: false, isError: false, refetch: vi.fn() })
    mocks.listar.mockImplementation(async (_c: string, empresa: string | null) => (
      empresa === 'e-1'
        ? { total: 30, filas: [fila(1, { empresa: 'San Javucho' })] }
        : { total: 1, filas: [fila(2, { empresa: 'Mundo JC' })] }))
    const { rerender } = render(
      <MemoryRouter initialEntries={['/clientes/show/c-1']}>
        <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('tab', { name: 'Reparaciones' }))
    await screen.findByText('R-0001')
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente|Go to next page/i }))
    await waitFor(() => expect(mocks.listar).toHaveBeenLastCalledWith('c-1', 'e-1', 2, 25))

    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e-2', isLoading: false, isError: false, refetch: vi.fn() })
    await act(async () => {
      rerender(
        <MemoryRouter initialEntries={['/clientes/show/c-1']}>
          <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
        </MemoryRouter>,
      )
    })
    expect(await screen.findByText('R-0002')).toBeTruthy()
    expect(screen.queryByText('R-0001')).toBeNull()
    expect(mocks.listar).toHaveBeenLastCalledWith('c-1', 'e-2', 1, 25)
  })

  it('no ofrece la pestaña con service_tecnico en «ninguno»', async () => {
    mocks.useNivelSeccion.mockImplementation((seccion: string) => ({ nivel: seccion === 'service_tecnico' ? 'ninguno' : 'edicion', isLoading: false }))
    abrir()
    expect(await screen.findByText('30-71234567-8')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Reparaciones' })).toBeNull()
    expect(mocks.listar).not.toHaveBeenCalled()
  })

  it('con «lectura» ve la pestaña sin acciones de edición', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    await abrirPestana()
    expect(await screen.findByText('R-0238')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /editar|nueva|agregar/i })).toBeNull()
  })

  it('en pantallas angostas muestra tarjetas, no tabla', async () => {
    celular(true)
    await abrirPestana()
    expect(await screen.findByText('R-0238')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByText('Total').length).toBe(2)
  })

  it('la pestaña se opera con teclado', async () => {
    abrir()
    const pestana = await screen.findByRole('tab', { name: 'Reparaciones' })
    pestana.focus()
    fireEvent.keyDown(pestana, { key: 'Enter' })
    fireEvent.click(pestana)
    expect(await screen.findByRole('tabpanel')).toBeTruthy()
    expect(pestana.getAttribute('aria-selected')).toBe('true')
  })
})
