import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enviar: vi.fn() }))

vi.mock('../../../lib/tiendaContacto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaContacto')>()),
  enviarConsultaContacto: mocks.enviar,
}))

import { FormularioContacto } from './FormularioContacto'

const llenar = (nombre = 'Ana', contacto = 'ana@ejemplo.com', mensaje = 'Hola, ¿tienen stock?') => {
  fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: nombre } })
  fireEvent.change(screen.getByLabelText(/^Correo o WhatsApp/), { target: { value: contacto } })
  fireEvent.change(screen.getByLabelText(/^Mensaje/), { target: { value: mensaje } })
}
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
const claveDeLlamada = (n: number) => mocks.enviar.mock.calls[n][2] as string

// F-TDA-16 (FR-011…FR-013, FR-015).
describe('FormularioContacto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enviar.mockResolvedValue({ estado: 'exito' })
  })

  it('muestra «Escribinos», los tres campos con sus placeholders y «Enviar consulta»', () => {
    render(<FormularioContacto host="mundojc.localhost" />)
    expect(screen.getByRole('heading', { name: 'Escribinos' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveAttribute('placeholder', 'Tu nombre')
    expect(screen.getByLabelText(/^Correo o WhatsApp/)).toHaveAttribute('placeholder', 'Para responderte')
    expect(screen.getByLabelText(/^Mensaje/)).toHaveAttribute('placeholder', 'Contanos qué producto te interesa')
    expect(screen.getByRole('button', { name: 'Enviar consulta' })).toBeEnabled()
  })

  it('vacío: cada campo muestra su error asociado, enfoca el primero y no envía', () => {
    render(<FormularioContacto host="h" />)
    enviar()
    const nombre = screen.getByLabelText(/^Nombre/)
    expect(nombre).toHaveFocus()
    expect(nombre).toHaveAttribute('aria-invalid', 'true')
    const descripcion = document.getElementById(nombre.getAttribute('aria-describedby') ?? '')
    expect(descripcion).toHaveTextContent('Escribí tu nombre.')
    expect(screen.getByLabelText(/^Correo o WhatsApp/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^Mensaje/)).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.enviar).not.toHaveBeenCalled()
  })

  it('el foco va al primer campo con error aunque no sea el primero', () => {
    render(<FormularioContacto host="h" />)
    llenar('Ana', 'sin-formato', 'Hola')
    enviar()
    expect(screen.getByLabelText(/^Correo o WhatsApp/)).toHaveFocus()
  })

  it('deshabilita «Enviar consulta» mientras envía y no duplica el envío', async () => {
    let resolver: (valor: unknown) => void = () => {}
    mocks.enviar.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    const boton = await screen.findByRole('button', { name: 'Enviando…' })
    expect(boton).toBeDisabled()
    fireEvent.submit(boton.closest('form') as HTMLFormElement)
    expect(mocks.enviar).toHaveBeenCalledTimes(1)
    resolver({ estado: 'exito' })
    await screen.findByText('¡Gracias! Recibimos tu consulta')
  })

  it('éxito: confirmación con foco y «Enviar otra» vuelve al formulario vacío con una clave nueva', async () => {
    render(<FormularioContacto host="mundojc.localhost" />)
    llenar()
    enviar()
    const gracias = await screen.findByRole('heading', { name: '¡Gracias! Recibimos tu consulta' })
    expect(gracias).toHaveFocus()
    expect(screen.getByText('Te respondemos por el medio que dejaste.')).toBeInTheDocument()
    expect(mocks.enviar).toHaveBeenCalledWith('mundojc.localhost', { nombre: 'Ana', contacto: 'ana@ejemplo.com', mensaje: 'Hola, ¿tienen stock?' }, expect.any(String))

    fireEvent.click(screen.getByRole('button', { name: 'Enviar otra' }))
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('')
    expect(screen.getByLabelText(/^Nombre/)).toHaveFocus()
    llenar('Beto', 'beto@ejemplo.com', 'Otra consulta')
    enviar()
    await screen.findByText('¡Gracias! Recibimos tu consulta')
    expect(claveDeLlamada(1)).not.toBe(claveDeLlamada(0))
  })

  it('límite: mensaje de espera con los minutos y conserva lo escrito', async () => {
    mocks.enviar.mockResolvedValue({ estado: 'espera', esperaSegundos: 125 })
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    expect(await screen.findByText('Hiciste varias consultas seguidas. Probá de nuevo en 3 minutos.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nombre/)).toHaveValue('Ana')
    expect(screen.getByLabelText(/^Mensaje/)).toHaveValue('Hola, ¿tienen stock?')
  })

  it('límite de un minuto va en singular', async () => {
    mocks.enviar.mockResolvedValue({ estado: 'espera', esperaSegundos: 30 })
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    expect(await screen.findByText('Hiciste varias consultas seguidas. Probá de nuevo en 1 minuto.')).toBeInTheDocument()
  })

  it('error: «Reintentar» conserva lo escrito y reutiliza la misma clave', async () => {
    mocks.enviar.mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValueOnce({ estado: 'exito' })
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    expect(await screen.findByText('No pudimos enviar tu consulta.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Mensaje/)).toHaveValue('Hola, ¿tienen stock?')

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText('¡Gracias! Recibimos tu consulta')
    expect(claveDeLlamada(1)).toBe(claveDeLlamada(0))
  })

  it('si edita el texto después de un error, el nuevo intento usa otra clave', async () => {
    mocks.enviar.mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValueOnce({ estado: 'exito' })
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    await screen.findByText('No pudimos enviar tu consulta.')
    fireEvent.change(screen.getByLabelText(/^Mensaje/), { target: { value: 'Mensaje corregido' } })
    enviar()
    await waitFor(() => expect(mocks.enviar).toHaveBeenCalledTimes(2))
    expect(claveDeLlamada(1)).not.toBe(claveDeLlamada(0))
  })

  it('inválido del servidor: marca los campos que indicó y enfoca el primero', async () => {
    mocks.enviar.mockResolvedValue({ estado: 'invalido', campos: ['contacto'] })
    render(<FormularioContacto host="h" />)
    llenar()
    enviar()
    expect(await screen.findByText('Revisá el correo o el WhatsApp.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Correo o WhatsApp/)).toHaveFocus()
  })

  it('el HTML escrito se envía y se muestra como dato (nunca se interpreta)', async () => {
    render(<FormularioContacto host="h" />)
    llenar('<b>Ana</b>', 'ana@ejemplo.com', '<script>alert(1)</script>')
    enviar()
    await screen.findByText('¡Gracias! Recibimos tu consulta')
    expect(mocks.enviar).toHaveBeenCalledWith('h', { nombre: '<b>Ana</b>', contacto: 'ana@ejemplo.com', mensaje: '<script>alert(1)</script>' }, expect.any(String))
    expect(document.querySelector('script')).toBeNull()
  })
})
