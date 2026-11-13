import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CargaInfinita } from './CargaInfinita'

type Observador = { callback: IntersectionObserverCallback; observar: ReturnType<typeof vi.fn>; desconectar: ReturnType<typeof vi.fn> }
let observadores: Observador[] = []

describe('CargaInfinita', () => {
  beforeEach(() => {
    observadores = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observar = vi.fn()
        desconectar = vi.fn()
        constructor(callback: IntersectionObserverCallback) {
          observadores.push({ callback, observar: this.observar, desconectar: this.desconectar })
        }
        observe(nodo: Element) { this.observar(nodo) }
        disconnect() { this.desconectar() }
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const interseca = (isIntersecting: boolean) =>
    observadores.at(-1)?.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)

  it('pide la tanda siguiente al llegar al final y no antes', () => {
    const onCargarMas = vi.fn()
    render(<CargaInfinita hayMas cargando={false} onCargarMas={onCargarMas} />)
    interseca(false)
    expect(onCargarMas).not.toHaveBeenCalled()
    interseca(true)
    expect(onCargarMas).toHaveBeenCalledTimes(1)
  })

  it('«Cargar más» funciona con el teclado/click como alternativa al scroll', () => {
    const onCargarMas = vi.fn()
    render(<CargaInfinita hayMas cargando={false} onCargarMas={onCargarMas} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(onCargarMas).toHaveBeenCalledTimes(1)
  })

  it('mientras carga no observa ni pide de nuevo y muestra el estado de carga', () => {
    render(<CargaInfinita hayMas cargando onCargarMas={vi.fn()} />)
    expect(observadores).toHaveLength(0)
    expect(screen.getByTestId('carga-infinita-anuncio')).toHaveTextContent('Cargando más resultados')
    expect(screen.getByRole('button', { name: 'Cargar más' })).toHaveAttribute('aria-busy', 'true')
  })

  it('mientras carga el botón sigue montado, conserva el foco y no pide de nuevo al activarlo', () => {
    const onCargarMas = vi.fn()
    const { rerender } = render(<CargaInfinita hayMas cargando={false} onCargarMas={onCargarMas} />)
    const boton = screen.getByRole('button', { name: 'Cargar más' })
    boton.focus()
    fireEvent.click(boton)
    expect(onCargarMas).toHaveBeenCalledTimes(1)
    rerender(<CargaInfinita hayMas cargando onCargarMas={onCargarMas} />)
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBe(boton)
    expect(document.activeElement).toBe(boton)
    fireEvent.click(boton)
    expect(onCargarMas).toHaveBeenCalledTimes(1)
  })

  it('anuncia en una región viva cuántos productos se sumaron', () => {
    const { rerender } = render(<CargaInfinita hayMas cargando={false} cargados={24} onCargarMas={vi.fn()} />)
    rerender(<CargaInfinita hayMas cargando cargados={24} onCargarMas={vi.fn()} />)
    expect(screen.getByTestId('carga-infinita-anuncio')).toHaveTextContent('Cargando más resultados')
    rerender(<CargaInfinita hayMas cargando={false} cargados={48} onCargarMas={vi.fn()} />)
    expect(screen.getByTestId('carga-infinita-anuncio')).toHaveTextContent('24 productos más cargados')
    expect(screen.getByTestId('carga-infinita-anuncio')).toHaveAttribute('aria-live', 'polite')
  })

  it('al llegar al final anuncia «No hay más resultados» y pasa el foco al texto de fin', () => {
    const { rerender } = render(<CargaInfinita hayMas cargando={false} cargados={24} onCargarMas={vi.fn()} />)
    const boton = screen.getByRole('button', { name: 'Cargar más' })
    boton.focus()
    rerender(<CargaInfinita hayMas cargando cargados={24} onCargarMas={vi.fn()} />)
    rerender(<CargaInfinita hayMas={false} cargando={false} cargados={30} onCargarMas={vi.fn()} />)
    expect(screen.getByTestId('carga-infinita-anuncio')).toHaveTextContent('No hay más resultados')
    expect(document.activeElement).toBe(screen.getByText('No hay más resultados.'))
  })

  it('si falla la tanda muestra el error con «Reintentar» y no pide solo', () => {
    const onCargarMas = vi.fn()
    render(<CargaInfinita hayMas cargando={false} hayError onCargarMas={onCargarMas} />)
    expect(observadores).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onCargarMas).toHaveBeenCalledTimes(1)
  })

  it('sin más resultados dice que es el fin y deja de observar', () => {
    const { rerender } = render(<CargaInfinita hayMas cargando={false} onCargarMas={vi.fn()} />)
    rerender(<CargaInfinita hayMas={false} cargando={false} onCargarMas={vi.fn()} />)
    expect(observadores[0].desconectar).toHaveBeenCalled()
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('sin IntersectionObserver (navegador viejo) queda el botón «Cargar más»', () => {
    vi.unstubAllGlobals()
    render(<CargaInfinita hayMas cargando={false} onCargarMas={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
  })
})
