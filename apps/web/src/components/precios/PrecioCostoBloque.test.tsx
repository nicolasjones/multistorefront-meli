import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrecioCostoBloque } from './PrecioCostoBloque'

const COTIZACION = { valor: 1465, fecha: '2026-09-25T15:00:00Z' }

const montar = (props: Partial<React.ComponentProps<typeof PrecioCostoBloque>> = {}) => {
  const onMoneda = vi.fn()
  const onPrecio = vi.fn()
  const onCosto = vi.fn()
  render(
    <PrecioCostoBloque
      moneda="USD"
      precioLista="20"
      costo="12"
      onMoneda={onMoneda}
      onPrecio={onPrecio}
      onCosto={onCosto}
      conCosto
      costoEditable
      soloLectura={false}
      cotizacion={COTIZACION}
      cargandoCotizacion={false}
      errorCotizacion={false}
      {...props}
    />,
  )
  return { onMoneda, onPrecio, onCosto }
}

describe('PrecioCostoBloque', () => {
  it('USD con cotización: muestra el precio en pesos, el hint de costo con el dólar y el margen', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Precio y costo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('$ 29.300')
    expect(screen.getByText('costo $ 17.580 · con dólar $ 1.465 (vie 25/09)')).toBeInTheDocument()
    expect(screen.getByText('Margen estimado (escala x1):')).toBeInTheDocument()
    expect(screen.getByText('40 %')).toBeInTheDocument()
    expect(screen.getByText(/Margen = Precio − Costo − Comisión del canal/)).toBeInTheDocument()
    expect(screen.getByText('El precio de lista se carga sin IVA.')).toBeInTheDocument()
  })

  it('ARS: el precio y el costo se muestran tal cual, sin conversión ni dólar', () => {
    montar({ moneda: 'ARS', precioLista: '1000', costo: '600', cotizacion: null })
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('$ 1.000')
    expect(screen.getByText('El precio ya está en pesos.')).toBeInTheDocument()
    expect(screen.queryByText(/con dólar/)).not.toBeInTheDocument()
    expect(screen.getByText('40 %')).toBeInTheDocument()
  })

  it('USD sin cotización avisa «Cargá la cotización» y no inventa precio ni margen', () => {
    montar({ cotizacion: null })
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('—')
    expect(screen.getByText('Cargá la cotización')).toBeInTheDocument()
    expect(screen.getByText('—', { selector: 'strong' })).toBeInTheDocument()
  })

  it('mientras carga la cotización no pide cargarla, y si falla lo dice', () => {
    const { unmount } = render(
      <PrecioCostoBloque
        moneda="USD" precioLista="20" costo="" onMoneda={vi.fn()} onPrecio={vi.fn()} onCosto={vi.fn()}
        conCosto costoEditable soloLectura={false} cotizacion={null} cargandoCotizacion errorCotizacion={false}
      />,
    )
    expect(screen.queryByText('Cargá la cotización')).not.toBeInTheDocument()
    unmount()
    montar({ cotizacion: null, errorCotizacion: true })
    expect(screen.getByText(/No pudimos cargar la cotización/)).toBeInTheDocument()
  })

  it('sin la sección rentabilidad no hay Costo, hint de costo ni margen', () => {
    montar({ conCosto: false, costo: '' })
    expect(screen.queryByLabelText('Costo')).not.toBeInTheDocument()
    expect(screen.queryByText(/Margen estimado/)).not.toBeInTheDocument()
    expect(screen.queryByText(/costo \$/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Precio en pesos')).toHaveValue('$ 29.300')
  })

  it('muestra el error en el campo y es usable con teclado/lector', () => {
    montar({ errorPrecio: 'Ingresá el precio de lista.', errorCosto: 'Ingresá un costo de cero o más.' })
    const precio = screen.getByLabelText(/^Precio de lista/)
    expect(precio).toHaveAccessibleDescription('Ingresá el precio de lista.')
    expect(precio).toBeInvalid()
    expect(screen.getByLabelText('Costo')).toHaveAccessibleDescription('Ingresá un costo de cero o más.')
  })

  it('reenvía los cambios de precio, costo y moneda', () => {
    const { onPrecio, onCosto, onMoneda } = montar()
    fireEvent.change(screen.getByLabelText(/^Precio de lista/), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Costo'), { target: { value: '15' } })
    expect(onPrecio).toHaveBeenCalled()
    expect(onCosto).toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByLabelText('Moneda'))
    fireEvent.click(screen.getByRole('option', { name: 'ARS · pesos' }))
    expect(onMoneda).toHaveBeenCalledWith('ARS')
  })

  it('solo lectura deshabilita todos los campos', () => {
    montar({ soloLectura: true })
    expect(screen.getByLabelText(/^Precio de lista/)).toBeDisabled()
    expect(screen.getByLabelText('Costo')).toBeDisabled()
  })

  it('con lectura en Rentabilidad el costo se ve pero no se edita', () => {
    montar({ costoEditable: false })
    expect(screen.getByLabelText('Costo')).toBeDisabled()
  })
})
