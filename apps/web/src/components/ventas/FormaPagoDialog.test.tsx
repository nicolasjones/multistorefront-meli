import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { FormaPagoDialog } from './FormaPagoDialog'
import type { FormaPago } from '../../lib/ventas/formasPago'

const SAN_JAVUCHO = { id: 'e-sj', nombre: 'San Javucho' }
const MUNDO_JC = { id: 'e-mjc', nombre: 'Mundo JC' }

const FORMA: FormaPago = {
  id: 'fp-1', empresa_id: 'e-sj', nombre: 'Efectivo', tipo: 'efectivo', exige_cuenta_cobro: false,
  genera_deuda: false, estado_inicial: 'cobrado', orden: 1, activo: true, updated_at: '2026-10-20T10:00:00.123456+00:00',
}

const abrir = (props: Partial<Parameters<typeof FormaPagoDialog>[0]> = {}) => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  const onRecargar = vi.fn()
  render(
    <FormaPagoDialog
      open
      empresa={SAN_JAVUCHO}
      empresas={[SAN_JAVUCHO, MUNDO_JC]}
      ordenSugerido={3}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      onRecargar={onRecargar}
      {...props}
    />,
  )
  return { onCerrar, onGuardado, onRecargar }
}

const nombre = () => screen.getByRole('textbox', { name: /Nombre/ })

// Botón de un grupo de opciones (Sí/No, estado inicial) por el nombre del grupo.
function botonDelGrupo(grupo: string, opcion: string): HTMLElement {
  const contenedor = screen.getByRole('group', { name: grupo })
  const boton = Array.from(contenedor.querySelectorAll('button')).find((candidato) => candidato.textContent === opcion)
  if (!boton) throw new Error(`No hay «${opcion}» en el grupo «${grupo}»`)
  return boton
}

describe('FormaPagoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: [], error: null })
  })

  it('en el alta muestra todos los campos del prototipo, la ayuda del estado inicial y los botones', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Nueva forma de pago' })).toBeInTheDocument()
    expect(nombre()).toHaveAttribute('placeholder', 'Ej.: Transferencia o depósito bancario')
    expect(screen.getByRole('combobox', { name: 'Tipo de forma de pago' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Exige cuenta de cobro' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Genera deuda' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Estado inicial del comprobante' })).toBeInTheDocument()
    expect(screen.getByText('Con este estado se crea el comprobante al elegir esta forma de pago.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Orden' })).toHaveValue('3')
    expect(screen.getByRole('checkbox', { name: 'Activo' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument()
  })

  it('«Empresas donde aplica» arranca con la empresa elegida marcada', () => {
    abrir()
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mundo JC' })).not.toBeChecked()
  })

  it('con el nombre vacío avisa «Completá el nombre», enfoca el campo y no llama a la base', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Completá el nombre')).toBeInTheDocument()
    expect(nombre()).toHaveFocus()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin ninguna empresa marcada no guarda y lo dice', async () => {
    abrir()
    fireEvent.change(nombre(), { target: { value: 'Tarjeta' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'San Javucho' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Elegí al menos una empresa.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un orden que no es entero se rechaza en el campo', async () => {
    abrir()
    fireEvent.change(nombre(), { target: { value: 'Tarjeta' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Orden' }), { target: { value: 'uno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText(/El orden es un número entero/)).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('el alta multiempresa envía una sola llamada con las dos empresas y avisa «Creado · nombre»', async () => {
    const { onGuardado } = abrir()
    fireEvent.change(nombre(), { target: { value: '  Transferencia o depósito bancario  ' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mundo JC' }))
    fireEvent.click(botonDelGrupo('Exige cuenta de cobro', 'Sí'))
    fireEvent.click(botonDelGrupo('Estado inicial del comprobante', 'Aceptado'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('Creado · Transferencia o depósito bancario'))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('crear_forma_pago', {
      p_empresa_ids: ['e-sj', 'e-mjc'],
      p_nombre: 'Transferencia o depósito bancario',
      p_tipo: 'efectivo',
      p_exige_cuenta_cobro: true,
      p_genera_deuda: false,
      p_estado_inicial: 'aceptado',
      p_orden: 3,
      p_activo: true,
    })
  })

  it('un nombre repetido en la empresa se informa con un mensaje claro, sin datos técnicos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "formas_pago_empresa_nombre_key"' } })
    const { onGuardado } = abrir()
    fireEvent.change(nombre(), { target: { value: 'Efectivo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Ya existe una forma de pago con ese nombre en esa empresa.')).toBeInTheDocument()
    expect(screen.queryByText(/formas_pago_empresa_nombre_key/)).not.toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('en la edición carga los datos, bloquea las empresas y envía el updated_at leído', async () => {
    const { onGuardado } = abrir({ forma: FORMA })
    expect(screen.getByRole('dialog', { name: 'Editar forma de pago' })).toBeInTheDocument()
    expect(nombre()).toHaveValue('Efectivo')
    // Sin clic posible: la edición no reparte la forma entre empresas.
    for (const empresa of ['San Javucho', 'Mundo JC']) {
      expect(screen.getByRole('checkbox', { name: empresa })).toBeDisabled()
    }
    expect(screen.getByRole('checkbox', { name: 'San Javucho' })).toBeChecked()
    expect(screen.getByText('Los cambios aplican solo a San Javucho.')).toBeInTheDocument()

    fireEvent.change(nombre(), { target: { value: 'Efectivo en caja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith('Cambios guardados · Efectivo en caja'))
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_forma_pago', expect.objectContaining({
      p_id: 'fp-1', p_actualizado_en: FORMA.updated_at, p_nombre: 'Efectivo en caja', p_estado_inicial: 'cobrado',
    }))
  })

  it('un conflicto de edición ofrece «Recargar» y no cierra el diálogo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'modificada' } })
    const { onGuardado, onRecargar } = abrir({ forma: FORMA })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText(/Otra persona modificó esta forma de pago/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onRecargar).toHaveBeenCalledTimes(1)
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('Cancelar cierra sin guardar', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
