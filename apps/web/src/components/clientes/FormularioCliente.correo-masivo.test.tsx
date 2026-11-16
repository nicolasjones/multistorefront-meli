import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FORMULARIO_CLIENTE_VACIO, type FormularioCliente as FormularioDatos } from '../../lib/clientes'
import { FormularioCliente } from './FormularioCliente'

const abrir = (inicial: FormularioDatos = FORMULARIO_CLIENTE_VACIO) => {
  const onGuardar = vi.fn().mockResolvedValue(undefined)
  render(
    <MemoryRouter>
      <FormularioCliente inicial={inicial} etiquetaGuardar="Crear cliente" onGuardar={onGuardar} rutaCancelar="/clientes" />
    </MemoryRouter>,
  )
  return onGuardar
}

// F-CLI-11, FR-002: el interruptor «Incluir en el correo masivo» del alta y la edición.
describe('FormularioCliente · correo masivo', () => {
  it('en el alta nace encendido y se guarda con el cliente', async () => {
    const onGuardar = abrir()
    expect(screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' })).toBeChecked()
    fireEvent.change(screen.getByLabelText(/nombre o razón social/i), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ acepta_correo_masivo: true })
  })

  it('al apagarlo se guarda como falso', async () => {
    const onGuardar = abrir()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' }))
    expect(screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText(/nombre o razón social/i), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(onGuardar.mock.calls[0][0]).toMatchObject({ acepta_correo_masivo: false })
  })

  it('en la edición respeta lo guardado del cliente', () => {
    abrir({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', aceptaCorreoMasivo: false })
    expect(screen.getByRole('checkbox', { name: 'Incluir en el correo masivo' })).not.toBeChecked()
  })
})
