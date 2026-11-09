import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CONFIGURACION_POR_DEFECTO } from '../../lib/cotizacion'
import { TarjetaConfiguracion } from './TarjetaConfiguracion'

const NOMBRES = ['San Javucho', 'Mundo JC']

const montar = (props: Partial<Parameters<typeof TarjetaConfiguracion>[0]> = {}) => {
  const onGuardar = vi.fn()
  render(
    <TarjetaConfiguracion
      configuracion={CONFIGURACION_POR_DEFECTO}
      nombresEmpresas={NOMBRES}
      soloLectura={false}
      guardando={false}
      onGuardar={onGuardar}
      {...props}
    />,
  )
  return onGuardar
}

describe('TarjetaConfiguracion', () => {
  it('muestra los textos y los valores del lanzamiento por defecto (FR-008)', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Una para todo el sistema' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Redondeo del precio en pesos')).toHaveValue('10')
    expect(screen.getByLabelText('Umbral para recalcular')).toHaveValue('1')
    expect(screen.getByText('Si la variación es menor, se registra el valor pero no se tocan los precios.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Aviso en Inicio' })).toBeChecked()
    expect(screen.getByText('Mostrar alerta si no se cargó la cotización del día.')).toBeInTheDocument()
    expect(screen.getByText('Solo pueden cargarla los roles con edición en «Cotización del dólar» (hoy: Administrador).')).toBeInTheDocument()
    expect(screen.queryByText(/cargan su propio valor/)).not.toBeInTheDocument()
  })

  it('con «Una por empresa» muestra el texto con los nombres reales', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Una por empresa' }))
    expect(screen.getByText('San Javucho y Mundo JC cargan su propio valor. Cada oferta en USD usa el de su empresa.')).toBeInTheDocument()
  })

  it('guarda lo elegido con redondeo, umbral con coma y aviso apagado', () => {
    const onGuardar = montar()
    fireEvent.change(screen.getByLabelText('Redondeo del precio en pesos'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Umbral para recalcular'), { target: { value: '0,5' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aviso en Inicio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    expect(onGuardar).toHaveBeenCalledWith({ alcance: 'sistema', redondeoPesos: 50, umbralPct: 0.5, confirmacionPct: 15, avisoActivo: false })
  })

  it('un umbral inválido o mayor a la variación inusual se rechaza sin guardar', () => {
    const onGuardar = montar()
    fireEvent.change(screen.getByLabelText('Umbral para recalcular'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    expect(screen.getByText('Ingresá un umbral entre 0 y 100, por ejemplo 1 o 0,5.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Umbral para recalcular'), { target: { value: '20' } })
    expect(screen.getByText('El umbral tiene que ser menor a 15 %.')).toBeInTheDocument()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('no deja escribir letras en el umbral', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Umbral para recalcular'), { target: { value: 'abc2' } })
    expect(screen.getByLabelText('Umbral para recalcular')).toHaveValue('2')
  })

  it('en solo lectura todo está deshabilitado y no guarda', () => {
    const onGuardar = montar({ soloLectura: true })
    expect(screen.getByLabelText('Redondeo del precio en pesos')).toBeDisabled()
    expect(screen.getByLabelText('Umbral para recalcular')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Aviso en Inicio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Una por empresa' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeDisabled()
    expect(onGuardar).not.toHaveBeenCalled()
  })

  it('mientras guarda el botón dice «Guardando…» y se deshabilita', () => {
    montar({ guardando: true })
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
  })

  it('parte de lo configurado: umbral con coma y redondeo guardados', () => {
    montar({ configuracion: { ...CONFIGURACION_POR_DEFECTO, umbralPct: 2.5, redondeoPesos: 100, avisoActivo: false } })
    expect(screen.getByLabelText('Umbral para recalcular')).toHaveValue('2,5')
    expect(screen.getByLabelText('Redondeo del precio en pesos')).toHaveValue('100')
    expect(screen.getByRole('checkbox', { name: 'Aviso en Inicio' })).not.toBeChecked()
  })
})
