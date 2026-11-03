import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { VistaPreviaCorreo } from './vista-previa'

describe('Correo masivo · vista previa y envío de prueba', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('FR-013: muestra el correo final con el mensaje, el pie fijo y un enlace de baja de ejemplo', () => {
    render(<VistaPreviaCorreo asunto="Ofertas de octubre" mensaje={'Hola\nTenemos ofertas.'} />)
    expect(screen.getByRole('heading', { name: 'Vista previa' })).toBeInTheDocument()
    expect(screen.getByText('Ofertas de octubre')).toBeInTheDocument()
    expect(screen.getByTestId('vista-previa-mensaje')).toHaveTextContent('Hola Tenemos ofertas.')
    expect(screen.getByTestId('vista-previa-pie')).toHaveTextContent('Si no querés recibirlo más, date de baja acá')
    expect(screen.getByTestId('vista-previa-enlace')).toHaveAttribute('title', expect.stringContaining('/baja-correo/ejemplo'))
    expect(screen.getByTestId('vista-previa-pie')).toHaveTextContent('Enlace de ejemplo')
  })

  it('el mensaje se muestra como texto: el HTML no se interpreta', () => {
    render(<VistaPreviaCorreo asunto="Asunto" mensaje={'<b>negrita</b><img src=x onerror=alert(1)>'} />)
    const mensaje = screen.getByTestId('vista-previa-mensaje')
    expect(mensaje).toHaveTextContent('<b>negrita</b><img src=x onerror=alert(1)>')
    expect(mensaje.querySelector('b, img')).toBeNull()
  })

  it('FR-014: «Enviar prueba» pide la prueba al autor con el asunto y el mensaje redactados', async () => {
    render(<VistaPreviaCorreo asunto="  Prueba " mensaje="Cuerpo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('solicitar_prueba_correo_masivo', { p_asunto: 'Prueba', p_mensaje: 'Cuerpo' }))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Te enviamos una prueba a tu correo/)).toBeInTheDocument()
  })

  it('sin asunto o sin mensaje no se puede enviar la prueba', () => {
    const { rerender } = render(<VistaPreviaCorreo asunto="" mensaje="Cuerpo" />)
    expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled()
    rerender(<VistaPreviaCorreo asunto="Asunto" mensaje="  " />)
    expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un rechazo de la base muestra un mensaje claro, no el detalle técnico', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', hint: 'limite', message: 'detalle' } })
    render(<VistaPreviaCorreo asunto="Asunto" mensaje="Cuerpo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }))
    expect(await screen.findByText(/Ya pediste varias pruebas/)).toBeInTheDocument()
    expect(screen.queryByText('detalle')).not.toBeInTheDocument()
  })
})
