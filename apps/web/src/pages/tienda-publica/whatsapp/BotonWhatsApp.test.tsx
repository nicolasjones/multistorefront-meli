import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ rpcPublico: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: nombre === 'publico' ? mocks.rpcPublico : vi.fn() }) },
}))

import { BotonWhatsApp } from './BotonWhatsApp'

const HOST = 'mundojc.localhost'
const PRODUCTO_ID = '11111111-1111-4111-8111-111111111111'

function montar(props: Partial<Parameters<typeof BotonWhatsApp>[0]> = {}) {
  return render(
    <BotonWhatsApp
      host={HOST}
      empresa="Mundo JC"
      producto="Joystick Pro"
      productoId={PRODUCTO_ID}
      precio={18455.4}
      {...props}
    />,
  )
}

// F-TDA-14 (FR-020, FR-021): el botón «Consultar por WhatsApp» existe solo si la empresa tiene un
// número válido; sin número la ficha se ve sin botón y sin hueco.
describe('BotonWhatsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpcPublico.mockResolvedValue({
      data: { nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: null, horarios: null },
      error: null,
    })
  })

  it('con número válido, muestra el botón «Consultar por WhatsApp»', async () => {
    montar()
    expect(await screen.findByRole('button', { name: 'Consultar por WhatsApp' })).toBeInTheDocument()
    expect(mocks.rpcPublico).toHaveBeenCalledWith('contacto_por_dominio', { host: HOST })
  })

  it('sin número, no hay botón ni hueco', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: null }, error: null })
    const { container } = montar()
    await waitFor(() => expect(mocks.rpcPublico).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('con un número de menos de 8 dígitos, tampoco hay botón', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: { nombre: 'Mundo JC', whatsapp: '1234567' }, error: null })
    const { container } = montar()
    await waitFor(() => expect(mocks.rpcPublico).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('mientras carga el contacto todavía no hay botón (no aparece un hueco con botón)', async () => {
    mocks.rpcPublico.mockReturnValue(new Promise(() => {}))
    const { container } = montar()
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('si la lectura falla, no muestra el botón ni detalle técnico al visitante', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpcPublico.mockResolvedValue({ data: null, error: { message: 'detalle interno' } })
    const { container } = montar()
    await waitFor(() => expect(consola).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Consultar por WhatsApp' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/detalle interno/)).not.toBeInTheDocument()
    consola.mockRestore()
  })

  it('al tocarlo, abre el diálogo con el mensaje armado y la línea de la empresa', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar por WhatsApp' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toBeInTheDocument()
    expect(screen.getByText('Mundo JC · +54 9 11 7365-2596')).toBeInTheDocument()
    expect(screen.getByLabelText('Mensaje que se va a enviar')).toHaveValue(
      'Hola Mundo JC, quiero consultar por Joystick Pro ($ 18.455). ¿Está disponible?',
    )
  })

  it('el botón no tiene violaciones de axe', async () => {
    const { container } = montar()
    await screen.findByRole('button', { name: 'Consultar por WhatsApp' })
    expect(await violacionesAxe(container)).toEqual([])
  })
})
