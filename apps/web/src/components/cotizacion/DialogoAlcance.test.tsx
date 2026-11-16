import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ previsualizar: vi.fn(), cambiar: vi.fn() }))
vi.mock('../../hooks/useConfiguracionCotizacion', () => ({
  useCambioDeAlcance: () => ({ previsualizar: mocks.previsualizar, cambiar: mocks.cambiar, enviando: false }),
}))

import { DialogoAlcance } from './DialogoAlcance'

const PREVIA = {
  alcanceActual: 'sistema',
  redondeoPesos: 10,
  empresas: [
    { empresaId: 'e1', nombre: 'Mundo JC', preciosQueCambian: 38 },
    { empresaId: 'e2', nombre: 'San Javucho', preciosQueCambian: 22 },
  ],
  muestra: [
    { producto: 'Joystick Pro', sku: '5134a', usd: 19.92, porEmpresa: [{ empresaId: 'e1', hoy: 29190, nuevo: 29690 }, { empresaId: 'e2', hoy: 31000, nuevo: 31000 }] },
  ],
}

const abrir = (alcance: 'empresa' | 'sistema' = 'empresa') => {
  const onCerrar = vi.fn()
  const onCambiado = vi.fn()
  render(<DialogoAlcance alcance={alcance} onCerrar={onCerrar} onCambiado={onCambiado} />)
  return { onCerrar, onCambiado }
}

describe('DialogoAlcance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.previsualizar.mockResolvedValue(PREVIA)
  })

  it('pide la vista previa del alcance elegido y muestra «Qué va a cambiar» por empresa (FR-005)', async () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Pasar a una cotización por empresa' })).toBeInTheDocument()
    expect(await screen.findByText('38 precios')).toBeInTheDocument()
    expect(screen.getByText('22 precios')).toBeInTheDocument()
    expect(screen.getByText('Mundo JC hoy')).toBeInTheDocument()
    expect(mocks.previsualizar).toHaveBeenCalledWith('empresa')
    expect(mocks.cambiar).not.toHaveBeenCalled()
  })

  it('«Cambiar alcance» está deshabilitado hasta tener la vista previa', async () => {
    mocks.previsualizar.mockReturnValue(new Promise(() => undefined))
    abrir()
    expect(screen.getByRole('button', { name: 'Cambiar alcance' })).toBeDisabled()
  })

  it('confirmar aplica el cambio y avisa con los precios afectados', async () => {
    mocks.cambiar.mockResolvedValue({ ok: true, preciosAfectados: 60 })
    const { onCambiado } = abrir('sistema')
    expect(screen.getByRole('dialog', { name: 'Pasar a una cotización para todo el sistema' })).toBeInTheDocument()
    await screen.findByText('38 precios')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar alcance' }))
    await waitFor(() => expect(onCambiado).toHaveBeenCalledWith('sistema', 60))
    expect(mocks.cambiar).toHaveBeenCalledWith('sistema')
  })

  it('si la base rechaza el cambio muestra el error y el diálogo sigue abierto', async () => {
    mocks.cambiar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cambiar el alcance de la cotización.' })
    const { onCambiado } = abrir()
    await screen.findByText('38 precios')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar alcance' }))
    expect(await screen.findByText('Tu rol no puede cambiar el alcance de la cotización.')).toBeInTheDocument()
    expect(onCambiado).not.toHaveBeenCalled()
  })

  it('cancelar cierra sin cambiar nada', async () => {
    const { onCerrar } = abrir()
    await screen.findByText('38 precios')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.cambiar).not.toHaveBeenCalled()
  })

  it('si la vista previa falla ofrece reintentar y no deja cambiar', async () => {
    mocks.previsualizar.mockRejectedValueOnce(new Error('boom'))
    abrir()
    expect(await screen.findByText('No pudimos calcular qué va a cambiar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar alcance' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('38 precios')).toBeInTheDocument()
  })
})
