import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoCreate } from './create'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const abrir = () =>
  render(
    <MemoryRouter initialEntries={['/productos/create']}>
      <Routes>
        <Route path="/productos/create" element={<ProductoCreate />} />
        <Route path="/" element={<p>Inicio</p>} />
      </Routes>
    </MemoryRouter>,
  )

const completar = () => {
  fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Joystick Pro' } })
  fireEvent.change(screen.getByLabelText(/^Precio de lista/), { target: { value: '49,90' } })
}

describe('ProductoCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    niveles('edicion', 'ninguno')
    mocks.rpc.mockResolvedValue({ data: { nombre: 'Joystick Pro' }, error: null })
  })

  it('sin datos obligatorios avisa, marca los campos y no guarda', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Faltan datos obligatorios')).toBeInTheDocument()
    expect(screen.getAllByText(/Ingresá el/).length).toBeGreaterThanOrEqual(2)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('guarda sin stock y confirma el éxito', async () => {
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'crear_producto',
        expect.objectContaining({ p_nombre: 'Joystick Pro', p_precio_lista: 49.9, p_moneda: 'USD', p_costo: null }),
      ),
    )
    expect(Object.keys(mocks.rpc.mock.calls[0][1]).some((clave) => clave.includes('stock'))).toBe(false)
    expect(await screen.findByText('Producto creado')).toBeInTheDocument()
  })

  it('no ofrece stock inicial y muestra el precio en pesos como no disponible', () => {
    abrir()
    expect(screen.queryByLabelText(/stock/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('No disponible')
  })

  it('el Operador no ve el campo Costo', () => {
    abrir()
    expect(screen.queryByLabelText('Costo')).not.toBeInTheDocument()
  })

  it('con edición en Rentabilidad se ve el costo y viaja', async () => {
    niveles('edicion', 'edicion')
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText('Costo'), { target: { value: '1500,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('crear_producto', expect.objectContaining({ p_costo: 1500.5 })))
  })

  it('un error del servidor conserva lo cargado y no filtra el detalle técnico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('No se guardó el producto.')).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
  })

  it('SKU repetido: muestra «Ese SKU ya existe» y conserva lo cargado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "productos_org_sku_uidx"' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: 'ABC-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Ese SKU ya existe')).toBeInTheDocument()
    expect(screen.getByLabelText(/^SKU/)).toBeInvalid()
    expect(screen.getByLabelText(/^SKU/)).toHaveAccessibleDescription('Ese SKU ya existe')
    expect(screen.queryByText(/productos_org_sku_uidx/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
    expect(screen.getByLabelText(/^SKU/)).toHaveValue('ABC-1')
  })

  it('el campo SKU explica que se genera solo si queda vacío', () => {
    abrir()
    expect(screen.getByText('Se genera solo si lo dejás vacío')).toBeInTheDocument()
  })

  it('Cancelar con datos pide confirmar «Descartar cambios»; sin datos sale directo', () => {
    const primera = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByText('Inicio')).toBeInTheDocument()
    primera.unmount()

    abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: 'Descartar cambios' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Joystick Pro')
  })

  it('con solo lectura en Productos no ofrece el formulario', () => {
    niveles('lectura', 'ninguno')
    abrir()
    expect(screen.getByText('Tu rol no puede crear productos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear producto' })).not.toBeInTheDocument()
  })
})
