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

  it('doble clic en «Sí, regenerar» dispara una sola regeneración', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    let resolver: (token: string) => void = () => undefined
    mocks.regenerar.mockImplementation(() => new Promise<string>((res) => { resolver = res }))
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    const confirmar = screen.getByRole('button', { name: 'Sí, regenerar' })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)
    expect(mocks.regenerar).toHaveBeenCalledTimes(1)
    resolver('Nuevo_t-' + 'y'.repeat(24))
    expect(await screen.findByDisplayValue(/seguimiento\/Nuevo_t-/)).toBeInTheDocument()
  })

  it('regenerar dos veces seguidas deja el último enlace', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    mocks.regenerar.mockResolvedValueOnce('Uno_t-' + 'a'.repeat(26)).mockResolvedValueOnce('Dos_t-' + 'b'.repeat(26))
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    for (const esperado of ['Uno_t-' + 'a'.repeat(26), 'Dos_t-' + 'b'.repeat(26)]) {
      fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
      expect(await screen.findByDisplayValue(`${window.location.origin}/seguimiento/${esperado}`)).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerar enlace' })).toBeEnabled())
    }
    expect(mocks.regenerar).toHaveBeenCalledTimes(2)
  })

  it('el foco pasa a «Cancelar» al confirmar y vuelve a «Regenerar enlace» al cancelar', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerar enlace' })).toHaveFocus())
  })

  it('si regenerar falla: avisa, conserva el enlace, no deja el aviso de éxito y «Reintentar» reintenta la regeneración', async () => {
    const NUEVO = 'Nuevo_t-' + 'y'.repeat(24)
    mocks.obtener.mockResolvedValue(TOKEN)
    mocks.regenerar.mockResolvedValueOnce(NUEVO).mockRejectedValueOnce({ code: '42501' }).mockResolvedValueOnce('Otro_t-' + 'z'.repeat(25))
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
    await screen.findByText(/dejó de funcionar/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerar enlace' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
    expect(screen.queryByText(/dejó de funcionar/)).not.toBeInTheDocument()
    expect(screen.getByDisplayValue(`${window.location.origin}/seguimiento/${NUEVO}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByDisplayValue(/seguimiento\/Otro_t-/)).toBeInTheDocument()
    expect(mocks.regenerar).toHaveBeenCalledTimes(3)
    expect(mocks.obtener).toHaveBeenCalledTimes(1)
  })

  it('el tope de regeneraciones muestra un aviso entendible', async () => {
    mocks.obtener.mockResolvedValue(TOKEN)
    mocks.regenerar.mockRejectedValue({ code: 'P0001', message: 'DEMASIADAS_REGENERACIONES: probá de nuevo' })
    montar()
    await screen.findByDisplayValue(URL_ESPERADA)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar enlace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, regenerar' }))
    expect(await screen.findByText(/demasiadas veces/)).toBeInTheDocument()
    expect(screen.getByDisplayValue(URL_ESPERADA)).toBeInTheDocument()
  })
})
