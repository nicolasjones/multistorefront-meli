import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useBuscarClientes: vi.fn() }))

vi.mock('../../hooks/useBuscarClientes', () => ({ useBuscarClientes: mocks.useBuscarClientes }))

import { ClienteSelector, contactoDeCliente } from './ClienteSelector'
import type { ClienteListado } from '../../hooks/useBuscarClientes'

const cliente = (extra: Partial<ClienteListado>): ClienteListado => ({
  id: 'c-1',
  numero: 1,
  nombre: 'Ana Pérez',
  documento: null,
  correo: null,
  telefono: null,
  celular: null,
  localidad: null,
  expreso_preferido: null,
  tipo: 'minorista',
  es_consumidor_final: false,
  archivado_en: null,
  empresas: [],
  cuentas_web: [],
  ...extra,
})

const abrirOpciones = () => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cliente' }))
  return screen.getByRole('listbox')
}

const respuesta = (clientes: ClienteListado[], extra: Record<string, unknown> = {}) => ({
  clientes,
  total: clientes.length,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  ...extra,
})

describe('contactoDeCliente', () => {
  it('prefiere celular, después teléfono y por último correo', () => {
    expect(contactoDeCliente({ celular: '11', telefono: '22', correo: 'a@b.c' })).toBe('11')
    expect(contactoDeCliente({ celular: null, telefono: '22', correo: 'a@b.c' })).toBe('22')
    expect(contactoDeCliente({ celular: null, telefono: null, correo: 'a@b.c' })).toBe('a@b.c')
    expect(contactoDeCliente({ celular: null, telefono: null, correo: null })).toBe('')
  })
})

describe('ClienteSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useBuscarClientes.mockReturnValue(respuesta([
      cliente({ id: 'c-1', nombre: 'Ana Pérez', celular: '11 5555-5555', telefono: '4444-4444' }),
      cliente({ id: 'c-2', nombre: 'Distribuidora Norte', correo: 'ventas@norte.com' }),
    ]))
  })

  it('busca con `buscar_clientes` y muestra solo las coincidencias de la organización', () => {
    render(<ClienteSelector valor={null} onCambio={vi.fn()} />)
    expect(mocks.useBuscarClientes).toHaveBeenCalledWith(expect.objectContaining({ archivados: false, empresaId: null }))
    expect(within(abrirOpciones()).getByRole('option', { name: 'Ana Pérez' })).toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Distribuidora Norte' })).toBeInTheDocument()
  })

  it('al elegir un cliente devuelve su id, nombre y contacto (FR-014)', () => {
    const onCambio = vi.fn()
    render(<ClienteSelector valor={null} onCambio={onCambio} />)
    fireEvent.click(within(abrirOpciones()).getByRole('option', { name: 'Ana Pérez' }))
    expect(onCambio).toHaveBeenCalledWith({ id: 'c-1', nombre: 'Ana Pérez', contacto: '11 5555-5555' })
  })

  it('usa el correo cuando el cliente no tiene teléfonos', () => {
    const onCambio = vi.fn()
    render(<ClienteSelector valor={null} onCambio={onCambio} />)
    fireEvent.click(within(abrirOpciones()).getByRole('option', { name: 'Distribuidora Norte' }))
    expect(onCambio).toHaveBeenCalledWith({ id: 'c-2', nombre: 'Distribuidora Norte', contacto: 'ventas@norte.com' })
  })

  it('muestra el cliente elegido y el error de validación', () => {
    render(
      <ClienteSelector
        valor={{ id: 'c-1', nombre: 'Ana Pérez', contacto: '11 5555-5555' }}
        onCambio={vi.fn()}
        error="Elegí el cliente."
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toHaveValue('Ana Pérez')
    expect(screen.getByText('Elegí el cliente.')).toBeInTheDocument()
  })

  it('ofrece «Nuevo cliente» solo cuando hay alta rápida y no está bloqueado (FR-015)', () => {
    const onAltaRapida = vi.fn()
    const { unmount } = render(<ClienteSelector valor={null} onCambio={vi.fn()} onAltaRapida={onAltaRapida} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }))
    expect(onAltaRapida).toHaveBeenCalledTimes(1)
    unmount()

    render(<ClienteSelector valor={null} onCambio={vi.fn()} onAltaRapida={onAltaRapida} disabled />)
    expect(screen.queryByRole('button', { name: 'Nuevo cliente' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toBeDisabled()
  })

  it('avisa cuando la búsqueda falla', () => {
    mocks.useBuscarClientes.mockReturnValue(respuesta([], { isError: true }))
    render(<ClienteSelector valor={null} onCambio={vi.fn()} />)
    expect(screen.getByText('No pudimos buscar clientes. Escribí de nuevo para reintentar.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cliente' })).toHaveAttribute('aria-invalid', 'true')
  })
})
