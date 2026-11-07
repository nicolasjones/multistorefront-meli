import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import { BotonCompartir } from './BotonCompartir'

// F-TDA-25 (SC-007, FR-020…FR-024).
const ID = 'a1000000-0000-4000-8000-000000000001'
const NOMBRE = 'Joystick Pro'
const ENLACE = `${window.location.origin}/producto/${ID}`

function definirNavegador(valores: { share?: unknown; writeText?: unknown }) {
  Object.defineProperty(navigator, 'share', { value: valores.share, configurable: true, writable: true })
  Object.defineProperty(navigator, 'clipboard', {
    value: valores.writeText === undefined ? undefined : { writeText: valores.writeText },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => definirNavegador({}))
afterEach(() => vi.restoreAllMocks())

const boton = () => screen.getByRole('button', { name: 'Compartir' })

describe('BotonCompartir (FR-020)', () => {
  it('está presente con nombre accesible y se activa con el teclado', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    definirNavegador({ share })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    const b = boton()
    expect(b.tagName).toBe('BUTTON')
    // jsdom no convierte Enter en click: un <button> nativo enfocable y sin tabindex negativo es
    // accionable con teclado en el navegador (verificado en el E2E).
    b.focus()
    expect(b).toHaveFocus()
    expect(b).not.toHaveAttribute('tabindex', '-1')
    fireEvent.click(b)
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  })
})

describe('BotonCompartir · selector del sistema (FR-021)', () => {
  it('abre el selector con el nombre del producto y el enlace', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    definirNavegador({ share })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: NOMBRE, url: ENLACE }))
    expect(screen.queryByText('Enlace copiado')).not.toBeInTheDocument()
  })

  it('si la persona lo cierra sin elegir (AbortError) no hay error ni aviso ni copia', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'))
    const writeText = vi.fn()
    definirNavegador({ share, writeText })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    await waitFor(() => expect(share).toHaveBeenCalled())
    await Promise.resolve()
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('Enlace copiado')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Copiá este enlace')).not.toBeInTheDocument()
  })
})

describe('BotonCompartir · copia (FR-022)', () => {
  it('sin selector copia el enlace y avisa «Enlace copiado» en una región aria-live', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    definirNavegador({ writeText })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(boton())
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENLACE))
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
    expect(region).toContainElement(screen.getByText('Enlace copiado'))
  })

  it('si el portapapeles rechaza, muestra el enlace seleccionado para copiarlo a mano', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denegado', 'NotAllowedError'))
    definirNavegador({ writeText })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    const campo = (await screen.findByLabelText('Copiá este enlace')) as HTMLInputElement
    expect(campo.value).toBe(ENLACE)
    expect(campo).toHaveAttribute('readonly')
    expect(screen.queryByText('Enlace copiado')).not.toBeInTheDocument()
    await waitFor(() => expect(campo.selectionEnd).toBe(ENLACE.length))
  })

  it('sin selector ni portapapeles muestra el enlace manual', async () => {
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    expect(await screen.findByLabelText('Copiá este enlace')).toHaveValue(ENLACE)
  })

  it('un fallo del selector que no es cancelación cae en la copia', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('falló', 'NotAllowedError'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    definirNavegador({ share, writeText })
    render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(ENLACE)
  })
})

describe('BotonCompartir · accesibilidad (FR-024)', () => {
  it('sin violaciones de axe en reposo, con aviso y con enlace manual', async () => {
    const { container, unmount } = render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    expect(await violacionesAxe(container)).toEqual([])
    unmount()

    definirNavegador({ writeText: vi.fn().mockResolvedValue(undefined) })
    const copiado = render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    await screen.findByText('Enlace copiado')
    expect(await violacionesAxe(copiado.container)).toEqual([])
    copiado.unmount()

    definirNavegador({})
    const manual = render(<BotonCompartir productoId={ID} nombre={NOMBRE} />)
    fireEvent.click(boton())
    await screen.findByLabelText('Copiá este enlace')
    expect(await violacionesAxe(manual.container)).toEqual([])
  })
})
