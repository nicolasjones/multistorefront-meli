import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useOne: vi.fn(),
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: mocks.mutateAsync }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Cliente } from '../../lib/clientes'
import { ClienteShow } from './show'

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: '30-71234567-8', correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: 'Rosario', provincia: null, expreso_preferido: null,
  archivado_en: null, tipo: 'mayorista', es_consumidor_final: false, created_at: '2026-10-16T10:00:00Z',
}

const abrir = () =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/clientes/show/c-1', state: { mensaje: 'Cliente creado' } }]}>
      <Routes><Route path="/clientes/show/:id" element={<ClienteShow />} /></Routes>
    </MemoryRouter>,
  )

const conCliente = (datos: Partial<Cliente>) =>
  mocks.useOne.mockReturnValue({ query: { data: { data: { ...cliente, ...datos } }, isLoading: false, isError: false, refetch: mocks.refetch } })

describe('ClienteShow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.mutateAsync.mockResolvedValue({})
    mocks.refetch.mockResolvedValue({})
    conCliente({})
  })

  it('muestra la ficha con número, datos, estado y la confirmación de alta', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Distribuidora Norte SRL' })).toBeInTheDocument()
    expect(screen.getByText('Cliente Nº 7')).toBeInTheDocument()
    expect(screen.getByText('30-71234567-8')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Cliente creado')).toBeInTheDocument()
    expect(screen.queryByText('c-1')).not.toBeInTheDocument()
  })

  it('con edición ofrece Editar y Archivar, y nunca Eliminar', () => {
    abrir()
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/clientes/edit/c-1')
    expect(screen.getByRole('button', { name: 'Archivar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument()
  })

  it.each(['lectura', 'ninguno'] as const)('con nivel %s no ofrece Editar ni Archivar', (nivel) => {
    mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
    abrir()
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
  })

  it('archivar pide confirmación y escribe archivado_en una sola vez', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivar' }))
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    const dialogo = await screen.findByRole('dialog')
    const confirmar = within(dialogo).getByRole('button', { name: 'Archivar' })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    const { values } = mocks.mutateAsync.mock.calls[0][0] as { values: { archivado_en: string } }
    expect(Number.isNaN(Date.parse(values.archivado_en))).toBe(false)
    expect(await screen.findByText('Cliente archivado')).toBeInTheDocument()
  })

  it('cancelar la confirmación no archiva', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('un cliente archivado se restaura: archivado_en vuelve a null', async () => {
    conCliente({ archivado_en: '2026-10-16T12:00:00Z' })
    abrir()
    expect(screen.getByText('Archivado')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Restaurar' }))
    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ resource: 'clientes', id: 'c-1', values: { archivado_en: null } })),
    )
    expect(await screen.findByText('Cliente restaurado')).toBeInTheDocument()
  })

  it('error al archivar: lo informa y conserva el estado', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.mutateAsync.mockRejectedValue(new Error('Sin conexión'))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivar' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Archivar' }))
    expect(await screen.findByText('No pudimos completar la acción.')).toBeInTheDocument()
    expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument()
    consola.mockRestore()
  })

  it('muestra el tipo del cliente', () => {
    abrir()
    expect(screen.getByText('Mayorista')).toBeInTheDocument()
  })

  it('el Consumidor final no ofrece Editar, Archivar ni Eliminar ni siquiera con edición', () => {
    conCliente({ nombre: 'Consumidor final', tipo: 'minorista', es_consumidor_final: true })
    abrir()
    expect(screen.getByRole('heading', { name: 'Consumidor final' })).toBeInTheDocument()
    expect(screen.getByText('Cliente de mostrador')).toBeInTheDocument()
    expect(screen.getByText('Minorista')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument()
  })
})
