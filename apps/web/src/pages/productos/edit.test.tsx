import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  producto: vi.fn(),
  costo: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: (tabla: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: tabla === 'productos' ? mocks.producto : mocks.costo }) }),
      }),
    }),
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoEdit } from './edit'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const PRODUCTO = {
  id: 'p-1', nombre: 'Joystick', descripcion: null, sku: 'JOY-1', compatible_con: ['PS5'],
  moneda: 'USD', precio_lista: 49.9, activo: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/productos/p-1/edit']}>
      <Routes>
        <Route path="/productos/:id/edit" element={<ProductoEdit />} />
        <Route path="/" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('ProductoEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    niveles('edicion', 'edicion')
    mocks.producto.mockResolvedValue({ data: PRODUCTO, error: null })
    mocks.costo.mockResolvedValue({ data: { costo: 20 }, error: null })
    mocks.rpc.mockResolvedValue({ data: PRODUCTO, error: null })
  })

  it('carga el producto y guarda con el updated_at leído (persistencia)', async () => {
    abrir()
    const nombre = await screen.findByLabelText(/^Nombre/)
    expect(nombre).toHaveValue('Joystick')
    expect(screen.getByLabelText('Costo')).toHaveValue('20')
    fireEvent.change(nombre, { target: { value: 'Joystick Pro' } })
    fireEvent.change(screen.getByLabelText(/^Precio de lista/), { target: { value: '59,90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'actualizar_producto',
        expect.objectContaining({
          p_id: 'p-1', p_actualizado_en: PRODUCTO.updated_at, p_nombre: 'Joystick Pro', p_precio_lista: 59.9, p_costo: 20,
        }),
      ),
    )
    expect(await screen.findByText('Producto guardado')).toBeInTheDocument()
  })

  it('con cambios sin guardar, cancelar pide «Descartar cambios»', async () => {
    abrir()
    fireEvent.change(await screen.findByLabelText(/^Nombre/), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('dialog', { name: 'Descartar cambios' })).toBeInTheDocument()
  })

  it('ante un conflicto avisa, conserva lo escrito y permite recargar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    abrir()
    const nombre = await screen.findByLabelText(/^Nombre/)
    fireEvent.change(nombre, { target: { value: 'Mi cambio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó este producto/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Mi cambio')
    mocks.producto.mockResolvedValue({ data: { ...PRODUCTO, nombre: 'Del otro', updated_at: '2026-01-02T00:00:00+00:00' }, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Recargar producto' }))
    await waitFor(() => expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Del otro'))
  })

  it('sin acceso a Rentabilidad oculta el costo y no lo consulta ni lo envía', async () => {
    niveles('edicion', 'ninguno')
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.queryByLabelText('Costo')).not.toBeInTheDocument()
    expect(mocks.costo).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', expect.objectContaining({ p_costo: null })))
  })

  it('con lectura en Rentabilidad muestra el costo de solo lectura', async () => {
    niveles('edicion', 'lectura')
    abrir()
    expect(await screen.findByLabelText('Costo')).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Nuevo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('actualizar_producto', expect.objectContaining({ p_costo: null })))
  })

  it('con solo lectura muestra la ficha sin acción de guardar', async () => {
    niveles('lectura', 'ninguno')
    abrir()
    expect(await screen.findByLabelText(/^Nombre/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument()
  })

  it('un producto inexistente o de otra organización se informa', async () => {
    mocks.producto.mockResolvedValue({ data: null, error: null })
    abrir()
    expect(await screen.findByText('Producto no encontrado')).toBeInTheDocument()
  })

  it('un error de carga permite reintentar', async () => {
    mocks.producto.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar el producto.', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText(/^Nombre/)).toHaveValue('Joystick')
  })

  it('muestra el estado y desactiva con la RPC; recarga la ficha para tomar el updated_at nuevo', async () => {
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    mocks.producto.mockResolvedValue({ data: { ...PRODUCTO, activo: false, updated_at: '2026-01-02T10:00:00+00:00' }, error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Joystick' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_producto', { p_id: 'p-1', p_activo: false }))
    expect(await screen.findByText('Inactivo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar Joystick' })).toBeInTheDocument()
  })

  it('con solo lectura muestra el estado pero no la acción de activar/desactivar', async () => {
    niveles('lectura', 'lectura')
    abrir()
    await screen.findByLabelText(/^Nombre/)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Activar|Desactivar)/ })).not.toBeInTheDocument()
  })
})
