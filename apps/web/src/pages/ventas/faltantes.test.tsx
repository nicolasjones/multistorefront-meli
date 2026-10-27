import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Test de INTEGRACIÓN de la pantalla: filtros + RPC. Con la suite shardeada el default de 5 s quedaba
// justo y daba falsos rojos. Se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useOrganizacionActiva: vi.fn(),
}))

vi.mock('../../lib/ventasFaltantes', async (original) => ({
  ...(await original<typeof import('../../lib/ventasFaltantes')>()),
  listarFaltantes: mocks.listar,
}))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: mocks.useOrganizacionActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesList } from './faltantes'

const fila = (n: number, empresaId: string, empresa: string) => ({
  id: `f-${n}`,
  empresa_id: empresaId,
  empresa,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  sku: `SKU-${n}`,
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: `comp-${n}`,
  comprobante: `0003-${n}`,
  fecha: '2026-10-01',
  desde: '2026-10-01T10:00:00Z',
  stock_estado: 'disponible' as const,
  stock_disponible: 5,
})

const TODAS = [fila(1, 'e-1', 'San Javucho'), fila(2, 'e-2', 'Mundo JC')]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// La empresa activa manda y el filtro de la pantalla la sobreescribe hasta que cambie (como el hook real).
let empresaActivaId: string | null = null

const abrir = () => render(<MemoryRouter><FaltantesList /></MemoryRouter>)

describe('FaltantesList · empresa activa (F-VTA-18, FR-044, FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    empresaActivaId = null
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useOrganizacionActiva.mockReturnValue({ organizacionActiva: { id: 'org-1' }, isLoading: false })
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => ({
      empresas,
      valor: empresaActivaId,
      cambiar: vi.fn(),
      empresaActivaId,
      cargando: false,
      hayError: false,
    }))
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: filas.length }
    })
  })

  it('lista los faltantes de todas las tiendas y muestra el total', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 1, tamano: 10 })
  })

  it('al cambiar la empresa activa recarga acotada a ella y no deja filas de la anterior', async () => {
    const { rerender } = abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()

    // La consulta de la nueva empresa queda en vuelo: mientras llega, no se dibuja ninguna fila de la anterior.
    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)

    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 10 }))
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()

    resolver({ faltantes: [TODAS[0]], total: 1 })
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()
  })

  it('al cambiar la empresa activa reencuadra la paginación: una sola consulta, ya en la primera página', async () => {
    // Con muchas filas hay varias páginas: se pide la segunda.
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: 30 }
    })
    const { rerender } = abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: null, pagina: 2, tamano: 10 }))

    empresaActivaId = 'e-1'
    rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)

    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 10 }))
    // La consulta de la nueva empresa sale una sola vez: no se pide la página que ya no correspondía.
    const consultasDeLaNuevaEmpresa = mocks.listar.mock.calls.filter(([filtros]) => filtros.empresaId === 'e-1')
    expect(consultasDeLaNuevaEmpresa).toHaveLength(1)
  })
})
