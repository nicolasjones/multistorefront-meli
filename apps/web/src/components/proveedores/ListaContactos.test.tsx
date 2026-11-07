import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ListaContactos } from './ListaContactos'

const ANA = { id: 'c-1', nombre: 'Ana Pérez', rol: 'Ventas', correo: 'ana@example.com', telefono: '1155550001', principal: true }
const BETO = { id: 'c-2', nombre: 'Beto Gómez', rol: null, correo: null, telefono: null, principal: false }

const abrir = (props: Partial<Parameters<typeof ListaContactos>[0]> = {}) =>
  render(<ListaContactos proveedorId="prv-1" puedeEditar {...props} />)

const responder = (contactos: unknown[]) =>
  mocks.rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'listar_contactos_proveedor') return { data: contactos, error: null }
    return { data: null, error: null }
  })

describe('ListaContactos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    responder([ANA, BETO])
  })

  it('lista nombre, rol, correo, teléfono y la marca de principal', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Contactos del proveedor' })
    expect(within(tabla).getByText('Ana Pérez')).toBeInTheDocument()
    expect(within(tabla).getByText('Principal')).toBeInTheDocument()
    expect(within(tabla).getByText('ana@example.com')).toBeInTheDocument()
    expect(within(tabla).getByText('1155550001')).toBeInTheDocument()
    expect(within(tabla).getByText('Beto Gómez')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contactos_proveedor', { p_proveedor_id: 'prv-1' })
  })

  it('sin permiso de edición oculta «Agregar contacto» y «Marcar como principal»', async () => {
    abrir({ puedeEditar: false })
    await screen.findByRole('table', { name: 'Contactos del proveedor' })
    expect(screen.queryByRole('button', { name: 'Agregar contacto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar a .* como principal/ })).not.toBeInTheDocument()
  })

  it('«Marcar como principal» llama a la función, recarga y avisa a la ficha', async () => {
    const onFichaCambiada = vi.fn()
    abrir({ onFichaCambiada })
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a Beto Gómez como principal' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('marcar_contacto_principal', { p_contacto_id: 'c-2' }))
    await waitFor(() => expect(onFichaCambiada).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Beto Gómez es ahora el contacto principal')).toBeInTheDocument()
    // El contacto que ya es principal no ofrece la acción.
    expect(screen.queryByRole('button', { name: 'Marcar a Ana Pérez como principal' })).not.toBeInTheDocument()
  })

  it('informa si hay contacto principal', async () => {
    const onPrincipal = vi.fn()
    abrir({ onPrincipal })
    await waitFor(() => expect(onPrincipal).toHaveBeenCalledWith(true))
  })

  it('agrega un contacto con nombre, rol, correo y teléfono', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar contacto' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar contacto' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: ' Carla ' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Rol' }), { target: { value: 'Compras' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Correo' }), { target: { value: 'carla@example.com' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Teléfono' }), { target: { value: '1166' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Agregar contacto' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('agregar_contacto_proveedor', {
      p_proveedor_id: 'prv-1', p_nombre: 'Carla', p_rol: 'Compras', p_correo: 'carla@example.com', p_telefono: '1166', p_principal: false,
    }))
    expect(await screen.findByText('Contacto Carla agregado')).toBeInTheDocument()
  })

  it('exige el nombre y valida el correo antes de enviar', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar contacto' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar contacto' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Correo' }), { target: { value: 'sin-arroba' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Agregar contacto' }))
    expect(within(dialogo).getByText('Ingresá el nombre del contacto.')).toBeInTheDocument()
    expect(within(dialogo).getByText(/correo con formato válido/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('agregar_contacto_proveedor', expect.anything())
  })

  it('muestra el estado vacío', async () => {
    responder([])
    abrir()
    expect(await screen.findByText('Este proveedor todavía no tiene contactos.')).toBeInTheDocument()
  })

  it('muestra el error de carga con reintento', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los contactos del proveedor.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('si falla el cambio de principal lo informa y no avisa a la ficha', async () => {
    const onFichaCambiada = vi.fn()
    mocks.rpc.mockImplementation(async (nombre: string) =>
      nombre === 'listar_contactos_proveedor' ? { data: [ANA, BETO], error: null } : { data: null, error: { code: '42501' } })
    abrir({ onFichaCambiada })
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a Beto Gómez como principal' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
    expect(onFichaCambiada).not.toHaveBeenCalled()
  })
})
