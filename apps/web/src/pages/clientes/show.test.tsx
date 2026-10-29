import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useOne: vi.fn(),
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  useNivelSeccion: vi.fn(),
  useEmpresas: vi.fn(),
  useEmpresasDeCliente: vi.fn(),
  useCuentasWebDeCliente: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  invitar: vi.fn(),
  cambiarEstado: vi.fn(),
  habilitarTienda: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({
  useOne: mocks.useOne,
  useUpdate: () => ({ mutateAsync: mocks.mutateAsync }),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useEmpresasDeCliente', () => ({ useEmpresasDeCliente: mocks.useEmpresasDeCliente }))
vi.mock('../../hooks/useCuentasWebDeCliente', () => ({ useCuentasWebDeCliente: mocks.useCuentasWebDeCliente }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/cuentasCliente', async (importOriginal) => {
  // Se conservan los helpers puros (textos, formatos, derivación) y se simulan las acciones.
  const real = await importOriginal<typeof import('../../lib/cuentasCliente')>()
  return {
    ...real,
    invitarCuentaWeb: mocks.invitar,
    cambiarEstadoCuentaWeb: mocks.cambiarEstado,
    habilitarTiendaDeCliente: mocks.habilitarTienda,
  }
})
vi.mock('../../components/clientes/ComprasCliente', () => ({ ComprasCliente: ({ clienteId }: { clienteId: string }) => <div data-testid="compras" data-cliente={clienteId} /> }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import type { Cliente } from '../../lib/clientes'
import { ClienteShow } from './show'

const cliente: Cliente = {
  id: 'c-1', numero: 7, nombre: 'Distribuidora Norte SRL', documento: '30-71234567-8', correo: 'norte@example.com',
  telefono: null, celular: null, direccion: null, codigo_postal: null, localidad: 'Rosario', provincia: null, expreso_preferido: null,
  archivado_en: null, tipo: 'mayorista', es_consumidor_final: false, acepta_correo_masivo: false, created_at: '2026-10-16T10:00:00Z',
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
    mocks.useEmpresas.mockReturnValue({ empresas: [], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useCuentasWebDeCliente.mockReturnValue({ cuentas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: null, isLoading: false, isError: false, refetch: vi.fn() })
    mocks.invitar.mockResolvedValue(undefined)
    mocks.cambiarEstado.mockResolvedValue(undefined)
    mocks.habilitarTienda.mockResolvedValue(['e-1'])
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

  it('monta la sección Compras con lectura o edición, y no con nivel ninguno', () => {
    abrir()
    expect(screen.getByTestId('compras')).toHaveAttribute('data-cliente', 'c-1')
  })

  it('sin acceso a Clientes no monta Compras', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'ninguno', isLoading: false })
    abrir()
    expect(screen.queryByTestId('compras')).not.toBeInTheDocument()
  })

  it('el bloque «Comunicaciones» muestra el interruptor «Incluir en el correo masivo» y lo guarda al cambiarlo', async () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Comunicaciones' })).toBeInTheDocument()
    const interruptor = screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' })
    expect(interruptor).not.toBeChecked()
    fireEvent.click(interruptor)
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'clientes', id: 'c-1', values: { acepta_correo_masivo: true } }),
    ))
    expect(await screen.findByText('El cliente se incluye en el correo masivo')).toBeInTheDocument()
  })

  it('con lectura el interruptor de «Comunicaciones» se ve pero no se puede cambiar', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    conCliente({ acepta_correo_masivo: true })
    abrir()
    const interruptor = screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' })
    expect(interruptor).toBeChecked()
    expect(interruptor).toBeDisabled()
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

  it('muestra los bloques Tiendas y Cuenta web con el estado de cada tienda', () => {
    mocks.useEmpresas.mockReturnValue({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [{ empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: null }],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    abrir()
    expect(screen.getByRole('heading', { name: 'Tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cuenta web' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Habilitado en la tienda: San Javucho' })).toBeChecked()
    expect(screen.getByRole('tab', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.getAllByText('Activa').length).toBeGreaterThan(0)
  })

  it('suspender desde la ficha cambia el estado y refresca las consultas', async () => {
    const reintentarCuentas = vi.fn().mockResolvedValue(undefined)
    const reintentarTiendas = vi.fn().mockResolvedValue(undefined)
    mocks.useEmpresas.mockReturnValue({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: reintentarTiendas })
    mocks.useCuentasWebDeCliente.mockReturnValue({
      cuentas: [{ empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: null }],
      isLoading: false, isError: false, refetch: reintentarCuentas,
    })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Suspender acceso' }))
    await waitFor(() => expect(mocks.cambiarEstado).toHaveBeenCalledWith('c-1', 'e-1', 'suspendida'))
    expect(await screen.findByText('Cuenta web suspendida en San Javucho')).toBeInTheDocument()
    expect(reintentarCuentas).toHaveBeenCalled()
    expect(reintentarTiendas).toHaveBeenCalled()
  })

  it('crear la cuenta informa el enlace enviado', async () => {
    mocks.useEmpresas.mockReturnValue({ empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }], isLoading: false, isError: false })
    mocks.useEmpresasDeCliente.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: vi.fn() })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta web' }))
    await waitFor(() => expect(mocks.invitar).toHaveBeenCalledWith('c-1', 'e-1', 'crear'))
    expect(await screen.findByText('Cuenta creada en San Javucho: se envió el enlace para definir la clave')).toBeInTheDocument()
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
