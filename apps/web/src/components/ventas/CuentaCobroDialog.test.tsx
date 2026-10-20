import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), useEmpresas: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))

import { CuentaCobroDialog } from './CuentaCobroDialog'
import type { CuentaCobro } from '../../lib/ventas/cuentasCobro'

const CBU = '0170099220000067797370'

const CUENTA: CuentaCobro = {
  id: 'c-1', nombre: 'Banco Uno', titular: 'Comercial Uno SRL', banco: 'Banco Uno', cbu: CBU,
  cuit: '30701234568', alias: 'uno.cobros', tipo: 'cuenta_corriente', moneda: 'ARS', orden: 2, activa: true,
  notas: null, updated_at: '2026-01-01T10:00:00.123456+00:00', empresas: [{ id: 'e-1', nombre: 'San Javucho' }],
}

const campo = (nombre: RegExp) => screen.getByRole('textbox', { name: nombre })

const abrir = (props: Partial<Parameters<typeof CuentaCobroDialog>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  const onRecargar = vi.fn()
  render(<CuentaCobroDialog open onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} {...props} />)
  return { onCerrar, onGuardado, onRecargar }
}

const completarAlta = (cbu = CBU, cuit = '30-70123456-8') => {
  fireEvent.change(campo(/Nombre de la cuenta/), { target: { value: 'Banco Nuevo ···7370' } })
  fireEvent.change(campo(/Titular/), { target: { value: 'Comercial Ejemplo SRL' } })
  fireEvent.change(campo(/CUIT del titular/), { target: { value: cuit } })
  fireEvent.change(campo(/CBU \/ CVU/), { target: { value: cbu } })
}

describe('CuentaCobroDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.useEmpresas.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: true }],
      isLoading: false, isError: false,
    })
  })

  it('muestra los campos del prototipo y los botones Cancelar y Guardar cuenta', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Cuenta de cobro' })).toBeInTheDocument()
    for (const nombre of [/Nombre de la cuenta/, /Titular/, /CUIT del titular/, /Banco/, /Alias/, /CBU \/ CVU/, /Notas internas/]) {
      expect(campo(nombre)).toBeInTheDocument()
    }
    expect(screen.getByRole('spinbutton', { name: /Orden/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tipo de cuenta' })).toBeInTheDocument()
    for (const tipo of ['Cuenta corriente', 'Caja de ahorro', 'Billetera virtual']) {
      expect(screen.getByRole('button', { name: tipo })).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: 'Moneda' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cuenta' })).toBeInTheDocument()
  })

  it('el interruptor Activa explica qué pasa al apagarlo (No usar conserva el historial)', () => {
    abrir()
    expect(screen.getByText('Se ofrece al cargar un comprobante')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Activa'))
    expect(screen.getByText('No usar: no se ofrece, conserva historial')).toBeInTheDocument()
  })

  it('con datos vacíos avisa por campo, enfoca el primero y no llama a la base', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    expect(await screen.findByText('Ingresá el nombre de la cuenta.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el titular.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el CUIT.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el CBU o CVU.')).toBeInTheDocument()
    expect(campo(/Nombre de la cuenta/)).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rechaza un CBU y un CUIT con dígito verificador inválido antes de viajar', async () => {
    abrir()
    completarAlta('0170099220000067797371', '20123456787')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    expect(await screen.findByText(/El CBU \/ CVU no es válido/)).toBeInTheDocument()
    expect(screen.getByText(/El CUIT no es válido/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('crea la cuenta con CUIT y CBU normalizados y las empresas marcadas', async () => {
    const { onGuardado } = abrir()
    completarAlta('0170 0992 2000 0067 7973 70')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mundo JC' }))
    fireEvent.click(screen.getByRole('button', { name: 'Billetera virtual' }))
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith({ alta: true, nombre: 'Banco Nuevo ···7370' }))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_cuenta_cobro', expect.objectContaining({
      p_nombre: 'Banco Nuevo ···7370', p_cuit: '30701234568', p_cbu: CBU, p_tipo: 'billetera_virtual', p_moneda: 'USD',
      p_activa: true, p_empresa_ids: ['e-2'],
    }))
  })

  it('en la edición carga la cuenta y manda el updated_at leído', async () => {
    const { onGuardado } = abrir({ cuenta: CUENTA })
    expect(campo(/Nombre de la cuenta/)).toHaveValue('Banco Uno')
    expect(campo(/CUIT del titular/)).toHaveValue('30-70123456-8')
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()
    fireEvent.change(campo(/Alias/), { target: { value: 'otro.alias' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith({ alta: false, nombre: 'Banco Uno' }))
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_cuenta_cobro', expect.objectContaining({
      p_id: 'c-1', p_actualizado_en: CUENTA.updated_at, p_alias: 'otro.alias', p_empresa_ids: ['e-1'],
    }))
  })

  it('ante un conflicto de edición explica qué pasó y ofrece Recargar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    const { onRecargar, onGuardado } = abrir({ cuenta: CUENTA })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    expect(await screen.findByText(/Otra persona modificó esta cuenta/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalled()
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('si la base rechaza por permiso muestra un mensaje en castellano, sin el texto técnico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } })
    abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    expect(await screen.findByText(/Solo un Administrador puede hacer esta acción/)).toBeInTheDocument()
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
  })

  it('con el guardado en vuelo, Esc no cierra el diálogo', async () => {
    let terminar: (v: { data: null; error: null }) => void = () => undefined
    mocks.rpc.mockReturnValue(new Promise((resolve) => { terminar = resolve }))
    const { onCerrar, onGuardado } = abrir()
    completarAlta()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuenta' }))
    await screen.findByRole('button', { name: 'Guardando…' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCerrar).not.toHaveBeenCalled()
    terminar({ data: null, error: null })
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
  })

  it('Cancelar cierra sin llamar a la base', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
