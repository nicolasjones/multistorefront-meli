import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Reencuadre por empresa de la selección y del diálogo de avisos (F-VTA-26, FR-009; Principio VIII).
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  avisar: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  cambiarFiltro: vi.fn(),
}))

vi.mock('../../hooks/useImagenesProductos', () => ({ useImagenesProductos: () => new Map<string, string>() }))
vi.mock('../../lib/ventasFaltantes', async (original) => ({
  ...(await original<typeof import('../../lib/ventasFaltantes')>()),
  listarFaltantes: mocks.listar,
  avisarFaltantesVenta: mocks.avisar,
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false, error: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({
  useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' }, isLoading: false }),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesList } from './faltantes'

const fila = (n: number, empresaId: string, empresa: string) => ({
  id: `f-${n}`,
  empresa_id: empresaId,
  empresa,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  producto_id: null as string | null,
  sku: `SKU-${n}`,
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: `comp-${n}`,
  comprobante: `0003-${n}`,
  fecha: '2026-10-01',
  desde: '2026-10-01T10:00:00Z',
  stock_estado: 'disponible' as const,
  stock_disponible: 5,
  aviso: 'sin_avisar' as const,
  aviso_en: null,
})

const TODAS = [fila(1, 'e-1', 'San Javucho'), fila(2, 'e-2', 'Mundo JC')]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]
let empresaActivaId: string | null = null

const abrir = () => render(<MemoryRouter><FaltantesList /></MemoryRouter>)
const reabrir = (r: ReturnType<typeof abrir>) => r.rerender(<MemoryRouter><FaltantesList /></MemoryRouter>)

describe('FaltantesList · cambio de empresa con selección y diálogo (F-VTA-26, FR-009)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    empresaActivaId = null
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => ({
      empresas,
      valor: empresaActivaId,
      cambiar: mocks.cambiarFiltro,
      empresaActivaId,
      cargando: false,
      hayError: false,
    }))
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { faltantes: filas, total: filas.length }
    })
  })

  it('al cambiar la empresa activa descarta la selección y no deja filas de la anterior', async () => {
    const r = abrir()
    await screen.findByText('Producto 2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (2)' })).toBeEnabled()

    let resolver: (v: unknown) => void = () => {}
    mocks.listar.mockImplementationOnce(() => new Promise((res) => { resolver = res }))
    empresaActivaId = 'e-1'
    reabrir(r)

    // Mientras llega la nueva empresa: ni filas viejas ni selección.
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
    resolver({ faltantes: [TODAS[0]], total: 1 })
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
    expect(screen.getByText('0 seleccionados de 1 faltante.')).toBeInTheDocument()
    // Y si vuelve a la empresa anterior la selección no reaparece sola.
    empresaActivaId = null
    reabrir(r)
    await screen.findByText('Producto 2')
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
  })

  it('con el diálogo abierto, cambiar la empresa lo cierra con un aviso y no envía nada', async () => {
    const r = abrir()
    await screen.findByText('Producto 2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (2)' }))
    expect(await screen.findByRole('dialog', { name: 'Avisar a los clientes' })).toBeInTheDocument()

    empresaActivaId = 'e-2'
    reabrir(r)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Cambiaste de empresa: se cerró el aviso a los clientes.')).toBeInTheDocument()
    expect(mocks.avisar).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'e-2', pagina: 1 })))
    expect(within(await screen.findByRole('table')).queryByText('Producto 1')).not.toBeInTheDocument()
  })

  it('cambiar el filtro de aviso conserva la empresa y reinicia desde la primera tanda', async () => {
    const r = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByRole('button', { name: 'Para avisar' }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ aviso: 'para_avisar', pagina: 1 })))
    reabrir(r)
    expect(screen.getByRole('button', { name: 'Para avisar' })).toHaveAttribute('aria-pressed', 'true')
  })
})
