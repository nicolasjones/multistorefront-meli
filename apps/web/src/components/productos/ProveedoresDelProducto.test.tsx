import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), recargar: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useProveedoresBasico', () => ({
  useProveedoresBasico: () => ({
    proveedores: [
      { id: 'prv-a', razon_social: 'Proveedor A', activo: true },
      { id: 'prv-b', razon_social: 'Proveedor B', activo: true },
      { id: 'prv-c', razon_social: 'Proveedor C', activo: true },
      { id: 'prv-x', razon_social: 'Proveedor Inactivo', activo: false },
    ],
    cargando: false,
    hayError: false,
    recargar: mocks.recargar,
  }),
}))

import { violacionesAxe } from '../../test/axe'
import { ProveedoresDelProducto } from './ProveedoresDelProducto'

const A = { proveedor_id: 'prv-a', razon_social: 'Proveedor A', activo: true, codigo_proveedor: 'A-1', costo: '100.00', principal: true }
const B = { proveedor_id: 'prv-b', razon_social: 'Proveedor B', activo: true, codigo_proveedor: null, costo: null, principal: false }
const X = { proveedor_id: 'prv-x', razon_social: 'Proveedor Inactivo', activo: false, codigo_proveedor: null, costo: null, principal: false }

const abrir = (props: Partial<Parameters<typeof ProveedoresDelProducto>[0]> = {}) =>
  render(<ProveedoresDelProducto productoId="p-1" moneda="USD" puedeEditar veCosto editaCosto {...props} />)

const responder = (vinculos: unknown[], escritura: { error?: unknown } = {}) =>
  mocks.rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'listar_proveedores_de_producto') return { data: vinculos, error: null }
    return { data: null, error: escritura.error ?? null }
  })

