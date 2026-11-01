import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  or: vi.fn(),
  proveedores: vi.fn(),
  productos: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
  useRegistrarIngreso: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: (tabla: string) => {
        const cadena = {
          select: () => cadena,
          eq: () => cadena,
          order: () => cadena,
          or: (...argumentos: unknown[]) => { mocks.or(...argumentos); return cadena },
          limit: () => cadena,
          returns: tabla === 'proveedores' ? mocks.proveedores : mocks.productos,
        }
        return cadena
      },
    }),
  },
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useRegistrarIngreso', () => ({ useRegistrarIngreso: mocks.useRegistrarIngreso }))

import { IngresoMercaderiaForm } from './IngresoMercaderiaForm'

const EMPRESA = '11111111-1111-1111-1111-111111111111'

const abrir = () => render(<IngresoMercaderiaForm onRegistrado={vi.fn()} />)

describe('IngresoMercaderiaForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: EMPRESA, nombre: 'Tienda Uno', esActiva: true, rolId: 'administrador' }],
      empresaActivaId: EMPRESA,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mocks.useNivelSeccion.mockImplementation((seccion: string) => ({ nivel: seccion === 'rentabilidad' ? 'edicion' : 'edicion', isLoading: false }))
    mocks.useRegistrarIngreso.mockReturnValue({ registrar: vi.fn(), enviando: false })
    mocks.proveedores.mockResolvedValue({ data: [{ id: '22222222-2222-2222-2222-222222222222', razon_social: 'Proveedor Uno' }], error: null })
    mocks.productos.mockResolvedValue({ data: [{ id: '33333333-3333-3333-3333-333333333333', nombre: 'Producto Uno', sku: 'SKU-1', proveedor_id: '22222222-2222-2222-2222-222222222222' }], error: null })
  })

  it('muestra el formulario y valida los campos obligatorios antes de enviar', async () => {
    abrir()
    expect(await screen.findByText('Nuevo ingreso')).toBeInTheDocument()
    const boton = screen.getByRole('button', { name: 'Registrar ingreso' })
    await waitFor(() => expect(boton).not.toBeDisabled())
    fireEvent.click(boton)

    expect(await screen.findByText('Elegí el proveedor.')).toBeInTheDocument()
    expect(screen.getByText('Elegí un producto.')).toBeInTheDocument()
    expect(screen.getByText('Costo en USD con hasta dos decimales.')).toBeInTheDocument()
  })

  it('agrega y quita líneas de producto', async () => {
    abrir()
    await screen.findByText('Nuevo ingreso')
    fireEvent.click(screen.getByRole('button', { name: 'Agregar producto' }))
    expect(screen.getByLabelText('Producto 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el producto 2' }))
    expect(screen.queryByLabelText('Producto 2')).not.toBeInTheDocument()
  })

  it('oculta la casilla de costo sin edición en Rentabilidad', async () => {
    mocks.useNivelSeccion.mockImplementation((seccion: string) => ({ nivel: seccion === 'rentabilidad' ? 'lectura' : 'edicion', isLoading: false }))
    abrir()
    await screen.findByText('Nuevo ingreso')
    expect(screen.queryByLabelText('Actualizar el costo del producto con este ingreso')).not.toBeInTheDocument()
  })

  it('no renderiza el formulario con Stock en solo lectura', async () => {
    mocks.useNivelSeccion.mockImplementation(() => ({ nivel: 'lectura', isLoading: false }))
    abrir()
    await waitFor(() => expect(screen.queryByText('Nuevo ingreso')).not.toBeInTheDocument())
  })

  it('avisa cuando el catálogo de productos supera el tope y no deja de avisar tras elegir', async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => ({ id: `p-${i}`, nombre: `Producto ${String(i).padStart(3, '0')}`, sku: null, proveedor_id: null }))
    mocks.productos.mockResolvedValue({ data: muchos, error: null })
    abrir()
    const campo = await screen.findByLabelText('Producto 1')
    fireEvent.mouseDown(campo)
    expect(await screen.findByText(/Hay más de 500 productos/)).toBeInTheDocument()
    expect(await screen.findAllByRole('option')).toHaveLength(500)
    fireEvent.click(screen.getByRole('option', { name: 'Producto 000' }))
    expect(screen.getByText(/Hay más de 500 productos/)).toBeInTheDocument()
  })

  it('busca en el servidor y permite elegir un producto fuera de los primeros 500', async () => {
    mocks.productos.mockResolvedValueOnce({ data: [{ id: 'p-0', nombre: 'Alfa', sku: null, proveedor_id: null }], error: null })
    abrir()
    const campo = await screen.findByLabelText('Producto 1')
    fireEvent.mouseDown(campo)
    await screen.findByRole('option', { name: 'Alfa' })

    mocks.productos.mockResolvedValue({ data: [{ id: 'p-999', nombre: 'Zeta final', sku: 'Z_1', proveedor_id: null }], error: null })
    fireEvent.change(campo, { target: { value: 'Z_1,(x)' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Zeta final · Z_1' }))

    expect(mocks.or).toHaveBeenCalledWith('nombre.ilike.%Z\\_1  x%,sku.ilike.%Z\\_1  x%')
    expect(campo).toHaveValue('Zeta final · Z_1')
  })

  it('busca el proveedor en el servidor y avisa si el catálogo se cortó', async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => ({ id: `pr-${i}`, razon_social: `Proveedor ${String(i).padStart(3, '0')}` }))
    mocks.proveedores.mockResolvedValue({ data: muchos, error: null })
    abrir()
    const campo = await screen.findByLabelText('Proveedor')
    fireEvent.mouseDown(campo)
    expect(await screen.findByText(/Hay más de 500 proveedores/)).toBeInTheDocument()
    fireEvent.change(campo, { target: { value: 'importadora' } })
    await waitFor(() => expect(mocks.or).toHaveBeenCalledWith('razon_social.ilike.%importadora%'))
  })

  it('conserva el producto elegido cuando cambia la búsqueda', async () => {
    abrir()
    const campoProveedor = await screen.findByLabelText('Proveedor')
    fireEvent.mouseDown(campoProveedor)
    fireEvent.click(await screen.findByRole('option', { name: 'Proveedor Uno' }))

    const campo = await screen.findByLabelText('Producto 1')
    fireEvent.mouseDown(campo)
    fireEvent.click(await screen.findByRole('option', { name: 'Producto Uno · SKU-1' }))
    expect(screen.getByText('Proveedor del producto: coincide')).toBeInTheDocument()

    mocks.productos.mockResolvedValue({ data: [{ id: 'otro', nombre: 'Otro', sku: null, proveedor_id: null }], error: null })
    fireEvent.change(campo, { target: { value: 'otro' } })
    await waitFor(() => expect(mocks.or).toHaveBeenCalled())
    expect(screen.getByText('Proveedor del producto: coincide')).toBeInTheDocument()
  })

  it('muestra el error de búsqueda de productos sin romper el formulario', async () => {
    mocks.productos.mockResolvedValue({ data: null, error: { message: 'boom' } })
    abrir()
    fireEvent.mouseDown(await screen.findByLabelText('Producto 1'))
    expect(await screen.findAllByText('No pudimos buscar productos. Probá de nuevo.')).not.toHaveLength(0)
  })
})
