import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEsAdministrador: vi.fn(),
  useFiltro: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'or', 'contains', 'order', 'range']) cadena[metodo] = () => cadena
  cadena.returns = () => Promise.resolve({ data: [{ id: 'p-1', nombre: 'Joystick', sku: 'JOY-1', activo: true, imagen_ruta: null, empresa_ids: [], categoria_id: null, categoria_ruta: null, disponibilidad: 'stock' }], error: null, count: 1 })
  return { supabaseClient: { rpc: vi.fn(), from: () => cadena, storage: { from: () => ({ createSignedUrls: vi.fn() }) } } }
})
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false }) }))
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: mocks.useEsAdministrador }))
vi.mock('../../hooks/useCategorias', () => ({ useCategorias: () => ({ categorias: [], isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/productoImagenes', () => ({ firmarImagenes: vi.fn().mockResolvedValue([]) }))
vi.mock('../../components/productos/DialogoExportarProductos', () => ({
  DialogoExportarProductos: ({ consulta, totalFiltrado, onExportado }: { consulta: { empresaId: string | null }; totalFiltrado: number; onExportado: (p: number, c: number) => void }) => (
    <div role="dialog" aria-label="Exportar productos">
      <span>empresa:{String(consulta.empresaId)} filtrado:{totalFiltrado}</span>
      <button onClick={() => onExportado(1, 7)}>Terminar</button>
    </div>
  ),
}))

import { ProductoList } from './list'

const empresas = [{ id: 'emp-1', nombre: 'San Javucho' }, { id: 'emp-2', nombre: 'Mundo JC' }]
const filtro = (valor: string | null) => ({ empresas, valor, cambiar: vi.fn(), cargando: false, hayError: false })
const abrir = () => render(<MemoryRouter><ProductoList /></MemoryRouter>)

describe('Exportar productos en el listado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: true, isLoading: false })
    mocks.useFiltro.mockReturnValue(filtro(null))
  })

  it('el botón «Exportar» solo aparece para el Administrador (FR-201)', async () => {
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: false, isLoading: false })
    abrir()
    await screen.findByText('Joystick')
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument()
  })

  it('el Administrador abre el diálogo acotado a la empresa activa y ve el aviso al terminar (FR-201, FR-205)', async () => {
    mocks.useFiltro.mockReturnValue(filtro('emp-1'))
    abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(screen.getByRole('dialog', { name: 'Exportar productos' })).toBeInTheDocument()
    expect(screen.getByText('empresa:emp-1 filtrado:1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Terminar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Exportación CSV lista: 1 producto, 7 columnas')).toBeInTheDocument()
  })

  it('al cambiar de empresa el diálogo abierto se cierra con aviso (FR-209, Principio VIII)', async () => {
    mocks.useFiltro.mockReturnValue(filtro('emp-1'))
    const { rerender } = abrir()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    mocks.useFiltro.mockReturnValue(filtro('emp-2'))
    rerender(<MemoryRouter><ProductoList /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Cambiaste de empresa: se cerró la exportación/)).toBeInTheDocument()
  })
})
