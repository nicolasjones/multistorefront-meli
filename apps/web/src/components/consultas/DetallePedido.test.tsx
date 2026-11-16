import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../test/ancho'
import { violacionesAxe } from '../../test/axe'

const mocks = vi.hoisted(() => ({ useItemsConsulta: vi.fn(), reintentar: vi.fn(), nivelClientes: 'ninguno' as string | null }))

vi.mock('../../hooks/useRespuestasRapidas', () => ({ useRespuestasRapidas: () => ({ respuestas: [], isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../hooks/useConsultas', () => ({ useResponsablesConsultas: () => ({ responsables: [], isLoading: false, isError: false }) }))
vi.mock('../../hooks/useItemsConsulta', () => ({ useItemsConsulta: mocks.useItemsConsulta }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: mocks.nivelClientes, isLoading: false, error: false }) }))
vi.mock('../../pages/consultas/ContactoConsulta', () => ({ ContactoConsulta: () => null }))

import type { Consulta, ItemConsulta } from '../../lib/consultas'
import { DetalleConsulta } from './DetalleConsulta'

const pedido = (extra: Partial<Consulta> = {}): Consulta => ({
  id: 'c1000000-0000-0000-0000-0000000000b1', empresa_id: 'e-1', empresa_nombre: 'San Javucho', origen: 'pedido',
  nombre: 'Bruno Gómez', contacto: 'bruno@example.com', mensaje: 'Necesito factura A', producto_id: null, producto_nombre: null,
  estado: 'nueva', responsable_id: null, responsable_nombre: null, nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z', updated_at: '2026-10-23T11:48:00.000Z',
  items_cantidad: 2, cliente_id: null, cliente_numero: null, cliente_nombre: null, ...extra,
})
const ITEMS: ItemConsulta[] = [
  { orden: 1, producto_id: 'p-1', descripcion: 'Joystick Pro', sku: 'JOY-1', cantidad: 2, precio_referencia: 2500 },
  { orden: 2, producto_id: null, descripcion: 'Cable USB', sku: null, cantidad: 1, precio_referencia: null },
]
const lista = (items: ItemConsulta[] = ITEMS) => ({ fase: 'lista', items, reintentar: mocks.reintentar })

const montar = (consultaPedido = pedido()) => render(
  <MemoryRouter><DetalleConsulta consulta={consultaPedido} puedeEditar onCerrar={vi.fn()} onGuardado={vi.fn()} onRecargar={vi.fn()} /></MemoryRouter>,
)

beforeEach(() => {
  vi.clearAllMocks()
  fijarAncho(1440)
  mocks.nivelClientes = 'ninguno'
  mocks.useItemsConsulta.mockReturnValue(lista())
})

// MSF-176 · B1 · P-6: detalle de un pedido.
describe('DetalleConsulta · pedido (P-6)', () => {
  it('muestra el bloque «Pedido» con los ítems, «referencia», el total de referencia y la nota aclaratoria', () => {
    montar()
    const bloque = screen.getByTestId('bloque-pedido')
    for (const encabezado of ['Producto', 'SKU', 'Cantidad', 'Precio de referencia', 'Subtotal de referencia']) {
      expect(within(bloque).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    const filas = within(bloque).getAllByRole('row').slice(1)
    expect(within(filas[0]).getByText('Joystick Pro')).toBeInTheDocument()
    expect(within(filas[0]).getByText('JOY-1')).toBeInTheDocument()
    expect(within(filas[0]).getByText('$ 2.500,00')).toBeInTheDocument()
    expect(within(filas[0]).getByText('$ 5.000,00')).toBeInTheDocument()
    expect(within(filas[1]).getAllByText('Sin precio')).toHaveLength(2)
    expect(screen.getByTestId('total-referencia-pedido')).toHaveTextContent('Total de referencia $ 5.000,00')
    expect(screen.getByText('Precios de referencia calculados al enviar, tal como los vio la persona en la tienda. Confirmalos al responder.')).toBeInTheDocument()
    expect(screen.queryByText('Producto de interés')).not.toBeInTheDocument()
  })

  it('«Mensaje» pasa a «Nota de la persona» y sin nota dice «Sin nota»', () => {
    const { unmount } = montar()
    expect(screen.getByText('Nota de la persona')).toBeInTheDocument()
    expect(screen.getByText('Necesito factura A')).toBeInTheDocument()
    expect(screen.queryByText('Mensaje')).not.toBeInTheDocument()
    unmount()
    montar(pedido({ mensaje: null }))
    expect(screen.getByText('Sin nota')).toBeInTheDocument()
  })

  it('con cuenta activa muestra la fila «Cliente» con «Nº n · nombre»; sin cliente no hay fila', () => {
    const { unmount } = montar(pedido({ cliente_id: 'c-1', cliente_numero: 910, cliente_nombre: 'Mayorista Cuenta' }))
    expect(screen.getByText('Cliente')).toBeInTheDocument()
    expect(screen.getByText('Nº 910 · Mayorista Cuenta')).toBeInTheDocument()
    unmount()
    montar()
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument()
  })

  // H-4: «Cliente» es un enlace a su ficha solo con acceso a Clientes.
  it('H-4: con acceso a Clientes «Nº n · nombre» es un enlace a su ficha; sin acceso, texto plano', () => {
    mocks.nivelClientes = 'lectura'
    const { unmount } = montar(pedido({ cliente_id: 'c-1', cliente_numero: 910, cliente_nombre: 'Mayorista Cuenta' }))
    expect(screen.getByRole('link', { name: 'Nº 910 · Mayorista Cuenta' })).toHaveAttribute('href', '/clientes/show/c-1')
    unmount()
    mocks.nivelClientes = 'ninguno'
    montar(pedido({ cliente_id: 'c-1', cliente_numero: 910, cliente_nombre: 'Mayorista Cuenta' }))
    expect(screen.getByText('Nº 910 · Mayorista Cuenta')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Mayorista Cuenta/ })).not.toBeInTheDocument()
  })

  // H-2: «Responder» espera a los ítems de un pedido.
  it('H-2: «Responder por correo» está deshabilitado mientras los ítems cargan o fallan y se habilita al cargarlos', () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    mocks.useItemsConsulta.mockReturnValue({ fase: 'cargando', items: [], reintentar: mocks.reintentar })
    const { unmount } = montar()
    expect(screen.getByRole('button', { name: 'Responder por correo' })).toBeDisabled()
    unmount()
    mocks.useItemsConsulta.mockReturnValue({ fase: 'error', items: [], reintentar: mocks.reintentar })
    const conError = montar()
    expect(screen.getByRole('button', { name: 'Responder por correo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Responder por correo' }))
    expect(abrir).not.toHaveBeenCalled()
    conError.unmount()
    mocks.useItemsConsulta.mockReturnValue(lista())
    montar()
    expect(screen.getByRole('button', { name: 'Responder por correo' })).toBeEnabled()
  })

  it('estado de carga: «Cargando los productos del pedido»', () => {
    mocks.useItemsConsulta.mockReturnValue({ fase: 'cargando', items: [], reintentar: mocks.reintentar })
    montar()
    expect(screen.getAllByText('Cargando los productos del pedido').length).toBeGreaterThan(0)
    expect(screen.getByRole('status', { name: 'Cargando los productos del pedido' })).toBeInTheDocument()
  })

  it('estado de error: «No pudimos cargar los productos del pedido.» con Reintentar', () => {
    mocks.useItemsConsulta.mockReturnValue({ fase: 'error', items: [], reintentar: mocks.reintentar })
    montar()
    expect(screen.getByText('No pudimos cargar los productos del pedido.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.reintentar).toHaveBeenCalled()
  })

  it('sin ítems (no debería pasar): «Este pedido no tiene productos cargados.»', () => {
    mocks.useItemsConsulta.mockReturnValue(lista([]))
    montar()
    expect(screen.getByText('Este pedido no tiene productos cargados.')).toBeInTheDocument()
  })

  it('solo pide los ítems si la consulta es un pedido', () => {
    mocks.useItemsConsulta.mockClear()
    montar(pedido({ origen: 'formulario', items_cantidad: 0 }))
    expect(mocks.useItemsConsulta).not.toHaveBeenCalled()
    expect(screen.getByText('Producto de interés')).toBeInTheDocument()
    expect(screen.queryByTestId('bloque-pedido')).not.toBeInTheDocument()
  })

  // T042 · amenaza 1.5: nombre, nota y descripciones se ven LITERALES (React escapa); nunca HTML.
  it('XSS: <script>, HTML, fórmulas de CSV y saltos de línea se ven literales y no se ejecuta nada', () => {
    mocks.useItemsConsulta.mockReturnValue(lista([
      { orden: 1, producto_id: null, descripcion: '<img src=x onerror=alert(1)>Taza', sku: '=HYPERLINK("http://malo.example")', cantidad: 1, precio_referencia: 100 },
    ]))
    const { baseElement } = montar(pedido({ nombre: '<script>alert(1)</script>', mensaje: '<b>hola</b>\n=HYPERLINK("http://malo.example","clic")\njavascript:alert(1)' }))
    expect(screen.getByText('Consulta de <script>alert(1)</script>')).toBeInTheDocument()
    expect(screen.getByText('<img src=x onerror=alert(1)>Taza')).toBeInTheDocument()
    expect(screen.getByText('=HYPERLINK("http://malo.example")')).toBeInTheDocument()
    const nota = screen.getByText(/<b>hola<\/b>/)
    expect(nota.textContent).toBe('<b>hola</b>\n=HYPERLINK("http://malo.example","clic")\njavascript:alert(1)')
    expect(baseElement.querySelector('script')).toBeNull()
    expect(baseElement.querySelector('img[src="x"]')).toBeNull()
    expect(baseElement.querySelector('b')).toBeNull()
  })

  it('«Responder por correo» abre un mailto: codificado con los ítems en el texto inicial', () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Responder por correo' }))
    expect(abrir).toHaveBeenCalledTimes(1)
    const href = abrir.mock.calls[0][0] as string
    expect(href.startsWith('mailto:bruno%40example.com?subject=')).toBe(true)
    const cuerpo = decodeURIComponent(href.split('&body=')[1])
    expect(cuerpo).toBe('Hola Bruno Gómez, recibimos tu pedido:\n• 2 × Joystick Pro (JOY-1)\n• 1 × Cable USB\nTe escribimos para confirmar disponibilidad y precio.')
    expect(href).not.toMatch(/[\n ]/)
  })
})

describe.each(ANCHOS_TIENDA)('accesibilidad del detalle de un pedido a %i px', (ancho) => {
  it('con ítems, cargando y con error: sin violaciones de axe (320 px: pantalla completa y tarjetas)', async () => {
    fijarAncho(ancho)
    const { baseElement, unmount } = montar(pedido({ cliente_id: 'c-1', cliente_numero: 910, cliente_nombre: 'Mayorista Cuenta' }))
    if (ancho === 320) expect(within(screen.getByTestId('bloque-pedido')).getByRole('list', { name: 'Productos del pedido' })).toBeInTheDocument()
    else expect(within(screen.getByTestId('bloque-pedido')).getByRole('table', { name: 'Productos del pedido' })).toBeInTheDocument()
    expect(await violacionesAxe(baseElement)).toEqual([])
    unmount()
    mocks.useItemsConsulta.mockReturnValue({ fase: 'cargando', items: [], reintentar: mocks.reintentar })
    const cargando = montar()
    expect(await violacionesAxe(cargando.baseElement)).toEqual([])
    cargando.unmount()
    mocks.useItemsConsulta.mockReturnValue({ fase: 'error', items: [], reintentar: mocks.reintentar })
    const conError = montar()
    expect(await violacionesAxe(conError.baseElement)).toEqual([])
  }, 60000)
})
