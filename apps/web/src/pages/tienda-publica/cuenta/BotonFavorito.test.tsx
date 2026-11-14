import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  leerCapacidadesTienda: vi.fn(),
  sesionActivaEnTienda: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  schema: vi.fn(),
}))

vi.mock('../../../lib/tiendaCapacidades', () => ({ leerCapacidadesTienda: mocks.leerCapacidadesTienda }))
vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  sesionActivaEnTienda: mocks.sesionActivaEnTienda,
}))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { auth: { onAuthStateChange: mocks.onAuthStateChange }, schema: mocks.schema } }))

import { BotonFavorito } from './BotonFavorito'

const HOST = 'mundojc.localhost'
const ID = 'a1000000-0000-4000-8000-000000000001'

// Respuestas de las RPC de favoritos por nombre de función.
function rpcs(respuestas: Record<string, unknown>) {
  mocks.rpc.mockImplementation(async (funcion: string) => ({ data: respuestas[funcion] ?? null, error: null }))
}

function montar() {
  return render(<MemoryRouter initialEntries={[`/producto/${ID}`]}><BotonFavorito host={HOST} productoId={ID} nombre="Joystick Pro" /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fijarAncho(1440)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
  mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
  rpcs({ favoritos_entre_por_dominio: { estado: 'ok', favoritos: [] } })
})

// F-CLI-20 (FR-007, FR-009, P-2).
describe('BotonFavorito · ficha del producto (P-2)', () => {
  it('con cuenta activa alterna «Guardar en favoritos» / «Quitar de favoritos» con aria-pressed y avisa el resultado', async () => {
    montar()
    const guardar = await screen.findByRole('button', { name: 'Guardar en favoritos' })
    await waitFor(() => expect(guardar).toBeEnabled())
    expect(guardar).toHaveAttribute('aria-pressed', 'false')
    rpcs({ favoritos_entre_por_dominio: { estado: 'ok', favoritos: [] }, cambiar_favorito_por_dominio: { estado: 'ok', favorito: true } })
    fireEvent.click(guardar)
    expect(await screen.findByRole('status')).toHaveTextContent('Guardamos «Joystick Pro» en tus favoritos')
    const quitar = screen.getByRole('button', { name: 'Quitar de favoritos' })
    expect(quitar).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_favorito_por_dominio', { host: HOST, producto_id: ID, favorito: true })

    rpcs({ cambiar_favorito_por_dominio: { estado: 'ok', favorito: false } })
    fireEvent.click(quitar)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Quitamos «Joystick Pro» de tus favoritos'))
    expect(screen.getByRole('button', { name: 'Guardar en favoritos' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('el estado sale de UNA sola llamada de favoritos_entre por pantalla', async () => {
    rpcs({ favoritos_entre_por_dominio: { estado: 'ok', favoritos: [ID] } })
    montar()
    expect(await screen.findByRole('button', { name: 'Quitar de favoritos' })).toBeInTheDocument()
    const llamadas = mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'favoritos_entre_por_dominio')
    expect(llamadas).toEqual([['favoritos_entre_por_dominio', { host: HOST, productos: [ID] }]])
  })

  it('sin sesión es un enlace a «Ingresar» que vuelve a la ficha, con «Ingresá para guardar tus favoritos»', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    montar()
    const enlace = await screen.findByRole('link', { name: 'Guardar en favoritos' })
    expect(enlace).toHaveAttribute('href', `/ingresar?volver=${encodeURIComponent(`/producto/${ID}`)}`)
    expect(screen.getByText('Ingresá para guardar tus favoritos')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('favoritos_entre_por_dominio', expect.anything())
  })

  it.each([
    ['con la función apagada', () => mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })],
    ['sin poder leer la función', () => mocks.leerCapacidadesTienda.mockRejectedValue(new Error('red'))],
  ])('%s no dibuja nada ni consulta la sesión', async (_caso, preparar) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    preparar()
    const { container } = montar()
    await waitFor(() => expect(mocks.leerCapacidadesTienda).toHaveBeenCalled())
    await new Promise((resolver) => setTimeout(resolver, 20))
    expect(container).toBeEmptyDOMElement()
    expect(mocks.sesionActivaEnTienda).not.toHaveBeenCalled()
  })

  it('mientras no se sabe si hay sesión no dibuja nada (sin hueco)', async () => {
    mocks.sesionActivaEnTienda.mockReturnValue(new Promise(() => undefined))
    const { container } = montar()
    await waitFor(() => expect(mocks.leerCapacidadesTienda).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('el favorito 201 avisa «Llegaste al máximo de favoritos» y no cambia el botón', async () => {
    montar()
    const guardar = await screen.findByRole('button', { name: 'Guardar en favoritos' })
    await waitFor(() => expect(guardar).toBeEnabled())
    rpcs({ cambiar_favorito_por_dominio: { estado: 'limite_favoritos' } })
    fireEvent.click(guardar)
    expect(await screen.findByRole('alert')).toHaveTextContent('Llegaste al máximo de favoritos')
    expect(screen.getByRole('button', { name: 'Guardar en favoritos' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('un error al guardar avisa «No pudimos guardar el favorito. Probá de nuevo.»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    montar()
    const guardar = await screen.findByRole('button', { name: 'Guardar en favoritos' })
    await waitFor(() => expect(guardar).toBeEnabled())
    rpcs({ cambiar_favorito_por_dominio: { estado: 'error' } })
    fireEvent.click(guardar)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar el favorito. Probá de nuevo.')
  })

  it('si la cuenta dejó de estar activa avisa «Tu cuenta no está activa en esta tienda» y deshabilita el botón', async () => {
    montar()
    const guardar = await screen.findByRole('button', { name: 'Guardar en favoritos' })
    await waitFor(() => expect(guardar).toBeEnabled())
    rpcs({ cambiar_favorito_por_dominio: { estado: 'sin_acceso' } })
    fireEvent.click(guardar)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta no está activa en esta tienda')
    expect(screen.getByRole('button', { name: 'Guardar en favoritos' })).toBeDisabled()
  })

  it.each(ANCHOS_TIENDA)('no tiene violaciones de accesibilidad a %i px (con y sin sesión)', async (ancho) => {
    fijarAncho(ancho)
    const { container, unmount } = montar()
    await screen.findByRole('button', { name: 'Guardar en favoritos' })
    expect(await violacionesAxe(container)).toEqual([])
    unmount()
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    const sinSesion = montar()
    await screen.findByRole('link', { name: 'Guardar en favoritos' })
    expect(await violacionesAxe(sinSesion.container)).toEqual([])
  })
})
