import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cargar: vi.fn(), useCargarCotizacion: vi.fn() }))
vi.mock('../../hooks/useCotizacion', () => ({ useCargarCotizacion: mocks.useCargarCotizacion }))

import { DialogoCargarDolar } from './DialogoCargarDolar'

const VIGENTE = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }
const ETIQUETA = 'Dólar del día (pesos por dólar)'

const abrir = (props: Partial<Parameters<typeof DialogoCargarDolar>[0]> = {}) => render(
  <DialogoCargarDolar abierto vigente={VIGENTE} onCerrar={vi.fn()} onCargada={vi.fn()} {...props} />,
)
const escribir = (texto: string) => fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: texto } })

describe('DialogoCargarDolar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useCargarCotizacion.mockReturnValue({ cargar: mocks.cargar, enviando: false })
  })

  it('muestra el campo con $ y «por USD», el anterior y la variación vacía', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Cargar dólar del día' })).toBeInTheDocument()
    expect(screen.getByText('$')).toBeInTheDocument()
    expect(screen.getByText('por USD')).toBeInTheDocument()
    expect(screen.getByText('Anterior: $ 1.465 (vie 25/09)')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeDisabled()
  })

  it('acepta 1490 y 1490,50 y muestra la variación', () => {
    abrir()
    escribir('1490')
    expect(screen.getByText('+1,7 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
    escribir('1490,50')
    expect(screen.getByText('+1,7 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })

  it('el campo solo admite dígitos, punto y coma', () => {
    abrir()
    escribir('14a9$0')
    expect(screen.getByLabelText(ETIQUETA)).toHaveValue('1490')
  })

  it.each(['0', '0,00', '1490.50', ',5'])('«%s» es inválido: muestra el mensaje y no se puede avanzar', (texto) => {
    abrir()
    escribir(texto)
    expect(screen.getByText('Ingresá un valor válido, por ejemplo 1490 o 1490,50.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Cargar dólar' }).closest('form') as HTMLFormElement)
    expect(mocks.cargar).not.toHaveBeenCalled()
  })

  it('avisa «Variación inusual» solo por encima del 15 % y no bloquea', () => {
    abrir()
    escribir('1650')
    expect(screen.queryByText('Variación inusual')).not.toBeInTheDocument()
    escribir('1700')
    expect(screen.getByText('Variación inusual')).toBeInTheDocument()
    expect(screen.getByText(/La variación supera el 15 %/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })

  it('carga el valor y avisa al llamador', async () => {
    const carga = { valor: 1490.5, anterior: 1465, variacionPct: 1.74, expiraEn: 'x' }
    mocks.cargar.mockResolvedValue({ ok: true, carga })
    const onCargada = vi.fn()
    abrir({ onCargada })
    escribir('1490,50')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar dólar' }))
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(1490.5))
    expect(onCargada).toHaveBeenCalledWith(carga)
  })

  it('muestra el rechazo de la base sin cerrar el diálogo', async () => {
    mocks.cargar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cargar la cotización del dólar.' })
    const onCargada = vi.fn()
    abrir({ onCargada })
    escribir('1490')
    fireEvent.click(screen.getByRole('button', { name: 'Cargar dólar' }))
    expect(await screen.findByText('Tu rol no puede cargar la cotización del dólar.')).toBeInTheDocument()
    expect(onCargada).not.toHaveBeenCalled()
  })

  it('se envía con Enter (teclado) y se cierra con Cancelar', async () => {
    mocks.cargar.mockResolvedValue({ ok: true, carga: { valor: 1490, anterior: 1465, variacionPct: 1.7, expiraEn: 'x' } })
    const onCerrar = vi.fn()
    abrir({ onCerrar })
    escribir('1490')
    fireEvent.submit(screen.getByLabelText(ETIQUETA).closest('form') as HTMLFormElement)
    await waitFor(() => expect(mocks.cargar).toHaveBeenCalledWith(1490))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it('mientras envía no deja cerrar ni reenviar', () => {
    mocks.useCargarCotizacion.mockReturnValue({ cargar: mocks.cargar, enviando: true })
    abrir()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cargando…' })).toBeDisabled()
  })

  it('sin cotización vigente no inventa un «Anterior» ni una variación', () => {
    abrir({ vigente: null })
    escribir('1490')
    expect(screen.queryByText(/Anterior/)).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar dólar' })).toBeEnabled()
  })
})
