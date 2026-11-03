import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useOne: vi.fn(), refetch: vi.fn() }))

vi.mock('@refinedev/core', () => ({ useOne: mocks.useOne, useUpdate: () => ({ mutateAsync: vi.fn() }) }))
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
  archivado_en: null, tipo: 'minorista', es_consumidor_final: false, created_at: '2026-10-16T10:00:00Z',
}

const Hoja = () => { const l = useLocation(); return <div>Hoja {l.search} {JSON.stringify(l.state)}</div> }
const abrir = (state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/clientes/show/c-1', state }]}>
    <Routes>
      <Route path="/clientes/show/:id" element={<ClienteShow />} />
      <Route path="/clientes/etiquetas" element={<Hoja />} />
    </Routes>
  </MemoryRouter>,
)
const conCliente = (datos: Partial<Cliente>) =>
  mocks.useOne.mockReturnValue({ query: { data: { data: { ...cliente, ...datos } }, isLoading: false, isError: false, refetch: mocks.refetch } })

describe('ficha de cliente: etiqueta (F-CLI-17, FR-003)', () => {
  beforeEach(() => { vi.clearAllMocks(); conCliente({}) })

  it.each(['Etiqueta', 'Imprimir etiqueta de envío'])('«%s» abre la hoja con el cliente, incluso con lectura', (nombre) => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: nombre }))
    expect(screen.getByText(/Hoja \?ids=c-1/)).toHaveTextContent('/clientes/show/c-1')
  })

  it('sin dirección avisa el dato faltante y no abre la hoja', () => {
    conCliente({ direccion: null })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir etiqueta de envío' }))
    expect(screen.getByText(/falta dirección/)).toBeInTheDocument()
    expect(screen.queryByText(/^Hoja/)).not.toBeInTheDocument()
  })

  it('al volver de imprimir muestra «Etiqueta enviada a imprimir»', () => {
    abrir({ mensaje: 'Etiqueta enviada a imprimir' })
    expect(screen.getByText('Etiqueta enviada a imprimir')).toBeInTheDocument()
  })
})
