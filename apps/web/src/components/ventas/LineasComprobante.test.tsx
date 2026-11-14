import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import type { EntradaLinea, LineaComprobante } from '../../lib/ventasLineas'
import { LineasComprobante } from './LineasComprobante'

const mocks = vi.hoisted(() => ({ imagenes: vi.fn() }))
vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: mocks.imagenes }))

const DEPOSITOS = [
  { id: 'd-1', nombre: 'Principal', por_defecto: true },
  { id: 'd-2', nombre: 'Local', por_defecto: false },
]

const linea = (cambios: Partial<LineaComprobante> = {}): LineaComprobante => ({
  id: 'l-1',
  orden: 1,
  producto_id: 'p-1',
  descripcion: 'Joystick',
  codigo: 'JOY-1',
  cantidad: 5,
  precio_unitario: 800,
  escala: 'x10',
  precio_manual: false,
  alicuota_porcentaje: 21,
  deposito_id: 'd-1',
  deposito: 'Principal',
  a_pedido: false,
  stock: 10,
  reservado: 3,
  subtotal_sin_iva: 8000,
  iva: 1680,
  ...cambios,
})

type Opciones = {
  puedeEditarPrecio?: boolean
  editable?: boolean
  onCambiar?: (indice: number, cambio: Partial<EntradaLinea>) => void
  onQuitar?: (indice: number) => void
}

function montar(lineas: LineaComprobante[], opciones: Opciones = {}) {
  const onCambiar = opciones.onCambiar ?? vi.fn<(indice: number, cambio: Partial<EntradaLinea>) => void>()
  const onQuitar = opciones.onQuitar ?? vi.fn<(indice: number) => void>()
  const { container } = render(
    <LineasComprobante
      lineas={lineas}
      totales={{ subtotal: 8000, iva: 1680, total: 9680 }}
      depositos={DEPOSITOS}
      editable={opciones.editable ?? true}
      puedeEditarPrecio={opciones.puedeEditarPrecio ?? true}
      ocupado={false}
      onCambiar={onCambiar}
      onQuitar={onQuitar}
      onAgregar={vi.fn()}
    />,
  )
  return { onCambiar, onQuitar, container }
}

beforeEach(() => mocks.imagenes.mockReturnValue(new Map()))

describe('LineasComprobante · miniatura del producto', () => {
  it('muestra la imagen principal del producto junto al nombre y pide solo los productos de las líneas', () => {
    mocks.imagenes.mockReturnValue(new Map([['p-1', 'https://img/joystick.png']]))
    montar([linea(), linea({ id: 'l-2', producto_id: null, sin_stock: true, descripcion: 'Mano de obra' })])
    expect(document.querySelector('img[src="https://img/joystick.png"]')).not.toBeNull()
    expect(mocks.imagenes).toHaveBeenCalledWith(['p-1', null])
  })

  it('sin imagen dibuja el marcador vacío y no rompe la fila', () => {
    mocks.imagenes.mockReturnValue(new Map())
    montar([linea()])
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('Joystick')).toBeInTheDocument()
  })
})

describe('LineasComprobante · columnas, disponible y totales (FR-017, FR-019)', () => {
  it('muestra las columnas del prototipo y el pie Subtotal sin IVA / IVA / Total', () => {
    montar([linea()])
    for (const columna of ['Producto', 'Stock', 'Depósito de mercadería', 'Cantidad', 'Precio s/IVA', 'Subtotal']) {
      expect(screen.getByRole('columnheader', { name: columna })).toBeInTheDocument()
    }
    const pie = screen.getByLabelText('Totales del comprobante')
    expect(within(pie).getByText('$ 8.000')).toBeInTheDocument()
    expect(within(pie).getByText('$ 1.680')).toBeInTheDocument()
    expect(within(pie).getByText('$ 9.680')).toBeInTheDocument()
    expect(screen.getAllByText('escala x10')[0]).toBeInTheDocument()
  })

  it('muestra Disp. = stock del depósito menos lo reservado y Res.', () => {
    montar([linea()])
    const stock = screen.getAllByRole('cell')[1]
    expect(stock).toHaveTextContent('Disp. 7')
    expect(stock).toHaveTextContent('Res. 3')
  })

  it('avisa el faltante cuando la cantidad supera el disponible (no bloquea el borrador)', () => {
    montar([linea({ cantidad: 9 })])
    expect(screen.getByRole('alert')).toHaveTextContent('Hay 7 disponibles en Principal y la línea pide 9')
  })

  it('un producto «A pedido» indica que no descuenta stock y no muestra disponible', () => {
    montar([linea({ a_pedido: true, cantidad: 2, stock: 0, reservado: 0 })])
    expect(screen.getByText('A pedido · no descuenta stock')).toBeInTheDocument()
    const stock = screen.getAllByRole('cell')[1]
    expect(stock).not.toHaveTextContent('Disp.')
    expect(stock).toHaveTextContent('Res. 2')
  })

  it('sin permiso el precio es de solo lectura y lo explica', () => {
    montar([linea()], { puedeEditarPrecio: false })
    expect(screen.queryByRole('textbox', { name: 'Precio sin IVA de Joystick' })).not.toBeInTheDocument()
    expect(screen.getByText(/Tu rol no puede editar precios/)).toBeInTheDocument()
    expect(screen.getByText('$ 800')).toBeInTheDocument()
  })
})

