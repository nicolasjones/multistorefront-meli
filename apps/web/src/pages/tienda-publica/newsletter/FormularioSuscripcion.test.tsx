import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), suscribir: vi.fn(), legal: vi.fn() }))

vi.mock('../../../lib/tiendaLegal', () => ({ useLegalTienda: () => mocks.legal() }))
vi.mock('../../../lib/tiendaNewsletter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaNewsletter')>()),
  leerNewsletterTienda: mocks.leer,
  suscribirseNewsletter: mocks.suscribir,
}))

import { FormularioSuscripcion } from './FormularioSuscripcion'

const llenar = (correo = 'ana@ejemplo.com', casilla = true) => {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: correo } })
  const marca = screen.getByRole('checkbox')
  if (casilla !== (marca as HTMLInputElement).checked) fireEvent.click(marca)
}
const enviar = () => fireEvent.click(screen.getByRole('button', { name: /Suscribirme|Reintentar/ }))
const mostrar = async () => {
  render(<FormularioSuscripcion host="mundojc.localhost" />)
  await screen.findByTestId('pie-newsletter')
}

// MSF-468 (RF-NL-2, CA-NL-1).
describe('FormularioSuscripcion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leer.mockResolvedValue({ activo: true, tienda: 'Mundo JC' })
    mocks.suscribir.mockResolvedValue({ estado: 'exito' })
    mocks.legal.mockReturnValue(null)
  })

  it('no se muestra con la función apagada ni mientras carga ni si la lectura falla', async () => {
    mocks.leer.mockResolvedValue({ activo: false, tienda: null })
    const { container, rerender } = render(<FormularioSuscripcion host="a" />)
    await waitFor(() => expect(mocks.leer).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    mocks.leer.mockRejectedValue(new Error('x'))
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    rerender(<FormularioSuscripcion host="b" />)
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledWith('b'))
    expect(container).toBeEmptyDOMElement()
    consola.mockRestore()
  })

  it('muestra el correo, la casilla SIN marcar con el texto de consentimiento y «Suscribirme»', async () => {
    await mostrar()
    expect(screen.getByRole('heading', { name: 'Newsletter' })).toBeInTheDocument()
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('type', 'email')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByText(/Acepto recibir novedades de Mundo JC por correo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suscribirme' })).toBeEnabled()
  })

  it('enlaza la política de privacidad solo si la tienda la tiene', async () => {
    mocks.legal.mockReturnValue({ enlaces: [{ titulo: 'Política de privacidad', url: 'https://mundojc.example/privacidad' }, { titulo: 'Términos', url: 'https://mundojc.example/t' }] })
    await mostrar()
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', 'https://mundojc.example/privacidad')
    expect(screen.queryByRole('link', { name: 'Términos' })).toBeNull()
  })

  it('CA-NL-1: correo inválido o casilla sin marcar marca el campo y no envía', async () => {
    await mostrar()
    enviar()
    expect(await screen.findByText('Escribí tu correo.')).toBeInTheDocument()
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true')
    llenar('esto-no-es-un-correo', false)
    enviar()
    expect(await screen.findByText('Ingresá un correo válido.')).toBeInTheDocument()
    llenar('ana@ejemplo.com', false)
    enviar()
    expect(await screen.findByText('Marcá la casilla para suscribirte.')).toBeInTheDocument()
    expect(mocks.suscribir).not.toHaveBeenCalled()
  })

  it('con datos válidos envía con clave y campo trampa vacío y muestra el mensaje de éxito', async () => {
    await mostrar()
    llenar()
    enviar()
    expect(await screen.findByText('Te enviamos un correo para confirmar tu suscripción.')).toBeInTheDocument()
    expect(mocks.suscribir).toHaveBeenCalledWith('mundojc.localhost', { correo: 'ana@ejemplo.com', consentimiento: true }, expect.stringMatching(/^[0-9a-f-]{36}$/), '')
  })

  it('el campo trampa va oculto a lectores y sale con lo que contenga', async () => {
    await mostrar()
    const trampa = document.querySelector('input[name="sitio"]') as HTMLInputElement
    expect(trampa.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(trampa).toHaveAttribute('tabindex', '-1')
    fireEvent.change(trampa, { target: { value: 'spam' } })
    llenar()
    enviar()
    await waitFor(() => expect(mocks.suscribir.mock.calls[0][3]).toBe('spam'))
  })

  it('límite: avisa los minutos y conserva lo escrito', async () => {
    mocks.suscribir.mockResolvedValue({ estado: 'espera', esperaSegundos: 130 })
    await mostrar()
    llenar()
    enviar()
    expect(await screen.findByTestId('newsletter-espera')).toHaveTextContent('Probá de nuevo en 3 minutos.')
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('ana@ejemplo.com')
  })

  it('error: «Reintentar» reutiliza la clave; cambiar el correo pide una nueva', async () => {
    mocks.suscribir.mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValueOnce({ estado: 'falla' }).mockResolvedValue({ estado: 'exito' })
    await mostrar()
    llenar()
    enviar()
    expect(await screen.findByTestId('newsletter-falla')).toBeInTheDocument()
    enviar()
    await waitFor(() => expect(mocks.suscribir).toHaveBeenCalledTimes(2))
    expect(mocks.suscribir.mock.calls[1][2]).toBe(mocks.suscribir.mock.calls[0][2])
    await screen.findByTestId('newsletter-falla')
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'otra@ejemplo.com' } })
    enviar()
    await waitFor(() => expect(mocks.suscribir).toHaveBeenCalledTimes(3))
    expect(mocks.suscribir.mock.calls[2][2]).not.toBe(mocks.suscribir.mock.calls[0][2])
  })

  it('SC-002: el servidor marca un campo inválido y el formulario lo muestra', async () => {
    mocks.suscribir.mockResolvedValue({ estado: 'invalido', campos: ['correo'] })
    await mostrar()
    llenar()
    enviar()
    expect(await screen.findByText('Revisá el correo.')).toBeInTheDocument()
  })
})
