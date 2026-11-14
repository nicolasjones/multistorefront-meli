import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { fijarAncho, ANCHOS_TIENDA } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  sesionActivaEnTienda: vi.fn(),
  salirCliente: vi.fn(),
  leerCapacidadesTienda: vi.fn(),
  onAuthStateChange: vi.fn(),
  listaDisponible: false,
}))

vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  sesionActivaEnTienda: mocks.sesionActivaEnTienda,
  salirCliente: mocks.salirCliente,
}))
vi.mock('../../../lib/tiendaCapacidades', () => ({
  leerCapacidadesTienda: mocks.leerCapacidadesTienda,
  get LISTA_DE_PEDIDO_DISPONIBLE() { return mocks.listaDisponible },
}))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { auth: { onAuthStateChange: mocks.onAuthStateChange } } }))

import { AccesoCliente } from './AccesoCliente'
import MenuMovil from './MenuMovil'

const HOST = 'mundojc.localhost'
const categorias: CategoriasTienda = { fase: 'lista', categorias: [], reintentar: () => undefined }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listaDisponible = false
  fijarAncho(1440)
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  mocks.salirCliente.mockResolvedValue(undefined)
  mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
  mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
})

const montarAcceso = () => render(<MemoryRouter><AccesoCliente host={HOST} /></MemoryRouter>)

// F-CLI-20 (FR-001, FR-014, P-1): «Mi cuenta» solo con cuenta activa y la función encendida.
describe('AccesoCliente · «Mi cuenta» (P-1)', () => {
  it('con cuenta activa y la función encendida muestra «Mi cuenta» (a /mi-cuenta) y «Salir» en escritorio', async () => {
    montarAcceso()
    expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta')
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument()
  })

  it('«Salir» sigue cerrando la sesión como hoy', async () => {
    montarAcceso()
    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.salirCliente).toHaveBeenCalledTimes(1))
  })

  it('con la función apagada no hay «Mi cuenta» y queda solo «Salir», igual que antes', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    montarAcceso()
    expect(await screen.findByRole('button', { name: 'Salir' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument()
  })

  it('si no se puede saber la función (error) no dibuja «Mi cuenta» pero sí «Salir»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leerCapacidadesTienda.mockRejectedValue(new Error('red'))
    montarAcceso()
    expect(await screen.findByRole('button', { name: 'Salir' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument()
  })

  it('sin sesión muestra solo «Ingresar»: ni «Mi cuenta» ni «Salir»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    montarAcceso()
    expect(await screen.findByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/ingresar')
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })

  it('una cuenta que no está activa (la sesión se da por no iniciada) no ve «Mi cuenta»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
    montarAcceso()
    await screen.findByRole('link', { name: 'Ingresar' })
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument()
  })

  it('en celular y tableta «Salir» pasa al menú: el encabezado muestra solo «Mi cuenta»', async () => {
    fijarAncho(768)
    montarAcceso()
    expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })

  it('en celular con la función apagada «Salir» queda en el encabezado', async () => {
    fijarAncho(320)
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    montarAcceso()
    expect(await screen.findByRole('button', { name: 'Salir' })).toBeInTheDocument()
  })

  it('el encabezado y el menú juntos consultan la sesión UNA sola vez', async () => {
    fijarAncho(320)
    render(
      <MemoryRouter>
        <AccesoCliente host={HOST} />
        <Routes><Route path="*" element={<MenuMovil categorias={categorias} host={HOST} />} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toBeInTheDocument()
    abrirMenu()
    await screen.findByRole('list', { name: 'Tu cuenta' })
    expect(mocks.sesionActivaEnTienda).toHaveBeenCalledTimes(1)
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    fijarAncho(ancho)
    const { container } = montarAcceso()
    await screen.findByRole('link', { name: 'Mi cuenta' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})

function montarMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<MenuMovil categorias={categorias} host={HOST} />} />
      </Routes>
    </MemoryRouter>,
  )
}
const abrirMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir menú', hidden: true }))

describe('MenuMovil · «Mi cuenta» y «Salir» (P-1; «Mi lista» cuando exista B1)', () => {
  it('con cuenta activa y la función encendida suma «Mi cuenta» y «Salir» al final del menú, sin «Mi lista» (no existe hasta B1)', async () => {
    fijarAncho(320)
    montarMenu()
    abrirMenu()
    const panel = await screen.findByRole('dialog', { name: 'Menú' })
    const cuenta = await within(panel).findByRole('list', { name: 'Tu cuenta' })
    expect(within(cuenta).getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/mi-cuenta')
    expect(within(cuenta).queryByRole('link', { name: 'Mi lista' })).not.toBeInTheDocument()
    expect(within(cuenta).getByRole('button', { name: 'Salir' })).toBeInTheDocument()
  })

  it('cuando exista la lista de pedido (B1) suma «Mi lista» entre las dos', async () => {
    mocks.listaDisponible = true
    fijarAncho(320)
    montarMenu()
    abrirMenu()
    const cuenta = await screen.findByRole('list', { name: 'Tu cuenta' })
    expect(within(cuenta).getByRole('link', { name: 'Mi lista' })).toHaveAttribute('href', '/lista')
  })

  it('«Salir» del menú cierra la sesión y cierra el menú', async () => {
    fijarAncho(320)
    montarMenu()
    abrirMenu()
    const cuenta = await screen.findByRole('list', { name: 'Tu cuenta' })
    fireEvent.click(within(cuenta).getByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.salirCliente).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each([
    ['sin sesión', () => mocks.sesionActivaEnTienda.mockResolvedValue(null)],
    ['con la función apagada', () => mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })],
  ])('%s no suma ninguna entrada de cuenta', async (_caso, preparar) => {
    preparar()
    fijarAncho(320)
    montarMenu()
    abrirMenu()
    const panel = await screen.findByRole('dialog', { name: 'Menú' })
    await waitFor(() => expect(mocks.sesionActivaEnTienda).toHaveBeenCalled())
    await waitFor(() => expect(mocks.leerCapacidadesTienda).toHaveBeenCalled())
    expect(within(panel).queryByRole('list', { name: 'Tu cuenta' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument()
  })

  it('sin host (vista previa del panel) no lee la sesión ni las capacidades', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<MenuMovil categorias={categorias} />} /></Routes></MemoryRouter>)
    abrirMenu()
    await screen.findByRole('dialog', { name: 'Menú' })
    expect(mocks.sesionActivaEnTienda).not.toHaveBeenCalled()
    expect(mocks.leerCapacidadesTienda).not.toHaveBeenCalled()
  })

  it.each([320, 768])('el menú con las entradas de cuenta no tiene violaciones de accesibilidad a %i px', async (ancho) => {
    fijarAncho(ancho)
    montarMenu()
    abrirMenu()
    const panel = await screen.findByRole('dialog', { name: 'Menú' })
    await within(panel).findByRole('list', { name: 'Tu cuenta' })
    expect(await violacionesAxe(panel)).toEqual([])
  })
})
