import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useIngresos: vi.fn(),
  rpc: vi.fn(),
  proveedores: vi.fn(),
  empresas: vi.fn(),
  productos: vi.fn(),
}))

vi.mock('../../hooks/useIngresos', () => ({
  TAMANO_PAGINA_INGRESOS: 25,
  useIngresos: mocks.useIngresos,
}))

vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false }) }))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: (tabla: string) => {
        const cadena = {
          select: () => cadena,
          order: () => cadena,
          limit: () => cadena,
          returns: tabla === 'proveedores' ? mocks.proveedores : tabla === 'empresas' ? mocks.empresas : mocks.productos,
        }
        return cadena
      },
    }),
    rpc: mocks.rpc,
  },
}))

import { HistorialIngresos } from './HistorialIngresos'

const FILAS = [
  {
    ingreso_id: 'ingreso-1', fecha: '2026-10-20', creado_en: '2026-10-20T10:00:00Z', estado: 'registrado',
    comprobante: 'R-1', motivo_anulacion: null, anulado_en: null, producto_id: 'producto-1',
    producto_nombre: 'Producto Uno', producto_sku: 'SKU-1', cantidad: 5, costo_unitario_usd: 10,
    destino: 'Depósito principal', empresa: 'Tienda Uno', proveedor: 'Proveedor Uno', operador: 'Nicolás', total: 2,
  },
  {
    ingreso_id: 'ingreso-2', fecha: '2026-10-19', creado_en: '2026-10-19T10:00:00Z', estado: 'anulado',
    comprobante: 'R-2', motivo_anulacion: 'Carga equivocada', anulado_en: '2026-10-20T10:00:00Z', producto_id: 'producto-2',
    producto_nombre: 'Producto Dos', producto_sku: null, cantidad: 1, costo_unitario_usd: 20,
    destino: 'Depósito principal', empresa: 'Tienda Dos', proveedor: 'Proveedor Dos', operador: 'Emilse', total: 2,
  },
]

const abrir = () => render(<HistorialIngresos revision={0} />)

describe('HistorialIngresos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.proveedores.mockResolvedValue({ data: [{ id: 'proveedor-1', razon_social: 'Proveedor Uno' }], error: null })
    mocks.empresas.mockResolvedValue({ data: [{ id: 'empresa-1', nombre: 'Tienda Uno' }], error: null })
    mocks.productos.mockResolvedValue({ data: [{ id: 'producto-1', nombre: 'Producto Uno', sku: 'SKU-1' }], error: null })
    mocks.rpc.mockResolvedValue({ data: [{ actor_id: 'user-1', actor_nombre: 'Nicolás' }], error: null })
    mocks.useIngresos.mockReturnValue({ filas: FILAS, total: 2, hayError: false, cargando: false, recargar: vi.fn() })
  })

  it('ofrece anular solo los ingresos registrados', async () => {
    abrir()
    await screen.findByText('Producto Uno')
    expect(screen.getAllByRole('button', { name: 'Anular' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Anular' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Motivo de la anulación')).toBeInTheDocument()
  })

  it('muestra las filas, el estado anulado y su motivo', async () => {
    abrir()
    expect(await screen.findByText('Producto Uno')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('Proveedor Uno')).toBeInTheDocument()
    expect(screen.getByText('Anulado')).toBeInTheDocument()
    expect(screen.getByText('Carga equivocada')).toBeInTheDocument()
  })

  it('filtra por fecha y vuelve a la primera página', async () => {
    abrir()
    await screen.findByText('Producto Uno')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    await waitFor(() => {
      const ultima = mocks.useIngresos.mock.calls.at(-1)?.[0]
      expect(ultima).toMatchObject({ desde: '2026-10-01', pagina: 1 })
    })
  })

  it('limpia los filtros', async () => {
    abrir()
    await screen.findByText('Producto Uno')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => {
      const ultima = mocks.useIngresos.mock.calls.at(-1)?.[0]
      expect(ultima).toMatchObject({ desde: null, hasta: null, pagina: 1 })
    })
  })

  it('pagina en el servidor', async () => {
    mocks.useIngresos.mockReturnValue({ filas: FILAS, total: 30, hayError: false, cargando: false, recargar: vi.fn() })
    abrir()
    await screen.findByText('Producto Uno')
    fireEvent.click(screen.getByRole('button', { name: /next page|página siguiente/i }))
    await waitFor(() => {
      const ultima = mocks.useIngresos.mock.calls.at(-1)?.[0]
      expect(ultima).toMatchObject({ pagina: 2 })
    })
  })

  it('muestra el vacío con filtros aplicados', async () => {
    mocks.useIngresos.mockReturnValue({ filas: [], total: 0, hayError: false, cargando: false, recargar: vi.fn() })
    abrir()
    expect(await screen.findByText('Todavía no hay ingresos de mercadería.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    expect(await screen.findByText('No hay ingresos con esos filtros.')).toBeInTheDocument()
  })
})
