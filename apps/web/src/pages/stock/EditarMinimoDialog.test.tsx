import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc } }))

import EditarMinimoDialog from './EditarMinimoDialog'

const abrir = () => {
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  render(<EditarMinimoDialog producto={{ id: 'p-1', nombre: 'Joystick', minimo: 2 }} onCerrar={onCerrar} onGuardado={onGuardado} />)
  return { onCerrar, onGuardado }
}

describe('EditarMinimoDialog', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: {}, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('parte del mínimo vigente y guarda un valor válido', async () => {
    const { onCerrar, onGuardado } = abrir()
    const campo = screen.getByLabelText('Cantidad mínima')
    expect(campo).toHaveValue('2')
    fireEvent.change(campo, { target: { value: ' 7 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('definir_minimo_stock', { p_producto: 'p-1', p_minimo: 7 })
    expect(onCerrar).toHaveBeenCalled()
  })

  it.each(['-1', '1.5', 'abc', ''])('rechaza «%s» sin llamar al servidor', async (valor) => {
    abrir()
    fireEvent.change(screen.getByLabelText('Cantidad mínima'), { target: { value: valor } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El mínimo debe ser un entero de cero o más.')).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un rechazo del servidor se explica en castellano y no cierra', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates policy' } })
    const { onCerrar, onGuardado } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
    expect(screen.queryByText(/policy/)).not.toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('un fallo de red muestra el mensaje por defecto', async () => {
    rpc.mockRejectedValue(new Error('red'))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No pudimos guardar el mínimo. Intentá de nuevo.')).toBeInTheDocument()
  })
})
