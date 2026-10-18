import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  proveedor: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.proveedor }) }) }) }),
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProveedorShow } from './show'

const PROVEEDOR = {
  id: 'prv-1', organizacion_id: 'org-1', razon_social: 'Proveedor Uno SA', cuit: '20123456786',
  persona_contacto: 'Ana Pérez', correo: 'ventas@uno.example.com', telefono: '11 5555-0000',
  direccion: 'Calle 1', observaciones: null, activo: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/proveedores/show/prv-1']}>
      <Routes>
        <Route path="/proveedores/show/:id" element={<ProveedorShow />} />
        <Route path="/proveedores" element={<p>Listado de proveedores</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('ProveedorShow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.proveedor.mockResolvedValue({ data: PROVEEDOR, error: null })
    mocks.rpc.mockResolvedValue({ data: { ...PROVEEDOR, activo: false }, error: null })
  })

  it('muestra los datos del proveedor con el CUIT con guiones y — en lo vacío', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Proveedor Uno SA' })).toBeInTheDocument()
    expect(screen.getByText('20-12345678-6')).toBeInTheDocument()
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('ventas@uno.example.com')).toBeInTheDocument()
    expect(screen.getByText('11 5555-0000')).toBeInTheDocument()
    expect(screen.getByText('Calle 1')).toBeInTheDocument()
    expect(screen.getByText('Observaciones').nextElementSibling).toHaveTextContent('—')
    expect(screen.getByText('Activo')).toBeInTheDocument()
    // Sin identificadores técnicos a la vista.
    expect(screen.queryByText('prv-1')).not.toBeInTheDocument()
  })

  it('ofrece volver a Proveedores', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('link', { name: 'Proveedores' }))
    expect(await screen.findByText('Listado de proveedores')).toBeInTheDocument()
  })

  it('con edición muestra Editar y Desactivar, y nunca Eliminar', async () => {
    abrir()
    await screen.findByRole('heading', { name: 'Proveedor Uno SA' })
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('con lectura ve la ficha pero no Editar ni Desactivar', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByRole('heading', { name: 'Proveedor Uno SA' })
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
  })

  it('desactivar pide confirmación y Cancelar no cambia nada', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    expect(screen.getByRole('dialog', { name: 'Desactivar proveedor' })).toBeInTheDocument()
    expect(screen.getByText(/Queda archivado: no se elige en nuevos ingresos ni productos, pero conserva sus datos y se puede reactivar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('confirmar desactiva por la RPC, marca inactivo y ofrece Reactivar', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar proveedor' }))
    expect(await screen.findByText('Proveedor desactivado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_proveedor', { p_id: 'prv-1', p_activo: false })
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
    // El diálogo de confirmación termina de cerrarse antes de que el fondo vuelva a ser accesible.
    expect(await screen.findByRole('button', { name: 'Reactivar' })).toBeInTheDocument()
  })

  it('un proveedor inactivo se ve marcado y Reactivar lo devuelve a activo', async () => {
    mocks.proveedor.mockResolvedValue({ data: { ...PROVEEDOR, activo: false }, error: null })
    mocks.rpc.mockResolvedValue({ data: PROVEEDOR, error: null })
    abrir()
    expect(await screen.findByText('Inactivo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(screen.getByRole('dialog', { name: 'Reactivar proveedor' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar proveedor' }))
    expect(await screen.findByText('Proveedor reactivado')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_proveedor', { p_id: 'prv-1', p_activo: true })
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('si la RPC falla muestra el error en castellano y conserva el estado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table proveedores' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar proveedor' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('Editar abre el diálogo con los datos y, al guardar, actualiza la ficha', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...PROVEEDOR, razon_social: 'Proveedor Uno Nuevo SA' }, error: null })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'Editar proveedor' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Razón social/ }), { target: { value: 'Proveedor Uno Nuevo SA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(await screen.findByText('Proveedor guardado')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proveedor Uno Nuevo SA' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar proveedor' })).not.toBeInTheDocument())
  })

  it('si el proveedor no existe o es de otra organización lo dice', async () => {
    mocks.proveedor.mockResolvedValue({ data: null, error: null })
    abrir()
    expect(await screen.findByText('Proveedor no encontrado')).toBeInTheDocument()
  })

  it('si falla la carga muestra el error con Reintentar y reintenta', async () => {
    mocks.proveedor.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar el proveedor.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Proveedor Uno SA' })).toBeInTheDocument()
  })
})
