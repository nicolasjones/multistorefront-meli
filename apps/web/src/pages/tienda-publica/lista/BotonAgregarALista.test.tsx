import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leerCapacidadesTienda: vi.fn() }))
vi.mock('../../../lib/tiendaCapacidades', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaCapacidades')>()), leerCapacidadesTienda: mocks.leerCapacidadesTienda }))

import { agregarALista, leerLista, reiniciarListaPedido } from '../../../lib/listaPedido'
import { BotonAgregarALista, LineaListaFicha } from './BotonAgregarALista'
import { IndicadorLista } from './IndicadorLista'

const HOST = 'mundojc.localhost'
const ID = 'a1000000-0000-4000-8000-000000000001'
const OTRO = 'a1000000-0000-4000-8000-000000000002'

function montar(disponible = true) {
  return render(
    <MemoryRouter initialEntries={['/producto/x']}>
      <Routes>
        <Route path="/producto/x" element={(
          <>
            <IndicadorLista host={HOST} />
            <div data-testid="acciones">
              <BotonAgregarALista host={HOST} productoId={ID} nombre="Joystick Pro" />
            </div>
            <LineaListaFicha host={HOST} productoId={ID} disponible={disponible} />
          </>
        )} />
        <Route path="/lista" element={<p>Pantalla de la lista</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  reiniciarListaPedido()
  fijarAncho(1440)
  mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: true })
})

// MSF-176 · B1 · P-1 y P-2.
describe('«Agregar a la lista» de la ficha (P-2)', () => {
  it('cada clic suma 1 unidad, avisa con «Ver lista» y muestra «Ya tenés n en tu lista · Ver lista»', async () => {
    montar()
    const boton = await screen.findByRole('button', { name: 'Agregar a la lista' })
    expect(screen.queryByTestId('linea-lista-ficha')).not.toBeInTheDocument()
    fireEvent.click(boton)
    expect(await screen.findByRole('status')).toHaveTextContent('Agregamos «Joystick Pro» a tu lista')
    expect(screen.getByRole('button', { name: 'Ver lista' })).toBeInTheDocument()
    fireEvent.click(boton)
    expect(leerLista(HOST)).toEqual([{ productoId: ID, cantidad: 2 }])
    expect(screen.getByTestId('linea-lista-ficha')).toHaveTextContent('Ya tenés 2 en tu lista · Ver lista')
    expect(screen.getByRole('link', { name: 'Ver lista' })).toHaveAttribute('href', '/lista')
  })

  it('«Ver lista» del aviso lleva a /lista', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar a la lista' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ver lista' }))
    expect(await screen.findByText('Pantalla de la lista')).toBeInTheDocument()
  })

  it('sin stock: el botón sigue activo y la línea dice «Sin stock hoy: lo confirmamos al responder»', async () => {
    montar(false)
    expect(await screen.findByRole('button', { name: 'Agregar a la lista' })).toBeEnabled()
    expect(screen.getByTestId('linea-lista-ficha')).toHaveTextContent('Sin stock hoy: lo confirmamos al responder')
  })

  it('tope de 9.999 unidades y de 50 productos: avisa el motivo y el botón no se deshabilita', async () => {
    agregarALista(HOST, ID, 9999)
    montar()
    const boton = await screen.findByRole('button', { name: 'Agregar a la lista' })
    fireEvent.click(boton)
    expect(await screen.findByRole('alert')).toHaveTextContent('Llegaste al máximo de 9.999 unidades de este producto')
    expect(boton).toBeEnabled()
    window.localStorage.clear()
    reiniciarListaPedido()
    for (let n = 10; n < 60; n += 1) agregarALista(HOST, `a1000000-0000-4000-8000-0000000000${n}`)
    fireEvent.click(boton)
    expect(await screen.findByText('Tu lista ya tiene 50 productos. Enviala o quitá alguno para sumar otro')).toBeInTheDocument()
    expect(leerLista(HOST)).toHaveLength(50)
  })

  it('con la función apagada no existe nada (ni botón, ni indicador, ni línea) y no ocupa lugar', async () => {
    mocks.leerCapacidadesTienda.mockResolvedValue({ pedidos: false })
    const { container } = montar(false)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: 'Agregar a la lista' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('indicador-lista')).not.toBeInTheDocument()
    expect(screen.queryByTestId('linea-lista-ficha')).not.toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  it('mientras se resuelve la función no se dibuja nada', () => {
    mocks.leerCapacidadesTienda.mockReturnValue(new Promise(() => undefined))
    const { container } = montar()
    expect(container.textContent).toBe('')
  })

  it('una falla al leer las capacidades tampoco dibuja nada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leerCapacidadesTienda.mockRejectedValue(new Error('sin red'))
    const { container } = montar()
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toBe('')
  })
})

describe('«Mi lista (n)» del encabezado (P-1)', () => {
  it('escritorio: «Mi lista» sin número con la lista vacía y «Mi lista (n)» con n = productos DISTINTOS, con nombre accesible', async () => {
    montar()
    const vacia = await screen.findByTestId('indicador-lista')
    expect(vacia).toHaveAccessibleName('Mi lista, vacía')
    expect(vacia).toHaveTextContent(/^Mi lista$/)
    expect(vacia).toHaveAttribute('href', '/lista')
    act(() => { agregarALista(HOST, ID, 5) })
    expect(screen.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, 1 producto')
    expect(screen.getByTestId('indicador-lista')).toHaveTextContent('Mi lista (1)')
    act(() => { agregarALista(HOST, OTRO) })
    expect(screen.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, 2 productos')
    expect(screen.getByTestId('indicador-lista')).toHaveTextContent('Mi lista (2)')
  })

  it('celular y tableta: ícono con el número y el mismo nombre accesible', async () => {
    fijarAncho(320)
    agregarALista(HOST, ID)
    agregarALista(HOST, OTRO)
    montar()
    const indicador = await screen.findByTestId('indicador-lista')
    expect(indicador).toHaveAccessibleName('Mi lista, 2 productos')
    expect(indicador).toHaveTextContent('2')
    expect(indicador).toHaveAttribute('href', '/lista')
  })

  it('el número se actualiza al volver el foco (otra pestaña con la misma lista)', async () => {
    montar()
    await screen.findByTestId('indicador-lista')
    window.localStorage.setItem(`msf.lista-pedido.v1:${HOST}`, JSON.stringify([{ p: ID, c: 1 }, { p: OTRO, c: 1 }]))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(screen.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, 2 productos')
  })
})

describe.each(ANCHOS_TIENDA)('accesibilidad de los controles de la lista a %i px', (ancho) => {
  it('indicador, botón, línea secundaria y aviso: sin violaciones de axe', async () => {
    fijarAncho(ancho)
    const { container } = montar(false)
    const boton = await screen.findByRole('button', { name: 'Agregar a la lista' })
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(boton)
    await screen.findByRole('status')
    expect(await violacionesAxe(container)).toEqual([])
  }, 30000)
})
