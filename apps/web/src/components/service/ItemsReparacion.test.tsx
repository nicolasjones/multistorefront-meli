import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agregarItem: vi.fn(),
  quitarItem: vi.fn(),
  buscarProductos: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionItems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionItems')>()),
  agregarItem: mocks.agregarItem,
  quitarItem: mocks.quitarItem,
  buscarProductos: mocks.buscarProductos,
}))

import { MENSAJE_PRECIO, MENSAJE_SOLO_LECTURA } from '../../lib/reparacionItems'
import type { ItemReparacion, Reparacion } from '../../lib/reparaciones'
import { AgregarManoObraDialog } from './AgregarManoObraDialog'
import { AgregarRepuestoDialog } from './AgregarRepuestoDialog'
import { ItemsReparacion } from './ItemsReparacion'

const MANO_OBRA: ItemReparacion = {
  id: 'i-1', tipo: 'mano_obra', descripcion: 'Cambio de pantalla', producto_id: null, sku: null,
  cantidad: 2, precio_unitario: 1500.5, subtotal: 3001,
}

const REPUESTO: ItemReparacion = {
  id: 'i-2', tipo: 'repuesto', descripcion: 'Pantalla Switch', producto_id: 'p-1', sku: 'PAN-1',
  cantidad: 1, precio_unitario: 200, subtotal: 200,
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
  render(<AgregarRepuestoDialog abierto reparacion={reparacion()} onCerrar={vi.fn()} onAgregada={onAgregada} />)
  return { onAgregada }
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
})