describe('LineasComprobante · precio promocional (MSF-816, FR-016)', () => {
  it('con promoción muestra el cobrado, el precio anterior tachado y la leyenda «Promoción»', () => {
    montar([linea({ precio_unitario: 800, precio_referencia: 1000 })], { puedeEditarPrecio: false })
    expect(screen.getByText('$ 800')).toBeInTheDocument()
    // El tachado no es lo único que lo dice: el lector de pantalla oye los dos precios.
    expect(screen.getByText('Precio promocional')).toBeInTheDocument()
    expect(screen.getByText('Precio anterior')).toBeInTheDocument()
    const tachado = document.querySelector('del')
    expect(tachado).toHaveTextContent('$ 1.000')
    expect(screen.getByText('Promoción')).toBeInTheDocument()
  })

  it('con el precio editable la referencia tachada y la leyenda siguen visibles', () => {
    montar([linea({ precio_unitario: 800, precio_referencia: 1000 })])
    expect(screen.getByRole('textbox', { name: 'Precio sin IVA de Joystick' })).toHaveValue('800')
    expect(document.querySelector('del')).toHaveTextContent('$ 1.000')
    expect(screen.getByText('Promoción')).toBeInTheDocument()
  })

  it('con promoción omite el rótulo de escala y el descuento', () => {
    montar([linea({ precio_unitario: 800, precio_referencia: 1000, escala: 'x10', descuento_pct: 15 })], { puedeEditarPrecio: false })
    expect(screen.queryByText(/escala x10/)).not.toBeInTheDocument()
    expect(screen.queryByText(/de descuento/)).not.toBeInTheDocument()
    expect(screen.getByText('Promoción')).toBeInTheDocument()
  })

  it('sin promoción no muestra tachado ni leyenda: el rótulo sigue siendo la escala', () => {
    montar([linea()], { puedeEditarPrecio: false })
    expect(document.querySelector('del')).toBeNull()
    expect(screen.queryByText('Promoción')).not.toBeInTheDocument()
    expect(screen.getAllByText('escala x10')[0]).toBeInTheDocument()
  })

  it('un precio manual no lleva leyenda de promoción', () => {
    montar([linea({ precio_manual: true, precio_unitario: 950, precio_referencia: 1000 })], { puedeEditarPrecio: false })
    expect(screen.queryByText('Promoción')).not.toBeInTheDocument()
    expect(screen.getByText('precio manual')).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px con una línea en promoción', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = montar([linea({ precio_unitario: 800, precio_referencia: 1000 })])
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('LineasComprobante · recálculo al cambiar cantidad, depósito o precio (FR-014, FR-019)', () => {
  it('los botones − / + cambian la cantidad y la envían', () => {
    const { onCambiar } = montar([linea()])
    fireEvent.click(screen.getByRole('button', { name: 'Más unidades de Joystick' }))
    expect(onCambiar).toHaveBeenLastCalledWith(0, { cantidad: 6 })
    fireEvent.click(screen.getByRole('button', { name: 'Menos unidades de Joystick' }))
    expect(onCambiar).toHaveBeenLastCalledWith(0, { cantidad: 4 })
  })

  it('cambiar la cantidad escrita dispara el recálculo al salir del campo', () => {
    const { onCambiar } = montar([linea()])
    const campo = screen.getByRole('textbox', { name: 'Cantidad de Joystick' })
    fireEvent.change(campo, { target: { value: '12' } })
    fireEvent.blur(campo)
    expect(onCambiar).toHaveBeenLastCalledWith(0, { cantidad: 12 })
  })

  it('una cantidad inválida no se envía y muestra el mensaje', () => {
    const { onCambiar } = montar([linea()])
    const campo = screen.getByRole('textbox', { name: 'Cantidad de Joystick' })
    fireEvent.change(campo, { target: { value: '0' } })
    fireEvent.blur(campo)
    expect(onCambiar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Ingresá una cantidad entera de 1')
  })

  it('cambiar el depósito de la línea lo envía', () => {
    const { onCambiar } = montar([linea()])
    fireEvent.click(screen.getByRole('button', { name: 'Local' }))
    expect(onCambiar).toHaveBeenLastCalledWith(0, { deposito_id: 'd-2' })
  })

  it('con permiso el precio es editable y el valor nuevo queda marcado como manual', () => {
    const { onCambiar } = montar([linea()])
    const campo = screen.getByRole('textbox', { name: 'Precio sin IVA de Joystick' })
    fireEvent.change(campo, { target: { value: '950,50' } })
    fireEvent.blur(campo)
    expect(onCambiar).toHaveBeenLastCalledWith(0, { precio_manual: 950.5 })
  })

  it('vaciar el precio vuelve al precio de la escala', () => {
    const { onCambiar } = montar([linea({ precio_manual: true, precio_unitario: 950 })])
    const campo = screen.getByRole('textbox', { name: 'Precio sin IVA de Joystick' })
    fireEvent.change(campo, { target: { value: '' } })
    fireEvent.blur(campo)
    expect(onCambiar).toHaveBeenLastCalledWith(0, { precio_manual: null })
  })

  it('quitar la línea avisa el índice', () => {
    const { onQuitar } = montar([linea()])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Joystick' }))
    expect(onQuitar).toHaveBeenCalledWith(0)
  })

  it('sin líneas muestra el vacío con «Agregar producto»', () => {
    montar([])
    expect(screen.getByText('Todavía no agregaste productos. Usá «Agregar producto» para empezar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar producto' })).toBeInTheDocument()
  })
})
