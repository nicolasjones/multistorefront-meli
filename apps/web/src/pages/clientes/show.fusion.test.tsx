import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useOne: vi.fn(), refetch: vi.fn(), rol: 'administrador' as string | null }))

vi.mock('@refinedev/core', () => ({ useOne: mocks.useOne, useUpdate: () => ({ mutateAsync: vi.fn() }) }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: () => ({ contexto: { rol_efectivo: mocks.rol }, isLoading: false }) }))
vi.mock('../../components/clientes/DialogoFusionarClientes', () => ({
  DialogoFusionarClientes: ({ abierto, onFusionado }: { abierto: boolean; onFusionado: (id: string) => void }) =>
    abierto ? <div role="dialog"><button onClick={() => onFusionado('c-1')}>Terminar fusión</button><button onClick={() => onFusionado('c-9')}>Terminar fusión en otra</button></div> : null,
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'lectura', isLoading: false }) }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: () => ({ empresas: [], isLoading: false, isError: false }) }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({ useEmpresasDeCliente: () => ({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../hooks/useCuentasWebDeCliente', () => ({ useCuentasWebDeCliente: () => ({ cuentas: [], isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('../../components/clientes/ComprasCliente', () => ({ ComprasCliente: () => null }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Cliente } from '../../lib/clientes'
import { ClienteShow } from './show'

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: null, correo: null, telefono: null, celular: null,
  direccion: 'Av. Siempre Viva 742', codigo_postal: null, localidad: null, provincia: null, expreso_preferido: null,
  archivado_en: null, tipo: 'minorista', es_consumidor_final: false, acepta_correo_masivo: true, created_at: '2026-10-16T10:00:00Z',
}

const Otra = () => { const l = useLocation(); return <div>Otra ficha {JSON.stringify(l.state)}</div> }
const Hoja = () => { const l = useLocation(); return <div>Hoja {l.search} {JSON.stringify(l.state)}</div> }
const abrir = (state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/clientes/show/c-1', state }]}>
    <Routes>
      <Route path="/clientes/show/:id" element={<ClienteShow />} />
      <Route path="/clientes/etiquetas" element={<Hoja />} />
      <Route path="/clientes/show/c-9" element={<Otra />} />
    </Routes>
  </MemoryRouter>,
)
const conCliente = (datos: Partial<Cliente>) =>
  mocks.useOne.mockReturnValue({ query: { data: { data: { ...cliente, ...datos } }, isLoading: false, isError: false, refetch: mocks.refetch } })

describe('ficha de cliente: fusionar (F-CLI-18, FR-014)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rol = 'administrador'; mocks.refetch.mockResolvedValue(undefined); conCliente({}) })

  it('el Administrador ve «Fusionar con otro cliente…»', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Fusionar con otro cliente…' })).toBeInTheDocument()
  })

  it.each(['operador', 'miembro', null])('el rol %s no ve la acción', (rol) => {
    mocks.rol = rol
    abrir()
    expect(screen.queryByRole('button', { name: 'Fusionar con otro cliente…' })).not.toBeInTheDocument()
  })

  it('un cliente archivado o el Consumidor final no se fusionan', () => {
    conCliente({ archivado_en: '2026-10-01T00:00:00Z' })
    const { unmount } = abrir()
    expect(screen.queryByRole('button', { name: 'Fusionar con otro cliente…' })).not.toBeInTheDocument()
    unmount()
    conCliente({ es_consumidor_final: true })
    abrir()
    expect(screen.queryByRole('button', { name: 'Fusionar con otro cliente…' })).not.toBeInTheDocument()
  })

  it('al terminar sobre esta ficha la recarga y muestra el aviso (suma de compras)', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Fusionar con otro cliente…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminar fusión' }))
    expect(await screen.findByText('Clientes fusionados: las compras se sumaron en esta ficha')).toBeInTheDocument()
    expect(mocks.refetch).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('si se conservó la otra ficha, navega a ella con el aviso', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Fusionar con otro cliente…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminar fusión en otra' }))
    expect(await screen.findByText(/Otra ficha/)).toHaveTextContent('Clientes fusionados')
  })
})
