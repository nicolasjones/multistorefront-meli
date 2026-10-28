import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agregarItem: vi.fn(),
  quitarItem: vi.fn(),
  buscarProductos: vi.fn(),
  listarDepositosParaRepuesto: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionItems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionItems')>()),
  agregarItem: mocks.agregarItem,
  quitarItem: mocks.quitarItem,
  buscarProductos: mocks.buscarProductos,
  listarDepositosParaRepuesto: mocks.listarDepositosParaRepuesto,
}))

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { MENSAJE_PRECIO, MENSAJE_SIN_STOCK, MENSAJE_SOLO_LECTURA } from '../../lib/reparacionItems'
import type { ItemReparacion, Reparacion } from '../../lib/reparaciones'
import { AgregarManoObraDialog } from './AgregarManoObraDialog'
import { AVISO_CAMBIO_DE_EMPRESA, AgregarRepuestoDialog } from './AgregarRepuestoDialog'
import { AVISO_DEVOLUCION, AYUDA_REPUESTOS, ItemsReparacion } from './ItemsReparacion'

const MANO_OBRA: ItemReparacion = {
  id: 'i-1', tipo: 'mano_obra', descripcion: 'Cambio de pantalla', producto_id: null, sku: null,
  cantidad: 2, precio_unitario: 1500.5, subtotal: 3001, deposito_id: null, deposito_nombre: null, stock_estado: 'sin_movimiento',
}

const REPUESTO: ItemReparacion = {
  id: 'i-2', tipo: 'repuesto', descripcion: 'Pantalla Switch', producto_id: 'p-1', sku: 'PAN-1',
  cantidad: 1, precio_unitario: 200, subtotal: 200, deposito_id: null, deposito_nombre: null, stock_estado: 'sin_movimiento',
}

const reparacion = (extra: Partial<Reparacion> = {}): Reparacion => ({
  id: 'r-1',
  numero: 1,
  codigo: 'R-0001',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente_id: 'c-1',
  cliente: 'Ana Pérez',
  contacto: '11 5555-5555',
  modelo_id: 'm-1',
  equipo: 'Nintendo Switch',
  modelo: 'Lite',
  estado_id: 's-1',
  estado: 'Recibido',
  estado_cierra: false,
  estado_tono: 'neutral',
  numero_serie: 'SN-1',
  accesorios: 'Cargador',
  falla: 'No enciende',
  puede_ver_costos: false,
  costo_mano_obra: null,
  costo_repuestos: null,
  tecnico_id: null,
  ingreso_en: '2026-10-20',
  entrega_prevista: null,
  entrega_real: null,
  entregado_por: null,
  anulada_en: null,
  anulada_motivo: null,
  updated_at: '2026-10-20T10:00:00Z',
  items: [MANO_OBRA, REPUESTO],
  total_mano_obra: 3001,
  total_repuestos: 200,
  total_cliente: 3201,
  ganancia_estimada: null,
  ...extra,
})

const montarSeccion = (extra: Partial<Reparacion> = {}, puedeEditar = true) => {
  const onActualizada = vi.fn()
  render(
    <ItemsReparacion
      reparacion={reparacion(extra)}
      puedeEditar={puedeEditar}
      onAgregarManoObra={vi.fn()}
      onAgregarRepuesto={vi.fn()}
      onActualizada={onActualizada}
    />,
  )
  return { onActualizada }
}

const montarManoObra = () => {
  const onAgregada = vi.fn()
  render(<AgregarManoObraDialog abierto reparacion={reparacion()} onCerrar={vi.fn()} onAgregada={onAgregada} />)
  return { onAgregada }
}

const montarRepuesto = () => {
  const onAgregada = vi.fn()
  const onCerrar = vi.fn()
  const onAviso = vi.fn()
  render(<AgregarRepuestoDialog abierto reparacion={reparacion()} onCerrar={onCerrar} onAgregada={onAgregada} onAviso={onAviso} />)
  return { onAgregada, onCerrar, onAviso }
}

const DEPOSITOS = [
  { deposito_id: 'd-1', nombre: 'Depósito principal', por_defecto: true, cantidad: 5, reservado: 0, disponible: 5 },
  { deposito_id: 'd-2', nombre: 'Local', por_defecto: false, cantidad: 1, reservado: 0, disponible: 1 },
]

// Busca y elige el producto del catálogo para que aparezca el selector de depósito.
const elegirProducto = async (producto: Record<string, unknown> = { id: 'p-1', nombre: 'Pantalla Switch', sku: 'PAN-1' }) => {
  mocks.buscarProductos.mockResolvedValue([producto])
  fireEvent.change(screen.getByRole('combobox', { name: /Buscar producto/ }), { target: { value: 'Pantalla' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Pantalla Switch (PAN-1)' }))
}

const llenarManoObra = (concepto = 'Cambio de pantalla', precio = '1500,50', cantidad = '2') => {
  fireEvent.change(screen.getByLabelText(/Concepto/), { target: { value: concepto } })
  fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: precio } })
  fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: cantidad } })
}

