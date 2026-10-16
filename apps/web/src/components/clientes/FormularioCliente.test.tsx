import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FORMULARIO_CLIENTE_VACIO } from '../../lib/clientes'
import { FormularioCliente } from './FormularioCliente'

const abrir = (onGuardar = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <MemoryRouter>
      <FormularioCliente inicial={FORMULARIO_CLIENTE_VACIO} etiquetaGuardar="Crear cliente" onGuardar={onGuardar} rutaCancelar="/clientes" />
    </MemoryRouter>,
  )
  return onGuardar
}

const escribir = (etiqueta: RegExp | string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

describe('FormularioCliente', () => {
  it('muestra los campos de la ficha y los botones Cancelar y guardar', () => {
    abrir()
    for (const etiqueta of ['Nombre o razón social', 'DNI/CUIT', 'Correo', 'Teléfono', 'Celular', 'Dirección', 'Código postal', 'Localidad', 'Provincia']) {
      expect(screen.getByLabelText(new RegExp(etiqueta))).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Cancelar' })).toHaveAttribute('href', '/clientes')
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled()
  })

  it('nombre solo con espacios: error en el campo y no guarda', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, '   ')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ingresá el nombre o la razón social.')).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre o razón social/i)).toHaveAttribute('aria-invalid', 'true')
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('correo con formato inválido: no guarda', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, 'Distribuidora Norte SRL')
    escribir('Correo', 'no-es-un-correo')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ingresá un correo con formato válido.')).toBeInTheDocument()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('guarda con el nombre recortado y los opcionales vacíos como null', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, '  Distribuidora Norte SRL  ')
    escribir('DNI/CUIT', '30-71234567-8')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(1))
    expect(onGuardar).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Distribuidora Norte SRL', documento: '30-71234567-8', correo: null, provincia: null }),
    )
  })

  it('doble envío: mientras guarda deshabilita el botón y envía una sola vez', async () => {
    let terminar: () => void = () => undefined
    const onGuardar = vi.fn().mockImplementation(() => new Promise<void>((resolver) => { terminar = resolver }))
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Cliente')
    const boton = screen.getByRole('button', { name: 'Crear cliente' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled()
    expect(onGuardar).toHaveBeenCalledTimes(1)
    terminar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeEnabled())
  })

  it('DNI/CUIT repetido: el error aparece en el campo documento, no como error general', async () => {
    const onGuardar = vi.fn().mockRejectedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "clientes_org_documento_uq"',
    })
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Otro cliente')
    escribir('DNI/CUIT', '30712345678')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Ya existe un cliente con ese DNI/CUIT')).toBeInTheDocument()
    expect(screen.getByLabelText('DNI/CUIT')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('No se guardó el cliente.')).not.toBeInTheDocument()
  })

  it('nombre repetido: se guarda sin aviso', async () => {
    const onGuardar = abrir()
    escribir(/nombre o razón social/i, 'Distribuidora Norte SRL')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    expect(screen.queryByText(/ya existe/i)).not.toBeInTheDocument()
  })

  it('error de servidor: lo muestra, conserva lo escrito y permite reintentar', async () => {
    const onGuardar = vi.fn().mockRejectedValueOnce(new Error('Falló la red')).mockResolvedValueOnce(undefined)
    abrir(onGuardar)
    escribir(/nombre o razón social/i, 'Cliente')
    escribir('Localidad', 'Rosario')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText('Falló la red')).toBeInTheDocument()
    expect(screen.getByLabelText('Localidad')).toHaveValue('Rosario')
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Falló la red')).not.toBeInTheDocument())
  })
})
