import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), firmar: vi.fn() }))

vi.mock('../../../lib/tiendaBusqueda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaBusqueda')>()),
  leerSugerencias: mocks.leer,
}))
vi.mock('../../../lib/imagenProducto', () => ({ urlsImagenesProducto: mocks.firmar }))

import BuscadorTienda from './BuscadorTienda'

// F-TDA-15 (SC-005): sugerencias, teclado, combobox, respuesta tardía descartada, sin coincidencias,
// aviso de espera, error de red y texto escapado (FR-024, FR-026, FR-027, FR-028, FR-029).

const HOST = 'mundojc.localhost'
const sugerencia = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, precio: 18455, disponible: true, imagen: null, categoriaId: null, ...extra,
})
const respuesta = (...sugerencias: ReturnType<typeof sugerencia>[]) => ({ esperaSegundos: null, sugerencias })

function Ubicacion() {
  const { pathname, search } = useLocation()
  return <p data-testid="ubicacion">{pathname}{search}</p>
}

function montar(entrada = '/') {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="*" element={<><BuscadorTienda host={HOST} /><Ubicacion /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const campo = () => screen.getByRole('combobox', { name: 'Buscar productos' })
const ubicacion = () => screen.getByTestId('ubicacion').textContent

// Escribe y deja pasar la espera entre teclas (400 ms) y la respuesta.
async function escribir(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.firmar.mockResolvedValue({})
  mocks.leer.mockResolvedValue(respuesta(sugerencia('p-1', 'Cargador USB-C'), sugerencia('p-2', 'Cargador inalámbrico', { precio: null, disponible: false })))
})
afterEach(() => vi.useRealTimers())

describe('BuscadorTienda · sugerencias', () => {
  it('pide sugerencias tras la espera entre teclas y las muestra con precio y disponibilidad', async () => {
    montar()
    fireEvent.change(campo(), { target: { value: 'carg' } })
    expect(mocks.leer).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(mocks.leer).toHaveBeenCalledTimes(1)
    expect(mocks.leer).toHaveBeenCalledWith(HOST, 'carg')

    const opciones = screen.getAllByRole('option')
    expect(opciones).toHaveLength(3) // 2 sugerencias + «Ver todos los resultados →»
    expect(opciones[0]).toHaveTextContent('Cargador USB-C')
    expect(opciones[0]).toHaveTextContent('$ 18.455')
    expect(opciones[0]).toHaveTextContent('Disponible')
    expect(opciones[0]).toHaveTextContent('Sin imagen')
    expect(opciones[1]).toHaveTextContent('Sin stock')
    expect(campo()).toHaveAttribute('aria-expanded', 'true')
  })

  it('con menos de 2 caracteres no consulta ni muestra nada', async () => {
    montar()
    await escribir('c')
    expect(mocks.leer).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByText('No encontramos productos con ese nombre.')).not.toBeInTheDocument()
  })

  it('texto vacío tras haber buscado cierra el desplegable sin mensajes', async () => {
    montar()
    await escribir('carg')
    await escribir('')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.queryByText('No encontramos productos con ese nombre.')).not.toBeInTheDocument()
  })

  it('descarta una respuesta vieja que llega después de la nueva', async () => {
    let resolverVieja: (v: unknown) => void = () => undefined
    mocks.leer.mockReset()
    mocks.leer
      .mockImplementationOnce(() => new Promise((resolver) => { resolverVieja = resolver }))
      .mockResolvedValueOnce(respuesta(sugerencia('p-9', 'Cable HDMI')))
    montar()
    await escribir('carg') // pedido viejo: queda pendiente
    await escribir('cable') // pedido nuevo: responde enseguida
    expect(screen.getByRole('option', { name: /Cable HDMI/ })).toBeInTheDocument()
    await act(async () => { resolverVieja(respuesta(sugerencia('p-1', 'Cargador viejo'))) })
    expect(screen.queryByText('Cargador viejo')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Cable HDMI/ })).toBeInTheDocument()
  })

  it('escapa el texto del producto (no interpreta HTML)', async () => {
    mocks.leer.mockResolvedValue(respuesta(sugerencia('p-1', '<img src=x onerror=alert(1)> Cargador')))
    const { container } = montar()
    await escribir('carg')
    expect(screen.getByRole('option', { name: /<img src=x onerror=alert\(1\)> Cargador/ })).toBeInTheDocument()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('BuscadorTienda · teclado y navegación', () => {
  it('flechas + Enter abren la ficha de la sugerencia activa', async () => {
    montar()
    await escribir('carg')
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    expect(campo()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    fireEvent.keyDown(campo(), { key: 'ArrowUp' })
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(ubicacion()).toBe('/producto/p-1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowUp desde el campo salta a «Ver todos los resultados →»', async () => {
    montar()
    await escribir('carg')
    fireEvent.keyDown(campo(), { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(ubicacion()).toBe('/catalogo?q=carg')
  })

  it('Enter sin sugerencia elegida lleva a los resultados con el texto normalizado', async () => {
    montar()
    await escribir('  cargdor   usb  ')
    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(ubicacion()).toBe('/catalogo?q=cargdor+usb')
  })

  it('«Ver todos los resultados →» con el mouse lleva a /catalogo?q=…', async () => {
    montar()
    await escribir('carg')
    fireEvent.click(screen.getByRole('option', { name: /Ver todos los resultados/ }))
    expect(ubicacion()).toBe('/catalogo?q=carg')
  })

  it('clic en una sugerencia abre su ficha', async () => {
    montar()
    await escribir('carg')
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(ubicacion()).toBe('/producto/p-2')
  })

  it('Esc y clic afuera cierran el desplegable', async () => {
    montar()
    await escribir('carg')
    fireEvent.keyDown(campo(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.focus(campo())
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('en los resultados el campo muestra lo buscado', () => {
    montar('/catalogo?q=cargador')
    expect(campo()).toHaveValue('cargador')
  })
})

describe('BuscadorTienda · estados', () => {
  it('sin coincidencias dice «No encontramos productos con ese nombre.»', async () => {
    mocks.leer.mockResolvedValue(respuesta())
    montar()
    await escribir('zzzz')
    expect(screen.getByRole('status')).toHaveTextContent('No encontramos productos con ese nombre.')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('superado el límite muestra un aviso anunciado y la búsqueda se libera sola', async () => {
    mocks.leer.mockReset()
    mocks.leer
      .mockResolvedValueOnce({ esperaSegundos: 20, sugerencias: [] })
      .mockResolvedValueOnce(respuesta(sugerencia('p-1', 'Cargador USB-C')))
    montar()
    await escribir('carg')
    const aviso = screen.getByTestId('buscador-espera')
    expect(aviso).toHaveAttribute('role', 'status')
    expect(aviso).toHaveTextContent('Esperá 20 segundos')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()

    // Termina la espera (React aplica el reintento al salir del act) y luego pasa la espera entre teclas.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(mocks.leer).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('buscador-espera')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Cargador USB-C/ })).toBeInTheDocument()
  })

  it('un error de red muestra el mensaje con «Reintentar» y reintenta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockReset()
    mocks.leer
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(respuesta(sugerencia('p-1', 'Cargador USB-C')))
    montar()
    await escribir('carg')
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos buscar.')
    expect(campo()).toBeInTheDocument() // el resto no se rompe
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getByRole('option', { name: /Cargador USB-C/ })).toBeInTheDocument()
  })
})

describe('BuscadorTienda · accesibilidad', () => {
  it('sin violaciones de axe con el desplegable abierto', async () => {
    const { container } = montar()
    await escribir('carg')
    vi.useRealTimers()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
