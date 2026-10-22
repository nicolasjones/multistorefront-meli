import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useEmpresas: vi.fn(),
  useGuardarEmpresasDeCliente: vi.fn(),
  guardar: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useCreate: () => ({ mutateAsync: mocks.mutateAsync }) }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({ useGuardarEmpresasDeCliente: mocks.useGuardarEmpresasDeCliente }))

import { AltaRapidaClienteDialog } from './AltaRapidaClienteDialog'

const abrir = (props: Partial<{ onCerrar: () => void; onCreado: (cliente: { id: string; nombre: string; contacto: string }) => void }> = {}) => {
  const onCerrar = props.onCerrar ?? vi.fn()
  const onCreado = props.onCreado ?? vi.fn()
  render(<AltaRapidaClienteDialog abierto onCerrar={onCerrar} onCreado={onCreado} />)
  return { onCerrar, onCreado }
}

const llenar = (nombre = 'Ana Pérez', celular = '11 5555-5555') => {
  fireEvent.change(screen.getByLabelText(/Nombre o razón social/), { target: { value: nombre } })
  fireEvent.change(screen.getByLabelText('Celular'), { target: { value: celular } })
}

describe('AltaRapidaClienteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useEmpresas.mockReturnValue({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }] })
    mocks.useGuardarEmpresasDeCliente.mockReturnValue({ guardar: mocks.guardar })
    mocks.guardar.mockResolvedValue(undefined)
    mocks.mutateAsync.mockResolvedValue({ data: { id: 'c-nuevo' } })
  })

  it('valida el nombre antes de crear y no llama a la API (FR-015)', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ingresá el nombre o la razón social.')).toBeInTheDocument()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('crea el cliente con el mismo camino que Clientes y lo deja elegido', async () => {
    const { onCreado } = abrir()
    llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'clientes',
      successNotification: false,
      values: expect.objectContaining({ nombre: 'Ana Pérez', celular: '11 5555-5555' }),
    })))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith('c-nuevo', ['e-1']))
    expect(onCreado).toHaveBeenCalledWith({ id: 'c-nuevo', nombre: 'Ana Pérez', contacto: '11 5555-5555' }, undefined)
  })

  it('si falla el alta, muestra el error dentro del diálogo y no elige nada', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error('boom'))
    const { onCreado } = abrir()
    llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('No pudimos crear el cliente. Intentá de nuevo.')).toBeInTheDocument()
    expect(onCreado).not.toHaveBeenCalled()
  })

  it('si falla guardar las tiendas, el cliente igual queda elegido (no se duplica el alta)', async () => {
    mocks.guardar.mockRejectedValueOnce(new Error('tiendas'))
    const { onCreado } = abrir()
    llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-nuevo', nombre: 'Ana Pérez' }), expect.any(String)))
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('«Cancelar» cierra el diálogo', () => {
    const { onCerrar } = abrir()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
  })
})
