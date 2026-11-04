import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), useEmpresas: vi.fn(), useEmpresasDeProveedor: vi.fn(), guardarEmpresas: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useEmpresasDeProveedor', () => ({
  useEmpresasDeProveedor: mocks.useEmpresasDeProveedor,
  guardarEmpresasDeProveedor: mocks.guardarEmpresas,
}))

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
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false,
    })
    mocks.useEmpresasDeProveedor.mockReturnValue({ empresas: [], isLoading: false, isError: false, refetch: vi.fn() })
    mocks.guardarEmpresas.mockResolvedValue(undefined)
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
  describe('«Compra para» (MSF-524)', () => {
    const tienda = (nombre: string) => screen.getByRole('checkbox', { name: nombre })

    it('muestra una opción por tienda, sin marcar en el alta', () => {
      abrir()
      expect(screen.getByRole('group', { name: 'Compra para' })).toBeInTheDocument()
      expect(tienda('San Javucho')).not.toBeChecked()
      expect(tienda('Mundo JC')).not.toBeChecked()
    })

    it('en el alta guarda las tiendas marcadas con el id del proveedor creado', async () => {
      const { onGuardado } = abrir()
      completarAlta()
      fireEvent.click(tienda('Mundo JC'))
      expect(tienda('Mundo JC')).toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(PROVEEDOR))
      expect(mocks.guardarEmpresas).toHaveBeenCalledWith('prv-1', ['e-2'])
    })

    it('en la edición parte de lo guardado y reemplaza el conjunto al cambiarlo', async () => {
      mocks.useEmpresasDeProveedor.mockReturnValue({ empresas: ['e-1'], isLoading: false, isError: false, refetch: vi.fn() })
      const { onGuardado } = abrir({ proveedor: PROVEEDOR })
      expect(tienda('San Javucho')).toBeChecked()
      fireEvent.click(tienda('San Javucho'))
      fireEvent.click(tienda('Mundo JC'))
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalled())
      expect(mocks.guardarEmpresas).toHaveBeenCalledWith('prv-1', ['e-2'])
    })

    it('si no se tocan las tiendas no llama a guardarlas', async () => {
      const { onGuardado } = abrir({ proveedor: PROVEEDOR })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalled())
      expect(mocks.guardarEmpresas).not.toHaveBeenCalled()
    })

    it('si fallan las tiendas avisa que el proveedor sí se guardó y el reintento no lo duplica', async () => {
      mocks.guardarEmpresas.mockRejectedValueOnce({ code: '42501', message: 'x' })
      const { onGuardado } = abrir()
      completarAlta()
      fireEvent.click(tienda('San Javucho'))
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      expect(await screen.findByText(/El proveedor se guardó, pero no pudimos guardar «Compra para»/)).toBeInTheDocument()
      expect(onGuardado).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(PROVEEDOR))
      // El reintento no crea otro proveedor: actualiza el mismo.
      expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'crear_proveedor')).toHaveLength(1)
      expect(mocks.guardarEmpresas).toHaveBeenCalledTimes(2)
    })

    // MSF-698: el reintento no puede descartar lo que la persona editó después del fallo.
    it('el aviso de «Compra para» fallida tiene su propio «Reintentar» y un título coherente', async () => {
      mocks.guardarEmpresas.mockRejectedValueOnce({ code: '42501', message: 'x' })
      const { onGuardado } = abrir()
      completarAlta()
      fireEvent.click(tienda('San Javucho'))
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      const alerta = await screen.findByRole('alert')
      expect(within(alerta).getByText('No se guardó «Compra para».')).toBeInTheDocument()
      expect(within(alerta).queryByText('No se guardó el proveedor.')).not.toBeInTheDocument()
      fireEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(PROVEEDOR))
      expect(mocks.guardarEmpresas).toHaveBeenCalledTimes(2)
    })

    it('el reintento vuelve a guardar los campos editados después del fallo', async () => {
      mocks.guardarEmpresas.mockRejectedValueOnce({ code: '42501', message: 'x' })
      const { onGuardado } = abrir({ proveedor: PROVEEDOR })
      fireEvent.click(tienda('San Javucho'))
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      expect(await screen.findByText(/El proveedor se guardó, pero no pudimos guardar «Compra para»/)).toBeInTheDocument()
      // La persona corrige la razón social y reintenta.
      fireEvent.change(campo(/Razón social/), { target: { value: 'Proveedor Corregido SA' } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalled())
      expect(mocks.rpc).toHaveBeenCalledTimes(2)
      expect(mocks.rpc.mock.calls[1][0]).toBe('actualizar_proveedor')
      expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_razon_social: 'Proveedor Corregido SA' })
    })

    it('el reintento manda el updated_at que devolvió el guardado anterior', async () => {
      const actualizado = { ...PROVEEDOR, updated_at: '2026-01-02T10:00:00.000000+00:00' }
      mocks.rpc.mockResolvedValueOnce({ data: actualizado, error: null })
      mocks.guardarEmpresas.mockRejectedValueOnce({ code: '42501', message: 'x' })
      const { onGuardado } = abrir({ proveedor: PROVEEDOR })
      fireEvent.click(tienda('San Javucho'))
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      expect(await screen.findByText(/El proveedor se guardó/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proveedor' }))
      await waitFor(() => expect(onGuardado).toHaveBeenCalled())
      expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_actualizado_en: '2026-01-02T10:00:00.000000+00:00' })
    })

    it('si no cargan las tiendas lo dice y no deja marcar', () => {
      mocks.useEmpresas.mockReturnValue({ empresas: [], isLoading: false, isError: true })
      abrir()
      expect(screen.getByText('No pudimos cargar las tiendas.')).toBeInTheDocument()
    })
  })
})