describe('ProveedoresDelProducto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    responder([A, B])
  })

  it('lista proveedor, código y costo con la marca de principal', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Proveedores del producto' })
    expect(within(tabla).getByText('Proveedor A')).toBeInTheDocument()
    expect(within(tabla).getByText('Principal')).toBeInTheDocument()
    expect(within(tabla).getByText('A-1')).toBeInTheDocument()
    expect(within(tabla).getByText('USD 100,00')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('listar_proveedores_de_producto', { p_producto_id: 'p-1' })
  })

  it('sin Rentabilidad no hay columna Costo; sin edición no hay acciones', async () => {
    abrir({ veCosto: false, editaCosto: false, puedeEditar: false })
    const tabla = await screen.findByRole('table', { name: 'Proveedores del producto' })
    expect(within(tabla).queryByRole('columnheader', { name: 'Costo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar proveedor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar a/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar a/ })).not.toBeInTheDocument()
  })

  it('sin proveedores muestra el estado vacío; un error de carga ofrece reintentar', async () => {
    responder([])
    const { unmount } = abrir()
    expect(await screen.findByText('Este producto todavía no tiene proveedores.')).toBeInTheDocument()
    unmount()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los proveedores del producto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar proveedor' })).toBeDisabled()
  })

  it('«Marcar como principal» llama a la función, recarga y avisa al producto', async () => {
    const onCambiado = vi.fn()
    abrir({ onCambiado })
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a Proveedor B como principal' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('marcar_proveedor_principal', { p_producto_id: 'p-1', p_proveedor_id: 'prv-b' }))
    await waitFor(() => expect(onCambiado).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Proveedor B es ahora el proveedor principal')).toBeInTheDocument()
    // El que ya es principal no ofrece la acción.
    expect(screen.queryByRole('button', { name: 'Marcar a Proveedor A como principal' })).not.toBeInTheDocument()
  })

  it('un proveedor desactivado no se puede marcar como principal', async () => {
    responder([A, X])
    abrir()
    expect(await screen.findByRole('button', { name: 'Marcar a Proveedor Inactivo como principal' })).toBeDisabled()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('un error al marcar se muestra sin el texto crudo', async () => {
    responder([A, B], { error: { code: 'PT409', message: 'texto interno', details: 'proveedor_inactivo' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a Proveedor B como principal' }))
    expect(await screen.findByText('El proveedor está desactivado: reactivalo antes de asignarlo o marcarlo como principal.')).toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
  })

  it('sin Rentabilidad, marcar como principal a un proveedor con otro costo explica el motivo real (no «desactivado»)', async () => {
    responder([A, B], { error: { code: 'PT409', message: 'texto interno', details: 'rentabilidad' } })
    abrir({ veCosto: false, editaCosto: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a Proveedor B como principal' }))
    expect(await screen.findByText('Ese proveedor tiene otro costo: cambiar el proveedor principal modifica el costo del producto y necesitás edición en Rentabilidad.')).toBeInTheDocument()
    expect(screen.queryByText(/desactivado/)).not.toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
  })

  it('el mismo rechazo al agregar un proveedor como principal se muestra en el diálogo', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === 'listar_proveedores_de_producto'
        ? { data: [A, B], error: null }
        : { data: null, error: { code: 'PT409', message: 'texto interno', details: 'rentabilidad' } })
    abrir({ editaCosto: false, veCosto: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Proveedor B' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar Proveedor B' })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Proveedor principal' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))
    expect(await within(dialogo).findByText(/necesitás edición en Rentabilidad/)).toBeInTheDocument()
    expect(within(dialogo).queryByText(/desactivado/)).not.toBeInTheDocument()
  })

  it('«Quitar» pide confirmación: avisa si es el principal y recién al confirmar llama a la función', async () => {
    const onCambiado = vi.fn()
    abrir({ onCambiado })
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar a Proveedor A' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Quitar proveedor' })
    expect(within(dialogo).getByText(/quedará sin proveedor principal/)).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'quitar_proveedor_producto')).toBe(false)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar proveedor' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('quitar_proveedor_producto', { p_producto_id: 'p-1', p_proveedor_id: 'prv-a' }))
    await waitFor(() => expect(onCambiado).toHaveBeenCalledTimes(1))
  })

  it('cancelar «Quitar» no llama a la base', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar a Proveedor B' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Quitar proveedor' })
    expect(within(dialogo).getByText(/deja de figurar entre los productos de Proveedor B/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quitar proveedor' })).not.toBeInTheDocument())
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'quitar_proveedor_producto')).toBe(false)
  })

  it('«Agregar proveedor» ofrece solo activos que todavía no están y envía código, costo y principal', async () => {
    const onCambiado = vi.fn()
    abrir({ onCambiado })
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar proveedor' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar proveedor' })
    fireEvent.mouseDown(within(dialogo).getByRole('combobox', { name: /Proveedor/ }))
    const opciones = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Proveedor C'])
    fireEvent.click(screen.getByRole('option', { name: 'Proveedor C' }))
    fireEvent.change(within(dialogo).getByLabelText('Código del proveedor'), { target: { value: ' C-9 ' } })
    fireEvent.change(within(dialogo).getByLabelText('Costo (USD)'), { target: { value: '12,5' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Proveedor principal' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Agregar proveedor' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_proveedor_producto', {
      p_producto_id: 'p-1', p_proveedor_id: 'prv-c', p_codigo_proveedor: 'C-9', p_costo: 12.5, p_principal: true,
    }))
    expect(await screen.findByText('Proveedor agregado')).toBeInTheDocument()
    await waitFor(() => expect(onCambiado).toHaveBeenCalledTimes(1))
  })

  it('agregar sin elegir proveedor o con un costo inválido muestra el error y no llama a la base', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar proveedor' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar proveedor' })
    fireEvent.change(within(dialogo).getByLabelText('Costo (USD)'), { target: { value: 'abc' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Agregar proveedor' }))
    expect(await within(dialogo).findByText('Elegí un proveedor.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá un costo válido, con hasta 2 decimales.')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'asignar_proveedor_producto')).toBe(false)
  })

  it('editar un proveedor existente no permite cambiar de proveedor y, sin Rentabilidad, no ofrece el costo', async () => {
    abrir({ editaCosto: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Proveedor B' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar Proveedor B' })
    expect(within(dialogo).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(dialogo).queryByLabelText(/Costo/)).not.toBeInTheDocument()
    fireEvent.change(within(dialogo).getByLabelText('Código del proveedor'), { target: { value: 'B-2' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_proveedor_producto', {
      p_producto_id: 'p-1', p_proveedor_id: 'prv-b', p_codigo_proveedor: 'B-2', p_costo: null, p_principal: false,
    }))
  })

  it('el principal no ofrece «Proveedor principal» al editarlo', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Proveedor A' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar Proveedor A' })
    expect(within(dialogo).queryByRole('checkbox', { name: 'Proveedor principal' })).not.toBeInTheDocument()
    expect(within(dialogo).getByLabelText('Código del proveedor')).toHaveValue('A-1')
    expect(within(dialogo).getByLabelText('Costo (USD)')).toHaveValue('100')
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px (tabla y diálogo abierto)', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir()
    await screen.findByRole('table', { name: 'Proveedores del producto' })
    expect(await violacionesAxe(document.body)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Agregar proveedor' }))
    await screen.findByRole('dialog', { name: 'Agregar proveedor' })
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
