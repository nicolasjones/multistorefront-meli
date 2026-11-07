import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCategorias: vi.fn(),
  rpc: vi.fn(),
  insertarImagen: vi.fn(),
  subir: vi.fn(),
  quitarArchivo: vi.fn(),
  leerImagenes: vi.fn(),
  useNivelSeccion: vi.fn(),
  useProveedoresBasico: vi.fn(),
  useCotizacionInicial: vi.fn(),
  useEmpresas: vi.fn(),
  useAlicuotas: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({ from: () => ({
        insert: mocks.insertarImagen,
        select: () => ({ eq: () => ({ order: () => ({ returns: mocks.leerImagenes }) }) }),
      }) }),
    storage: { from: () => ({ upload: mocks.subir, remove: mocks.quitarArchivo }) },
  },
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../hooks/useCotizacionInicial', () => ({ useCotizacionInicial: mocks.useCotizacionInicial }))
vi.mock('../../hooks/useAlicuotas', () => ({ useAlicuotas: mocks.useAlicuotas }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ProductoCreate } from '../../pages/productos/create'

const niveles = (productos: string, rentabilidad: string) =>
  mocks.useNivelSeccion.mockImplementation((seccion: string) => ({
    nivel: seccion === 'productos' ? productos : rentabilidad,
    isLoading: false,
  }))

const A21 = { id: 'a21', nombre: '21 %', porcentaje: 21, exento: false }
const A105 = { id: 'a105', nombre: '10,5 %', porcentaje: 10.5, exento: false }
const EXENTO = { id: 'ex', nombre: 'Exento', porcentaje: 0, exento: true }

const EMPRESAS = [
  { id: 'emp-1', nombre: 'San Javucho', activa: true },
  { id: 'emp-2', nombre: 'Mundo JC', activa: true },
]

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

describe('FormularioProducto · campo «Compatible con» (F-CAT-09, FR-001: regresión)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCategorias.mockReturnValue({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() })
    niveles('edicion', 'ninguno')
    mocks.useCotizacionInicial.mockReturnValue({ cotizacion: null, cargando: false, hayError: false, recargar: vi.fn() })
    mocks.useAlicuotas.mockReturnValue({ alicuotas: [A21, A105, EXENTO], porId: new Map([[A21.id, A21], [A105.id, A105], [EXENTO.id, EXENTO]]), isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresas.mockReturnValue({ empresas: EMPRESAS, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useProveedoresBasico.mockReturnValue({ proveedores: [], cargando: false, hayError: false, recargar: vi.fn() })
    mocks.rpc.mockResolvedValue({ data: { id: 'p-9', organizacion_id: 'org-1', nombre: 'Joystick Pro' }, error: null })
    mocks.subir.mockResolvedValue({ error: null })
    mocks.insertarImagen.mockResolvedValue({ error: null })
    mocks.quitarArchivo.mockResolvedValue({ error: null })
    mocks.leerImagenes.mockResolvedValue({ data: [], error: null })
  })

  it('sigue siendo texto separado por comas y se guarda como lista sin repetidos ni vacíos', async () => {
    abrir()
    completar()
    expect(screen.getByText('Separá los valores con comas, por ejemplo: PS5, Xbox')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Compatible con'), { target: { value: 'PS5, Xbox, PS5, ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('crear_producto', expect.objectContaining({ p_compatible_con: ['PS5', 'Xbox'] })),
    )
  })

  it('rechaza más de 50 valores sin guardar', async () => {
    abrir()
    completar()
    const muchos = Array.from({ length: 51 }, (_, i) => `M${i}`).join(', ')
    fireEvent.change(screen.getByLabelText('Compatible con'), { target: { value: muchos } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect(await screen.findByText('Faltan datos obligatorios')).toBeInTheDocument()
    expect(screen.getByLabelText('Compatible con')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
