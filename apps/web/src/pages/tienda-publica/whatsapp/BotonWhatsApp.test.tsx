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

// Reglas de CSS que MUI generó para un elemento (jsdom no hace layout: no hay ancho calculado, solo
// las reglas que emotion inyectó).
function reglasDe(elemento: HTMLElement): string {
  const clases = elemento.className.split(' ').filter((clase) => clase.startsWith('css-'))
  const css = Array.from(document.querySelectorAll('style')).map((hoja) => hoja.textContent ?? '').join('\n')
  return clases
    .flatMap((clase) => css.match(new RegExp(`\\.${clase}\\s*\\{[^}]*\\}`, 'g')) ?? [])
    .join('\n')
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

  // El ancho completo en celular lo lleva el elemento que la fila de acciones acomoda (el
  // `data-testid="boton-whatsapp"`), no el botón: un `width: 100%` dentro de un contenedor de ancho
  // automático se resuelve como `auto` (CSS 2.1 §10.3.2) y el botón quedaría más angosto que
  // «Ver más productos». En jsdom no hay layout, así que se comprueba el CSS que MUI generó.
  it('el botón ocupa el ancho completo del elemento que la fila de acciones acomoda', async () => {
    const { container } = montar()
    await screen.findByRole('button', { name: 'Consultar por WhatsApp' })
    const envoltorio = container.querySelector('[data-testid="boton-whatsapp"]') as HTMLElement
    const boton = screen.getByRole('button', { name: 'Consultar por WhatsApp' })
    // El ítem de la fila es el que tiene el ancho completo (y no el botón).
    expect(reglasDe(envoltorio)).toMatch(/width:\s*100%/)
    // Y el botón ocupa el 100% de ese ítem.
    expect(getComputedStyle(boton).width).toBe('100%')
  })
})
