import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FORMULARIO_PRODUCTO_VACIO } from '../../lib/productos'
import { ErrorGuardarVariantes, type FilaVariante, TEXTO_SIN_VARIANTES } from '../../lib/productos-variantes'

const mocks = vi.hoisted(() => ({
  useCotizacionInicial: vi.fn(),
  useProveedoresBasico: vi.fn(),
  useEmpresas: vi.fn(),
  useCategorias: vi.fn(),
  useAlicuotas: vi.fn(),
}))

vi.mock('../../hooks/useCotizacionInicial', () => ({ useCotizacionInicial: mocks.useCotizacionInicial }))
vi.mock('../../hooks/useProveedoresBasico', () => ({ useProveedoresBasico: mocks.useProveedoresBasico }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: mocks.useCategorias }))
vi.mock('../../hooks/useAlicuotas', () => ({ useAlicuotas: mocks.useAlicuotas }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('./BloqueRelacionados', () => ({ BloqueRelacionados: () => null }))

import { FormularioProducto } from './FormularioProducto'

const INICIAL = { ...FORMULARIO_PRODUCTO_VACIO, nombre: 'Remera', sku: 'REM-1', precio_lista: '20' }

const abrir = (extra: Partial<React.ComponentProps<typeof FormularioProducto>> = {}) =>
  render(
    <MemoryRouter>
      <FormularioProducto
        inicial={INICIAL}
        conCosto={false}
        etiquetaGuardar="Crear producto"
        onGuardar={vi.fn().mockResolvedValue(undefined)}
        rutaCancelar="/"
        {...extra}
      />
    </MemoryRouter>,
  )

describe('FormularioProducto · regresión sin variantes (F-CAT-15, FR-004, SC-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCotizacionInicial.mockReturnValue({ cotizacion: null, cargando: false, hayError: false, recargar: vi.fn() })
    mocks.useProveedoresBasico.mockReturnValue({ proveedores: [], cargando: false, hayError: false, recargar: vi.fn() })
    mocks.useEmpresas.mockReturnValue({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useCategorias.mockReturnValue({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useAlicuotas.mockReturnValue({ alicuotas: [], porId: new Map(), isLoading: false, isError: false, refetch: vi.fn() })
  })

  it('sin variantes muestra el texto del prototipo y guarda el formulario con la lista vacía', async () => {
    const onGuardar = vi.fn().mockResolvedValue(undefined)
    abrir({ onGuardar, verStock: true, editarStock: true })
    expect(screen.getByRole('heading', { name: 'Variantes' })).toBeInTheDocument()
    expect(screen.getByText(TEXTO_SIN_VARIANTES)).toBeInTheDocument()
    expect(screen.queryByText(/Stock del producto/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(1))
    expect(onGuardar.mock.calls[0][7]).toEqual([])
  })

  it('sin acceso a Stock la columna muestra «—» y el formulario sigue igual', () => {
    abrir({ variantesIniciales: [{ clave: 'c1', id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigoBarras: '', activa: true, stock: null }] })
    expect(screen.getByLabelText('Nombre de la variante 1')).toHaveValue('Negro')
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Remera')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Precio de lista/)).toHaveValue('20')
    expect(screen.queryByText(/Stock del producto/)).not.toBeInTheDocument()
  })

  it('un código repetido queda en el campo de la variante conservando lo escrito (FR-002)', async () => {
    const variante: FilaVariante = { clave: 'c1', id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigoBarras: '', activa: true, stock: 4 }
    const onGuardar = vi.fn().mockRejectedValue(new ErrorGuardarVariantes({
      code: '23505', message: 'El código "REM-1-N" ya lo usa otra variante', details: 'codigo',
    }))
    abrir({ onGuardar, variantesIniciales: [variante], verStock: true, editarStock: true })
    fireEvent.change(screen.getByLabelText('Código de la variante 1'), { target: { value: 'REM-1-N' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))
    expect((await screen.findAllByText('El código "REM-1-N" ya lo usa otra variante')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Código de la variante 1')).toHaveValue('REM-1-N')
  })

  it('el cambio de empresa en la barra no altera el bloque: no hay consulta ligada a la empresa activa', () => {
    // «No aplica» de la matriz: variantes, stock y producto son de la organización. Se reabre con otra empresa
    // activa simulada (empresas del producto distintas) y el bloque se ve exactamente igual, sin recargar nada.
    const variante: FilaVariante = { clave: 'c1', id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigoBarras: '', activa: true, stock: 4 }
    const { unmount } = abrir({ variantesIniciales: [variante], empresasIniciales: ['emp-1'], verStock: true, editarStock: true })
    expect(screen.getByLabelText('Nombre de la variante 1')).toHaveValue('Negro')
    expect(screen.getByText(/Stock del producto/)).toHaveTextContent('Stock del producto (suma de las variantes activas): 4')
    unmount()
    abrir({ variantesIniciales: [variante], empresasIniciales: ['emp-2'], verStock: true, editarStock: true })
    expect(screen.getByLabelText('Nombre de la variante 1')).toHaveValue('Negro')
    expect(screen.getByText(/Stock del producto/)).toHaveTextContent('Stock del producto (suma de las variantes activas): 4')
  })
})
