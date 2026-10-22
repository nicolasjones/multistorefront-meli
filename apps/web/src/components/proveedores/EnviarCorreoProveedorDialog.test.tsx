import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { functions: { invoke: mocks.invoke } } }))

import { EnviarCorreoProveedorDialog } from './EnviarCorreoProveedorDialog'

const PROVEEDOR = { id: 'prv-1', razon_social: 'Proveedor Uno SA', correo: 'ventas@uno.example.com' }

const abrir = () => {
  const onCerrar = vi.fn()
  const onEnviado = vi.fn()
  render(<EnviarCorreoProveedorDialog open proveedor={PROVEEDOR} onCerrar={onCerrar} onEnviado={onEnviado} />)
  return { onCerrar, onEnviado }
}
const completar = () => {
  fireEvent.change(screen.getByRole('textbox', { name: /Asunto/ }), { target: { value: '  Pedido  ' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Mensaje/ }), { target: { value: ' Hola ' } })
}

describe('EnviarCorreoProveedorDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.invoke.mockResolvedValue({ data: { resultado: 'correo_enviado' }, error: null })
  })

  it('muestra Para (solo lectura, con el correo del proveedor), Asunto, Mensaje y los botones', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Enviar correo a proveedor' })).toBeInTheDocument()
    const para = screen.getByRole('textbox', { name: 'Para' })
    expect(para).toHaveValue('ventas@uno.example.com')
    expect(para).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar correo' })).toBeInTheDocument()
  })

  it('con asunto y mensaje vacíos no invoca la función y muestra los errores', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(screen.getByText('Ingresá el asunto.')).toBeInTheDocument()
    expect(screen.getByText('Escribí el mensaje.')).toBeInTheDocument()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('envía solo proveedor, asunto y mensaje (sin destinatario) y avisa con onEnviado', async () => {
    const { onEnviado } = abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
    expect(mocks.invoke).toHaveBeenCalledWith('enviar-correo-proveedor', { body: { proveedor_id: 'prv-1', asunto: 'Pedido', mensaje: 'Hola' } })
  })

  it('si falla el envío muestra el error, no cierra y permite reintentar', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('red') })
    const { onEnviado } = abrir()
    completar()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText('No pudimos enviar el correo. Intentá de nuevo.')).toBeInTheDocument()
    expect(onEnviado).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enviar correo' })).toBeEnabled()
  })
})
