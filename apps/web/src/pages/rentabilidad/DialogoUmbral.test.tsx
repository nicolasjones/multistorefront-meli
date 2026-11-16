import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useUmbralMargen: vi.fn(), guardar: vi.fn(), recargar: vi.fn() }))
vi.mock('../../hooks/useRentabilidad', () => ({ useUmbralMargen: mocks.useUmbralMargen }))

import { DialogoUmbral } from './DialogoUmbral'

const montar = (estado: Record<string, unknown> = {}) => {
  mocks.useUmbralMargen.mockReturnValue({
    umbral: { umbral: 0.1, actualizadoEn: null },
    hayError: false,
    guardando: false,
    recargar: mocks.recargar,
    guardar: mocks.guardar,
    ...estado,
  })
  const onCerrar = vi.fn()
  const onGuardado = vi.fn()
  render(<DialogoUmbral onCerrar={onCerrar} onGuardado={onGuardado} />)
  return { onCerrar, onGuardado }
}

const campo = () => screen.getByRole('textbox', { name: 'Umbral de margen bajo' })

describe('DialogoUmbral', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardar.mockResolvedValue({ ok: true })
  })

  it('arranca con el umbral vigente en % y los botones Cancelar y Guardar', () => {
    montar()
    expect(screen.getByRole('dialog', { name: 'Umbral de margen bajo' })).toBeInTheDocument()
    expect(campo()).toHaveValue('10')
    expect(screen.getByText('%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('valida el rango: vacío, 0 y más de 100 no se pueden guardar y muestran el mensaje', () => {
    montar()
    for (const valor of ['0', '101', '12,345']) {
      fireEvent.change(campo(), { target: { value: valor } })
      expect(screen.getByText('Ingresá un porcentaje mayor a 0 y hasta 100, por ejemplo 10 o 12,5.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    }
    fireEvent.change(campo(), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('el campo descarta caracteres que no sean dígitos o coma', () => {
    montar()
    fireEvent.change(campo(), { target: { value: '1a2.5%' } })
    expect(campo()).toHaveValue('125')
  })

  it('guarda la fracción y avisa al dueño', async () => {
    const { onGuardado } = montar()
    fireEvent.change(campo(), { target: { value: '12,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await vi.waitFor(() => expect(onGuardado).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith(0.125)
  })

  it('si la base rechaza, muestra el mensaje claro y no avisa guardado', async () => {
    mocks.guardar.mockResolvedValue({ ok: false, mensaje: 'Tu rol no puede cambiar el umbral de margen bajo.' })
    const { onGuardado } = montar()
    fireEvent.change(campo(), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Tu rol no puede cambiar el umbral de margen bajo.')).toBeInTheDocument()
    expect(onGuardado).not.toHaveBeenCalled()
  })

  it('Cancelar cierra sin guardar', () => {
    const { onCerrar } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('mientras lee el umbral no ofrece guardar; si falla la lectura ofrece Reintentar', () => {
    montar({ umbral: null })
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('con error de lectura muestra Reintentar', () => {
    montar({ umbral: null, hayError: true })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
  })
})
