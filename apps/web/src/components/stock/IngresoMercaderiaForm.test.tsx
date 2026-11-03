import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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

  it('[MSF-601] la nota del depósito no usa jerga interna', async () => {
    abrir()
    expect(await screen.findByText('El stock ingresado suma al depósito principal.')).toBeInTheDocument()
    expect(screen.queryByText(/épica/i)).not.toBeInTheDocument()
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
})
