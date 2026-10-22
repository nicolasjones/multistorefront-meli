import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccesoRestringido } from './AccesoRestringido'

const mocks = vi.hoisted(() => ({ solicitarAcceso: vi.fn() }))

vi.mock('../../lib/solicitarAcceso', () => ({ solicitarAcceso: mocks.solicitarAcceso }))

function renderizar(seccionClave = 'rentabilidad') {
  return render(
    <MemoryRouter>
      <AccesoRestringido rol="Operador" seccion="Rentabilidad" seccionClave={seccionClave || undefined} />
    </MemoryRouter>,
  )
}

describe('AccesoRestringido (F-ROL-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.solicitarAcceso.mockResolvedValue({ ok: true, sinAdministradores: false })
  })

  it('muestra el título y el motivo con el rol y la sección reales', () => {
    renderizar()

    expect(screen.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toBeInTheDocument()
    expect(
      screen.getByText('Tu rol (Operador) no incluye Rentabilidad. Pedile acceso a un administrador.'),
    ).toBeInTheDocument()
  })

  it('«Volver al inicio» es un enlace operable por teclado hacia la raíz', () => {
    renderizar()

    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
  })

  it('no repite el título de página en el estado vacío', () => {
    renderizar()

    expect(screen.queryByText('Acceso restringido')).not.toBeInTheDocument()
    expect(screen.getByText('Sección no disponible para tu rol')).toBeInTheDocument()
  })
})

describe('AccesoRestringido · Solicitar acceso (F-ROL-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.solicitarAcceso.mockResolvedValue({ ok: true, sinAdministradores: false })
  })

  it('ofrece «Solicitar acceso» junto a «Volver al inicio»', () => {
    renderizar()

    expect(screen.getByRole('button', { name: 'Solicitar acceso' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toBeInTheDocument()
  })

  it('sin la clave de la sección no ofrece el botón', () => {
    renderizar('')

    expect(screen.queryByRole('button', { name: 'Solicitar acceso' })).not.toBeInTheDocument()
  })

  it('al pulsar envía la sección y muestra la confirmación', async () => {
    renderizar()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }))

    expect(await screen.findByText('Solicitud enviada al administrador')).toBeInTheDocument()
    expect(mocks.solicitarAcceso).toHaveBeenCalledWith('rentabilidad')
    expect(screen.getByRole('button', { name: 'Solicitar acceso' })).toBeDisabled()
  })

  it('doble clic no duplica el pedido', async () => {
    let resolver: (valor: { ok: true; sinAdministradores: false }) => void = () => undefined
    mocks.solicitarAcceso.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    renderizar()
    const boton = screen.getByRole('button', { name: 'Solicitar acceso' })

    fireEvent.click(boton)
    fireEvent.click(boton)
    resolver({ ok: true, sinAdministradores: false })

    expect(await screen.findByText('Solicitud enviada al administrador')).toBeInTheDocument()
    expect(mocks.solicitarAcceso).toHaveBeenCalledTimes(1)
  })

  it('mientras envía deshabilita el botón', async () => {
    mocks.solicitarAcceso.mockReturnValue(new Promise(() => undefined))
    renderizar()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }))

    expect(await screen.findByRole('button', { name: 'Enviando…' })).toBeDisabled()
  })

  it('si falla muestra el error con «Reintentar» y el reintento confirma', async () => {
    mocks.solicitarAcceso.mockResolvedValueOnce({ ok: false, mensaje: 'Tu solicitud quedó registrada, pero no pudimos avisar al administrador. Intentá de nuevo.' })
    renderizar()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }))
    expect(await screen.findByText(/no pudimos avisar al administrador/)).toBeInTheDocument()
    expect(screen.queryByText('Solicitud enviada al administrador')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Solicitud enviada al administrador')).toBeInTheDocument()
    expect(mocks.solicitarAcceso).toHaveBeenCalledTimes(2)
  })

  it('si la invocación se rechaza muestra un error genérico en vez de romper', async () => {
    mocks.solicitarAcceso.mockRejectedValueOnce(new Error('red'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderizar()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument())
  })

  it('sin administrador activo informa que no hay a quién notificar', async () => {
    mocks.solicitarAcceso.mockResolvedValueOnce({ ok: true, sinAdministradores: true })
    renderizar()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar acceso' }))

    expect(await screen.findByText(/no tiene un administrador activo/)).toBeInTheDocument()
  })
})
