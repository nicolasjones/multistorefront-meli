import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), useEmpresas: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))

import { TransporteDialog } from './TransporteDialog'
import { parsearNumero, validarTransporte, FORMULARIO_TRANSPORTE_VACIO, type Transporte } from '../../lib/ventas/transportes'

const TRANSPORTE: Transporte = {
  id: 'tr-1', organizacion_id: 'org-1', nombre: 'Expreso Ejemplo del Sur', tipo: 'expreso', cuit: '20123456786',
  terminal_retiro: 'Terminal Sur', localidad: 'Rosario', telefono: '0341 000-0000', correo: 'cobranzas@empresa.example',
  persona_contacto: 'Ana', direccion: 'Calle 1', cobra_contrarreembolso: true, comision_pct: 2.5, plazo_rendicion_dias: 7,
  orden: 1, activa: true, updated_at: '2026-01-01T10:00:00.123456+00:00',
  empresas: [{ id: 'e-1', nombre: 'San Javucho' }],
}

const campo = (nombre: RegExp) => screen.getByRole('textbox', { name: nombre })

const abrir = (props: Partial<Parameters<typeof TransporteDialog>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  const onRecargar = vi.fn()
  render(<TransporteDialog open onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} {...props} />)
  return { onCerrar, onGuardado, onRecargar }
}

