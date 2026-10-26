import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EscalasPrecio } from './EscalasPrecio'

const montar = (props: Partial<React.ComponentProps<typeof EscalasPrecio>> = {}) => {
  const onCambiar = vi.fn()
  render(
    <EscalasPrecio
      moneda="ARS"
      precioLista="1000"
      costo="600"
      valores={{ x5: '800', x10: '', x50: '' }}
      errores={{}}
      onCambiar={onCambiar}
      conMargen
      cotizacion={null}
      soloLectura={false}
      {...props}
    />,
  )
  return { onCambiar }
}

describe('EscalasPrecio (F-PRE-15, FR-026)', () => {
  it('muestra el bloque con las cuatro escalas y el texto adaptado a «cada tipo de cliente»', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Precios por escala · sin IVA' })).toBeInTheDocument()
    expect(screen.getByText('Minorista usa x1 · cada tipo de cliente usa su escala')).toBeInTheDocument()
    expect(screen.queryByText(/según la cantidad/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^x1 · 1 a 4 u\./)).toHaveValue('1000')
    expect(screen.getByLabelText(/^x5 · 5 a 9 u\./)).toHaveValue('800')
    expect(screen.getByLabelText(/^x10 · 10 a 49 u\./)).toHaveValue('')
    expect(screen.getByLabelText(/^x50 · 50 u\. o más/)).toHaveValue('')
  })

  it('carga: x1 es el precio de lista y no se edita acá', () => {
    montar()
    expect(screen.getByLabelText(/^x1 · 1 a 4 u\./)).toBeDisabled()
    expect(screen.getByLabelText(/^x5 · 5 a 9 u\./)).toBeEnabled()
  })

  it('muestra el margen de cada escala con su etiqueta de uso', () => {
    montar()
    expect(screen.getByText('Margen 40 % · todos')).toBeInTheDocument()
    expect(screen.getByText('Margen 25 % · mayoristas')).toBeInTheDocument()
    // Sin precio propio la escala usa la lista, y lo dice.
    expect(screen.getAllByText('Margen 40 % · mayoristas · usa el precio de lista')).toHaveLength(2)
  })

  it('sin la sección rentabilidad no muestra ningún margen, solo la etiqueta de uso', () => {
    montar({ conMargen: false, costo: '' })
    expect(screen.queryByText(/Margen/)).not.toBeInTheDocument()
    expect(screen.getByText('todos')).toBeInTheDocument()
  })

  it('USD sin cotización no inventa margen', () => {
    montar({ moneda: 'USD', precioLista: '20', costo: '12', valores: { x5: '16', x10: '', x50: '' }, cotizacion: null })
    expect(screen.getByText('Margen — · todos')).toBeInTheDocument()
    expect(screen.getByLabelText(/^x5 · 5 a 9 u\. \(USD\)/)).toBeInTheDocument()
  })

  it('USD con cotización convierte para el margen: (16 − 12) / 16 = 25 %', () => {
    montar({ moneda: 'USD', precioLista: '20', costo: '12', valores: { x5: '16', x10: '', x50: '' }, cotizacion: 1465 })
    expect(screen.getByText('Margen 25 % · mayoristas')).toBeInTheDocument()
  })

  it('escribir en una escala avisa cuál y con qué valor', () => {
    const { onCambiar } = montar()
    fireEvent.change(screen.getByLabelText(/^x10 · 10 a 49 u\./), { target: { value: '700' } })
    expect(onCambiar).toHaveBeenCalledWith('x10', '700')
  })

  it('un error de validación queda en el campo de esa escala', () => {
    montar({ errores: { x5: 'Ingresá un precio de cero o más, con hasta 12 enteros y 2 decimales.' } })
    const campo = screen.getByLabelText(/^x5 · 5 a 9 u\./)
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Ingresá un precio de cero o más/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^x10 · 10 a 49 u\./)).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('solo lectura o guardando: ninguna escala se edita', () => {
    montar({ soloLectura: true })
    for (const rotulo of [/^x5 · /, /^x10 · /, /^x50 · /]) {
      expect(screen.getByLabelText(rotulo)).toBeDisabled()
    }
  })

  it('el bloque es una región con nombre para el lector de pantalla', () => {
    montar()
    expect(screen.getByRole('region', { name: 'Precios por escala' })).toBeInTheDocument()
  })
})