describe('ItemsReparacion (FR-027)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.quitarItem.mockResolvedValue(reparacion({ items: [REPUESTO], total_mano_obra: 0, total_cliente: 200 }))
    mocks.buscarProductos.mockResolvedValue([])
  })

  it('muestra las tablas, los subtotales y el Total al cliente', () => {
    montarSeccion()

    const manoObra = screen.getByRole('table', { name: 'Mano de obra' })
    expect(within(manoObra).getByText('Concepto')).toBeInTheDocument()
    expect(within(manoObra).getByText('Cant.')).toBeInTheDocument()
    expect(within(manoObra).getByText('Precio')).toBeInTheDocument()
    expect(within(manoObra).getByText('Subtotal')).toBeInTheDocument()
    expect(within(manoObra).getByText('Cambio de pantalla')).toBeInTheDocument()
    expect(within(manoObra).getAllByText('$ 3.001,00').length).toBeGreaterThan(0)
    expect(within(manoObra).getByText('Subtotal mano de obra')).toBeInTheDocument()

    const repuestos = screen.getByRole('table', { name: 'Repuestos' })
    expect(within(repuestos).getByText('Producto')).toBeInTheDocument()
    expect(within(repuestos).getByText('Pantalla Switch')).toBeInTheDocument()
    expect(within(repuestos).getByText('SKU PAN-1')).toBeInTheDocument()
    expect(within(repuestos).getByText('Subtotal repuestos')).toBeInTheDocument()

    expect(screen.getAllByText('Mano de obra').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Repuestos').length).toBeGreaterThan(0)
    expect(screen.getByText('Total al cliente')).toBeInTheDocument()
    expect(screen.getAllByText('$ 3.201,00').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Agregar mano de obra' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar repuesto' })).toBeInTheDocument()
  })

  it('con lectura oculta agregar y quitar y avisa que es de solo lectura (SC-005)', () => {
    montarSeccion({}, false)

    expect(screen.getByText('Los ítems son de solo lectura.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar mano de obra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar repuesto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })

  it('quitar pide confirmación y entrega la reparación ya recalculada', async () => {
    const { onActualizada } = montarSeccion()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Cambio de pantalla' }))
    const dialogo = screen.getByRole('dialog')
    expect(within(dialogo).getByText(/¿Quitar «Cambio de pantalla»/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar' }))

    await waitFor(() => expect(mocks.quitarItem).toHaveBeenCalledWith(MANO_OBRA))
    await waitFor(() => expect(onActualizada).toHaveBeenCalledWith(
      expect.objectContaining({ total_cliente: 200 }),
      'Se quitó «Cambio de pantalla»',
    ))
  })

  it('si la base rechaza quitar, muestra el error y no cierra el diálogo', async () => {
    mocks.quitarItem.mockRejectedValueOnce({ code: '55000' })
    const { onActualizada } = montarSeccion()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Cambio de pantalla' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Quitar' }))

    expect(await screen.findByText(MENSAJE_SOLO_LECTURA)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onActualizada).not.toHaveBeenCalled()
  })
})

describe('AgregarManoObraDialog (FR-028)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.agregarItem.mockResolvedValue(reparacion())
  })

  it('valida concepto y precio antes de llamar a la base', async () => {
    montarManoObra()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText('Ingresá el concepto.')).toBeInTheDocument()
    expect(screen.getByText(MENSAJE_PRECIO)).toBeInTheDocument()
    expect(mocks.agregarItem).not.toHaveBeenCalled()
  })

  it('muestra el subtotal en vivo y agrega con cantidad y precio válidos', async () => {
    const { onAgregada } = montarManoObra()
    llenarManoObra()

    expect(screen.getByText('Subtotal: $ 3.001,00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.agregarItem).toHaveBeenCalledWith(
      'r-1',
      'mano_obra',
      expect.objectContaining({ descripcion: 'Cambio de pantalla', cantidad: '2', precio: '1500,50' }),
    ))
    await waitFor(() => expect(onAgregada).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-1' })))
  })

  it('muestra en el campo el error de validación que devuelve la base', async () => {
    mocks.agregarItem.mockRejectedValueOnce({
      code: '22023',
      hint: 'cantidad',
      message: 'La cantidad debe ser un entero de 1 a 9999',
    })
    montarManoObra()
    llenarManoObra()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText('La cantidad debe ser un entero de 1 a 9999')).toBeInTheDocument()
    expect(screen.getByLabelText(/Cantidad/)).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('AgregarRepuestoDialog (FR-025, FR-028)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.agregarItem.mockResolvedValue(reparacion())
    mocks.buscarProductos.mockResolvedValue([])
    mocks.listarDepositosParaRepuesto.mockResolvedValue(DEPOSITOS)
  })

  it('permite cargar un repuesto libre y buscar por Nombre o SKU', async () => {
    const { onAgregada } = montarRepuesto()
    const buscador = screen.getByRole('combobox', { name: /Buscar producto/ })

    fireEvent.change(buscador, { target: { value: 'Cinta flex' } })
    await waitFor(() => expect(mocks.buscarProductos).toHaveBeenCalledWith('Cinta flex'))
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.agregarItem).toHaveBeenCalledWith(
      'r-1',
      'repuesto',
      expect.objectContaining({ descripcion: 'Cinta flex', cantidad: '1', precio: '1200', producto: null }),
    ))
    await waitFor(() => expect(onAgregada).toHaveBeenCalled())
  })

  it('al elegir un producto toma su nombre y no precarga el precio (FR-025)', async () => {
    mocks.buscarProductos.mockResolvedValue([{ id: 'p-1', nombre: 'Pantalla Switch', sku: 'PAN-1' }])
    montarRepuesto()
    const buscador = screen.getByRole('combobox', { name: /Buscar producto/ })

    fireEvent.change(buscador, { target: { value: 'Pantalla' } })
    const opcion = await screen.findByRole('option', { name: 'Pantalla Switch (PAN-1)' })
    fireEvent.click(opcion)

    expect(screen.getByLabelText(/Precio/)).toHaveValue('')
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.agregarItem).toHaveBeenCalledWith(
      'r-1',
      'repuesto',
      expect.objectContaining({
        descripcion: 'Pantalla Switch',
        producto: { id: 'p-1', nombre: 'Pantalla Switch', sku: 'PAN-1' },
      }),
    ))
  })

  it('un repuesto libre no muestra el selector de depósito (FR-005)', () => {
    montarRepuesto()

    expect(screen.queryByText('Depósito de mercadería de donde se descuenta')).not.toBeInTheDocument()
    expect(mocks.listarDepositosParaRepuesto).not.toHaveBeenCalled()
  })

  it('al elegir un producto muestra los depósitos con el disponible y preselecciona el por defecto (FR-006)', async () => {
    montarRepuesto()
    await elegirProducto()

    expect(await screen.findByText('Depósito de mercadería de donde se descuenta')).toBeInTheDocument()
    expect(mocks.listarDepositosParaRepuesto).toHaveBeenCalledWith('p-1')
    const principal = await screen.findByRole('button', { name: 'Depósito principal' })
    expect(principal).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Disponible en Depósito principal: 5 u.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Local' }))
    expect(screen.getByText('Disponible en Local: 1 u.')).toBeInTheDocument()
  })

  it('avisa la falta de stock del depósito elegido cuando la cantidad no alcanza (FR-006)', async () => {
    montarRepuesto()
    await elegirProducto()
    fireEvent.click(await screen.findByRole('button', { name: 'Local' }))
    fireEvent.change(screen.getByLabelText(/Cantidad/), { target: { value: '3' } })

    expect(screen.getByText('Disponible en Local: 1 u. (falta stock: pedí el repuesto al proveedor)')).toBeInTheDocument()
  })

  it('envía el depósito elegido (FR-002)', async () => {
    const { onAgregada } = montarRepuesto()
    await elegirProducto()
    fireEvent.click(await screen.findByRole('button', { name: 'Local' }))
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.agregarItem).toHaveBeenCalledWith(
      'r-1',
      'repuesto',
      expect.objectContaining({ deposito_id: 'd-2', producto: expect.objectContaining({ id: 'p-1' }) }),
    ))
    await waitFor(() => expect(onAgregada).toHaveBeenCalled())
  })

  it('un producto «a pedido» no ofrece depósito porque no descuenta stock (FR-005)', async () => {
    montarRepuesto()
    await elegirProducto({ id: 'p-1', nombre: 'Pantalla Switch', sku: 'PAN-1', disponibilidad_manual: 'a_pedido' })

    expect(await screen.findByText('Producto a pedido: no descuenta stock.')).toBeInTheDocument()
    expect(screen.queryByText('Depósito de mercadería de donde se descuenta')).not.toBeInTheDocument()
    expect(mocks.listarDepositosParaRepuesto).not.toHaveBeenCalled()
  })

  it('muestra «No hay stock suficiente» cuando la base rechaza el descuento (FR-003)', async () => {
    mocks.agregarItem.mockRejectedValueOnce({ code: '23514', message: 'No hay stock suficiente' })
    const { onAgregada } = montarRepuesto()
    await elegirProducto()
    await screen.findByRole('button', { name: 'Depósito principal' })
    fireEvent.change(screen.getByLabelText(/Precio/), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

    expect(await screen.findByText(MENSAJE_SIN_STOCK)).toBeInTheDocument()
    expect(onAgregada).not.toHaveBeenCalled()
  })

  it('si cambia la empresa activa se cierra con aviso y al reabrirlo consulta la disponibilidad otra vez (FR-012)', async () => {
    const onCerrar = vi.fn()
    const onAviso = vi.fn()
    const props = { reparacion: reparacion(), onCerrar, onAviso, onAgregada: vi.fn() }
    const { rerender } = render(<AgregarRepuestoDialog abierto {...props} />)
    await elegirProducto()
    await screen.findByRole('button', { name: 'Depósito principal' })
    expect(mocks.listarDepositosParaRepuesto).toHaveBeenCalledTimes(1)

    act(() => notificarEmpresaActivaCambiada())

    await waitFor(() => expect(onCerrar).toHaveBeenCalledTimes(1))
    expect(onAviso).toHaveBeenCalledWith(AVISO_CAMBIO_DE_EMPRESA)

    rerender(<AgregarRepuestoDialog abierto={false} {...props} />)
    rerender(<AgregarRepuestoDialog abierto {...props} />)
    await elegirProducto()
    await waitFor(() => expect(mocks.listarDepositosParaRepuesto).toHaveBeenCalledTimes(2))
  })
})