describe('TransporteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: TRANSPORTE, error: null })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false,
    })
  })

  it('en el alta muestra los campos del prototipo y los botones Cancelar y Guardar empresa', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Nueva empresa de transporte' })).toBeInTheDocument()
    for (const nombre of [
      /Empresa de transporte/, /CUIT/, /Terminal de retiro/, /Localidad/, /Teléfono/, /Correo/, /Persona de contacto/,
      /Dirección de la oficina/, /Comisión/, /Plazo de rendición/, /Orden/,
    ]) {
      expect(campo(nombre)).toBeInTheDocument()
    }
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Cobra contrarreembolso/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Activa' })).toBeChecked()
    expect(screen.getByRole('group', { name: 'Empresas donde se usa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar empresa' })).toBeInTheDocument()
  })

  it('Tipo ofrece Expreso, Correo y Moto propia', () => {
    abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Tipo' }))
    for (const opcion of ['Expreso', 'Correo', 'Moto propia']) {
      expect(screen.getByRole('option', { name: opcion })).toBeInTheDocument()
    }
  })

  it('crea la empresa con CUIT normalizado, comisión con coma y empresas marcadas', async () => {
    const { onGuardado } = abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: '  Expreso Ejemplo del Sur  ' } })
    fireEvent.change(campo(/CUIT/), { target: { value: '20-12345678-6' } })
    fireEvent.change(campo(/Terminal de retiro/), { target: { value: 'Terminal Sur' } })
    fireEvent.change(campo(/Comisión/), { target: { value: '2,5' } })
    fireEvent.change(campo(/Plazo de rendición/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Cobra contrarreembolso/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'San Javucho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_transporte', expect.objectContaining({
      p_nombre: 'Expreso Ejemplo del Sur',
      p_tipo: 'expreso',
      p_cuit: '20123456786',
      p_terminal_retiro: 'Terminal Sur',
      p_telefono: null,
      p_cobra_contrarreembolso: true,
      p_comision_pct: 2.5,
      p_plazo_rendicion_dias: 7,
      p_orden: 0,
      p_activa: true,
      p_empresa_ids: ['e-1'],
    }))
  })

  it('el CUIT es opcional: sin CUIT guarda con p_cuit nulo (moto propia)', async () => {
    const { onGuardado } = abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: 'Moto propia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(mocks.rpc).toHaveBeenCalledWith('crear_transporte', expect.objectContaining({ p_cuit: null, p_empresa_ids: [] }))
  })

  it('sin nombre no viaja: marca el campo y deja el foco ahí', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(screen.getByText('Ingresá el nombre de la empresa de transporte.')).toBeInTheDocument()
    expect(campo(/Empresa de transporte/)).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un CUIT con dígito verificador incorrecto se rechaza en el campo', () => {
    abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: 'Expreso' } })
    fireEvent.change(campo(/CUIT/), { target: { value: '20-12345678-7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(screen.getByText('El CUIT no es válido: revisá el dígito verificador.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('una comisión fuera de 0–100 y un plazo negativo se rechazan', () => {
    abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: 'Expreso' } })
    fireEvent.change(campo(/Comisión/), { target: { value: '100,5' } })
    fireEvent.change(campo(/Plazo de rendición/), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(screen.getByText('La comisión debe estar entre 0 y 100.')).toBeInTheDocument()
    expect(screen.getByText(/El plazo debe estar entre 0 y 3650 días\./)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un nombre repetido que rechaza la base se muestra en el campo, sin texto técnico', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "transportes_organizacion_nombre_uq"' },
    })
    abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: 'Expreso' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(await screen.findByText(/Ya existe una empresa de transporte con ese nombre/)).toBeInTheDocument()
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument()
  })

  it('en la edición carga los datos, muestra el CUIT con guiones y manda el updated_at leído', async () => {
    const { onGuardado } = abrir({ transporte: TRANSPORTE })
    expect(screen.getByRole('dialog', { name: 'Editar empresa de transporte' })).toBeInTheDocument()
    expect(campo(/Empresa de transporte/)).toHaveValue('Expreso Ejemplo del Sur')
    expect(campo(/CUIT/)).toHaveValue('20-12345678-6')
    expect(campo(/Comisión/)).toHaveValue('2,5')
    expect(screen.getByRole('checkbox', { name: /Cobra contrarreembolso/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_transporte', expect.objectContaining({
      p_id: 'tr-1', p_actualizado_en: '2026-01-01T10:00:00.123456+00:00', p_activa: false, p_empresa_ids: ['e-1'],
    }))
  })

  it('ante un conflicto de edición avisa y ofrece Recargar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    const { onRecargar } = abrir({ transporte: TRANSPORTE })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(await screen.findByText(/Otra persona modificó esta empresa/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalled()
  })

  it('si la base rechaza por permisos (42501) lo dice en castellano', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    fireEvent.change(campo(/Empresa de transporte/), { target: { value: 'Expreso' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empresa' }))
    expect(await screen.findByText(/Solo un Administrador puede editar transportes/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
  })

  it('Cancelar cierra sin guardar', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('validación de transportes (espejo de la base)', () => {
  const valido = { ...FORMULARIO_TRANSPORTE_VACIO, nombre: 'Expreso' }

  it('parsearNumero acepta coma o punto y vacío = 0', () => {
    expect(parsearNumero('2,5')).toBe(2.5)
    expect(parsearNumero('2.5')).toBe(2.5)
    expect(parsearNumero('')).toBe(0)
    expect(parsearNumero('abc')).toBeNaN()
  })

  it('acepta los bordes 0 y 100 de comisión y plazo 0', () => {
    expect(validarTransporte({ ...valido, comision: '0' })).toEqual({})
    expect(validarTransporte({ ...valido, comision: '100' })).toEqual({})
    expect(validarTransporte({ ...valido, plazo_rendicion_dias: '0' })).toEqual({})
  })

  it('rechaza comisión negativa o mayor a 100, más de dos decimales, plazo decimal o negativo', () => {
    expect(validarTransporte({ ...valido, comision: '-1' }).comision).toBeDefined()
    expect(validarTransporte({ ...valido, comision: '100,01' }).comision).toBeDefined()
    expect(validarTransporte({ ...valido, comision: '2,555' }).comision).toBeDefined()
    expect(validarTransporte({ ...valido, plazo_rendicion_dias: '1,5' }).plazo_rendicion_dias).toBeDefined()
    expect(validarTransporte({ ...valido, plazo_rendicion_dias: '-1' }).plazo_rendicion_dias).toBeDefined()
  })

  it('el correo, si viene, debe tener formato válido', () => {
    expect(validarTransporte({ ...valido, correo: 'sin-arroba' }).correo).toBeDefined()
    expect(validarTransporte({ ...valido, correo: 'a@b.com' })).toEqual({})
  })
})
