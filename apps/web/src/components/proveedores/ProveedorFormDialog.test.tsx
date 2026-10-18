import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ProveedorFormDialog } from './ProveedorFormDialog'
import type { Proveedor } from '../../lib/proveedores'

const PROVEEDOR: Proveedor = {
  id: 'prv-1', organizacion_id: 'org-1', razon_social: 'Proveedor Uno SA', cuit: '20123456786',
  persona_contacto: 'Ana Pérez', correo: 'ventas@uno.example.com', telefono: '11 5555-0000',
  direccion: 'Calle 1', observaciones: 'Nota', activo: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
}

const campo = (nombre: RegExp) => screen.getByRole('textbox', { name: nombre })

const abrir = (props: Partial<Parameters<typeof ProveedorFormDialog>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  const onRecargar = vi.fn()
  render(<ProveedorFormDialog open onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} {...props} />)
  return { onCerrar, onGuardado, onRecargar }
}

const completarAlta = (cuit = '20-12345678-6') => {
  fireEvent.change(campo(/Razón social/), { target: { value: '  Proveedor Uno SA  ' } })
  fireEvent.change(campo(/CUIT/), { target: { value: cuit } })
}

describe('ProveedorFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: PROVEEDOR, error: null })
  })

  it('en el alta muestra los siete campos y los botones Cancelar y Guardar proveedor', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Nuevo proveedor' })).toBeInTheDocument()
    for (const nombre of [/Razón social/, /CUIT/, /Persona de contacto/, /Correo/, /Teléfono/, /Dirección/, /Observaciones/]) {
      expect(campo(nombre)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar proveedor' })).toBeInTheDocument()
  })

  it('pone el foco en el primer campo al abrir', () => {
    abrir()
    expect(campo(/Razón social/)).toHaveFocus()
  })

  it('un CUIT inválido muestra el error junto al campo, asociado, y no guarda', () => {
    abrir()
    completarAlta('20-12345678-5')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(screen.getByText('El CUIT no es válido: revisá el dígito verificador.')).toBeInTheDocument()
    expect(campo(/CUIT/)).toHaveAttribute('aria-invalid', 'true')
    expect(campo(/CUIT/)).toHaveAccessibleDescription('El CUIT no es válido: revisá el dígito verificador.')
    expect(campo(/CUIT/)).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('exige razón social y CUIT, y valida el formato del correo', () => {
    abrir()
    fireEvent.change(campo(/Correo/), { target: { value: 'sin-arroba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(screen.getByText('Ingresá la razón social.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el CUIT.')).toBeInTheDocument()
    expect(screen.getByText(/Ingresá un correo con formato válido/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('muestra el CUIT con guiones al salir del campo', () => {
    abrir()
    fireEvent.change(campo(/CUIT/), { target: { value: '20123456786' } })
    fireEvent.blur(campo(/CUIT/))
    expect(campo(/CUIT/)).toHaveValue('20-12345678-6')
  })

  it('guarda el alta con el CUIT solo con dígitos y avisa al guardar', async () => {
    const { onGuardado } = abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(PROVEEDOR))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_proveedor', {
      p_razon_social: 'Proveedor Uno SA', p_cuit: '20123456786', p_persona_contacto: null,
      p_correo: null, p_telefono: null, p_direccion: null, p_observaciones: null,
    })
  })

  it('un doble clic en Guardar proveedor envía una sola vez', async () => {
    const { onGuardado } = abrir()
    completarAlta()
    const guardar = screen.getByRole('button', { name: 'Guardar proveedor' })
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    await waitFor(() => expect(onGuardado).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('un CUIT duplicado (23505) se muestra en el campo y conserva lo escrito', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "proveedores_organizacion_id_cuit_key"' },
    })
    const { onGuardado } = abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(await screen.findByText(/Ya existe un proveedor con ese CUIT/)).toBeInTheDocument()
    expect(campo(/CUIT/)).toHaveAttribute('aria-invalid', 'true')
    expect(campo(/Razón social/)).toHaveValue('  Proveedor Uno SA  ')
    expect(onGuardado).not.toHaveBeenCalled()
    // El detalle técnico queda en consola, no en pantalla.
    expect(screen.queryByText(/violates unique constraint/)).not.toBeInTheDocument()
  })

  it('un error de permisos (42501) se explica en castellano', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
  })

  it('en la edición carga los datos con el CUIT con guiones y guarda con el updated_at leído', async () => {
    const { onGuardado } = abrir({ proveedor: PROVEEDOR })
    expect(screen.getByRole('dialog', { name: 'Editar proveedor' })).toBeInTheDocument()
    expect(campo(/Razón social/)).toHaveValue('Proveedor Uno SA')
    expect(campo(/CUIT/)).toHaveValue('20-12345678-6')
    expect(campo(/Persona de contacto/)).toHaveValue('Ana Pérez')
    fireEvent.change(campo(/Razón social/), { target: { value: 'Proveedor Uno Nuevo SA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_proveedor', expect.objectContaining({
      p_id: 'prv-1', p_actualizado_en: '2026-01-01T10:00:00.123456+00:00',
      p_razon_social: 'Proveedor Uno Nuevo SA', p_cuit: '20123456786',
    }))
  })

  it('ante un conflicto de edición (40001) avisa, no cierra y ofrece recargar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'El proveedor fue modificado por otra persona' } })
    const { onGuardado, onRecargar } = abrir({ proveedor: PROVEEDOR })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(await screen.findByText(/Otra persona modificó este proveedor/)).toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalled()
  })

  it('Cancelar cierra sin guardar', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('mientras guarda deshabilita los botones', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
    expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    resolver({ data: PROVEEDOR, error: null })
  })
})