describe('Tabla de repuestos con depósito (FR-008, FR-009)', () => {
  it('muestra la columna DEPÓSITO DE MERCADERÍA con el nombre o «—» si no mueve stock', () => {
    const descontado: ItemReparacion = { ...REPUESTO, deposito_id: 'd-1', deposito_nombre: 'Depósito principal', stock_estado: 'descontado' }
    const libre: ItemReparacion = { ...REPUESTO, id: 'i-3', descripcion: 'Cinta flex', producto_id: null, sku: null }
    montarSeccion({ items: [MANO_OBRA, descontado, libre] })

    const repuestos = screen.getByRole('table', { name: 'Repuestos' })
    expect(within(repuestos).getByText('Depósito de mercadería')).toBeInTheDocument()
    expect(within(repuestos).getByText('Depósito principal')).toBeInTheDocument()
    expect(within(repuestos).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Mano de obra' })).queryByText('Depósito de mercadería')).not.toBeInTheDocument()
  })

  it('la ayuda de «Repuestos» dice que el descuento ocurre al agregar', () => {
    montarSeccion()

    expect(screen.getByText(AYUDA_REPUESTOS)).toBeInTheDocument()
    expect(AYUDA_REPUESTOS).toMatch(/al agregar el repuesto/)
  })
})

describe('Devolución de repuestos al quitar (F-SVC-11, FR-025)', () => {
  const descontado: ItemReparacion = { ...REPUESTO, deposito_id: 'd-1', deposito_nombre: 'Depósito principal', stock_estado: 'descontado' }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.quitarItem.mockResolvedValue(reparacion({ items: [], total_repuestos: 0 }))
  })

  it('la confirmación de quitar un repuesto descontado avisa que las unidades vuelven al depósito y recarga', async () => {
    const { onActualizada } = montarSeccion({ items: [descontado] })

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Pantalla Switch' }))
    const dialogo = screen.getByRole('dialog')
    expect(within(dialogo).getByText(AVISO_DEVOLUCION)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar' }))

    await waitFor(() => expect(mocks.quitarItem).toHaveBeenCalledWith(descontado))
    await waitFor(() => expect(onActualizada).toHaveBeenCalledWith(expect.objectContaining({ total_repuestos: 0 }), 'Se quitó «Pantalla Switch»'))
  })

  it('quitar mano de obra o un repuesto que no mueve stock no habla de devolución', () => {
    montarSeccion({ items: [MANO_OBRA, REPUESTO] })

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Pantalla Switch' }))
    expect(within(screen.getByRole('dialog')).queryByText(AVISO_DEVOLUCION)).not.toBeInTheDocument()
  })

  it('en una reparación anulada marca los repuestos «Devuelto» y «Consumido»', () => {
    const devuelto: ItemReparacion = { ...descontado, id: 'i-4', stock_estado: 'devuelto' }
    const consumido: ItemReparacion = { ...descontado, id: 'i-5', descripcion: 'Bisagra', sku: 'BIS-1', stock_estado: 'consumido' }
    montarSeccion({ items: [devuelto, consumido], anulada_en: '2026-10-21T10:00:00Z' }, false)

    const repuestos = screen.getByRole('table', { name: 'Repuestos' })
    expect(within(repuestos).getByText('Devuelto')).toBeInTheDocument()
    expect(within(repuestos).getByText('Consumido')).toBeInTheDocument()
  })
})
