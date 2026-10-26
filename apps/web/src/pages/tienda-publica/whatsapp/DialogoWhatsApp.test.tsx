import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ registrar: vi.fn() }))

vi.mock('../../../lib/registroWhatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/registroWhatsapp')>()),
  registrarConsultaWhatsapp: mocks.registrar,
}))

import DialogoWhatsApp from './DialogoWhatsApp'

const HOST = 'mundojc.localhost'
const PRODUCTO_ID = '11111111-1111-4111-8111-111111111111'
const MENSAJE = 'Hola Mundo JC, quiero consultar por Joystick Pro ($ 18.455). ¿Está disponible?'
const URL_WA = 'https://wa.me/5491173652596?text=Hola%20Mundo%20JC'

function Montar({ abiertoInicial = true, onAviso = () => undefined }: { abiertoInicial?: boolean; onAviso?: () => void }) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>Consultar por WhatsApp</button>
      <DialogoWhatsApp
        abierto={abierto}
        host={HOST}
        productoId={PRODUCTO_ID}
        empresa="Mundo JC"
        numero="+54 9 11 7365-2596"
        mensaje={MENSAJE}
        url={URL_WA}
        onCerrar={() => setAbierto(false)}
        onAviso={onAviso}
      />
    </>
  )
}

// El fondo del diálogo (MUI) es el elemento con la clase `MuiBackdrop-root`: el clic fuera del cuadro
// llega por ahí.
function clicFuera() {
  const fondo = document.querySelector('.MuiBackdrop-root')
  if (!fondo) throw new Error('El diálogo no tiene fondo')
  fireEvent.mouseDown(fondo)
  fireEvent.click(fondo)
}

// F-TDA-14 (FR-021, FR-023, FR-024, FR-026): textos del diálogo, cierre sin efectos, apertura de
// `wa.me` con `noopener`, registro que no bloquea y accesibilidad del diálogo.
describe('DialogoWhatsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.registrar.mockResolvedValue('ok')
  })

  it('muestra el título, la línea «empresa · número», el mensaje solo lectura y los dos botones', async () => {
    render(<Montar />)
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveAccessibleName('Consultar por WhatsApp')
    expect(screen.getByRole('heading', { name: 'Consultar por WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText('Mundo JC · +54 9 11 7365-2596')).toBeInTheDocument()
    const mensaje = screen.getByLabelText('Mensaje que se va a enviar')
    expect(mensaje).toHaveValue(MENSAJE)
    expect(mensaje).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir WhatsApp' })).toBeInTheDocument()
  })

  it('el foco inicial cae dentro del diálogo (en el título)', async () => {
    render(<Montar />)
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Consultar por WhatsApp' })).toHaveFocus())
  })

  it('«Cancelar» cierra sin efectos', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Montar />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(abrir).not.toHaveBeenCalled()
    expect(mocks.registrar).not.toHaveBeenCalled()
    abrir.mockRestore()
  })

  it('Esc cierra sin efectos', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Montar />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(abrir).not.toHaveBeenCalled()
    expect(mocks.registrar).not.toHaveBeenCalled()
    abrir.mockRestore()
  })

  it('el clic fuera cierra sin efectos', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Montar />)
    await screen.findByRole('dialog')
    clicFuera()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(abrir).not.toHaveBeenCalled()
    expect(mocks.registrar).not.toHaveBeenCalled()
    abrir.mockRestore()
  })

  it('«Abrir WhatsApp» abre wa.me en una pestaña nueva con noopener, cierra y avisa', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    const onAviso = vi.fn()
    render(<Montar onAviso={onAviso} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    expect(abrir).toHaveBeenCalledWith(URL_WA, '_blank', 'noopener')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onAviso).toHaveBeenCalledTimes(1)
    abrir.mockRestore()
  })

  it('el registro no bloquea la apertura: el diálogo cierra aunque la llamada no termine', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.registrar.mockReturnValue(new Promise(() => {}))
    render(<Montar />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.registrar).toHaveBeenCalledTimes(1)
    expect(mocks.registrar).toHaveBeenCalledWith(HOST, PRODUCTO_ID, expect.any(String))
  })

  it('cada apertura usa su propia clave de envío: dos aperturas, dos consultas', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Montar abiertoInicial={false} />)
    const boton = screen.getByRole('button', { name: 'Consultar por WhatsApp' })

    fireEvent.click(boton)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(boton)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledTimes(2))

    // La clave se genera al abrir el diálogo, no en cada render: dos aperturas distintas registran dos
    // consultas (si compartieran clave, la segunda no llegaría a la bandeja por idempotencia).
    const claves = mocks.registrar.mock.calls.map((llamada) => llamada[2])
    expect(claves[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(claves[1]).not.toBe(claves[0])
    abrir.mockRestore()
  })

  it('el límite y las fallas del registro no se muestran al visitante', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.registrar.mockResolvedValue('limite')
    render(<Montar />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/límite/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
  })

  it('al cerrar, el foco vuelve al botón que abrió el diálogo', async () => {
    render(<Montar abiertoInicial={false} />)
    const boton = screen.getByRole('button', { name: 'Consultar por WhatsApp' })
    boton.focus()
    fireEvent.click(boton)
    await screen.findByRole('dialog')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(boton).toHaveFocus())
  })

  it('el foco queda atrapado dentro del diálogo', async () => {
    render(<Montar />)
    await screen.findByRole('dialog')
    // Con el diálogo abierto, MUI marca el resto de la página como `aria-hidden`: el botón de
    // afuera se busca con `hidden` para poder mover el foco y comprobar que vuelve al diálogo.
    const fuera = screen.getByRole('button', { name: 'Consultar por WhatsApp', hidden: true })
    fuera.focus()
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true))
  })

  it.each([320, 768, 1440])('a %i px el diálogo no tiene violaciones de axe', async (ancho) => {
    window.innerWidth = ancho
    render(<Montar />)
    const dialogo = await screen.findByRole('dialog')
    expect(await violacionesAxe(dialogo)).toEqual([])
  })
})
