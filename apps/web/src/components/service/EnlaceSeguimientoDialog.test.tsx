import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ obtener: vi.fn(), regenerar: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/enlaceConsulta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/enlaceConsulta')>()),
  obtenerEnlaceConsulta: mocks.obtener,
  regenerarEnlaceConsulta: mocks.regenerar,
}))

import { urlEnlaceSeguimiento } from '../../lib/enlaceConsulta'
import { EnlaceSeguimientoDialog } from './EnlaceSeguimientoDialog'

const TOKEN = 'Tok_en-' + 'x'.repeat(25)
const URL_ESPERADA = `${window.location.origin}/seguimiento/${TOKEN}`

const montar = (onCerrar = vi.fn()) =>
  render(<EnlaceSeguimientoDialog abierto reparacionId="r-1" codigo="R-0001" onCerrar={onCerrar} />)

describe('EnlaceSeguimientoDialog (FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('arma la URL <origen>/seguimiento/<token>', () => {
    expect(urlEnlaceSeguimiento('https://panel.example.com/', 'abc')).toBe('https://panel.example.com/seguimiento/abc')
  })

  it('muestra la URL completa y confirma al copiar, sin enviar ningún mensaje', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    const escribir = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    montar()
    expect(await screen.findByDisplayValue(URL_ESPERADA)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    expect(escribir).toHaveBeenCalledWith(URL_ESPERADA)
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /avisar|enviar/i })).not.toBeInTheDocument()
  })

  it('«Cerrar» cierra el diálogo', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    const onCerrar = vi.fn()
    montar(onCerrar)
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0])
    expect(onCerrar).toHaveBeenCalled()
  })

  it('ante un error muestra el aviso y «Reintentar» vuelve a pedir el enlace', async () => {
    mocks.obtener.mockRejectedValueOnce({ code: '42501' }).mockResolvedValueOnce(TOKEN)
    montar()
    expect(await screen.findByText(/No tenés permiso para generar el enlace/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByDisplayValue(URL_ESPERADA)).toBeInTheDocument()
    expect(mocks.obtener).toHaveBeenCalledTimes(2)
  })

  it('si el portapapeles falla, avisa que se copie a mano', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true })
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    await waitFor(() => expect(screen.getByText(/copialo a mano/)).toBeInTheDocument())
  })

  it('«Regenerar enlace» pide confirmación y muestra el enlace nuevo', async () => {
    const NUEVO = 'Nuevo_t-' + 'y'.repeat(24)
    mocks.obtener.mockResolvedValue(TOKEN)
    mocks.regenerar.mockResolvedValue(NUEVO)
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    expect(mocks.regenerar).not.toHaveBeenCalled()
    expect(screen.getByText(/El enlace anterior dejará de funcionar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
    expect(await screen.findByDisplayValue(`${window.location.origin}/seguimiento/${NUEVO}`)).toBeInTheDocument()
    expect(mocks.regenerar).toHaveBeenCalledWith('r-1')
    expect(screen.getByText(/dejó de funcionar/)).toBeInTheDocument()
  })

  it('cancelar la confirmación no regenera', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.regenerar).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue(URL_ESPERADA)).toBeInTheDocument()
  })

  it('si regenerar falla, avisa y conserva el enlace vigente en pantalla', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    mocks.regenerar.mockRejectedValue({ code: '42501' })
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
  })
})
