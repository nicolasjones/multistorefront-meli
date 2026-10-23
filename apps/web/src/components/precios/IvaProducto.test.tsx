import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Alicuota } from '../../lib/iva'
import { IvaProducto } from './IvaProducto'

const A21: Alicuota = { id: 'a21', nombre: '21 %', porcentaje: 21, exento: false }
const A105: Alicuota = { id: 'a105', nombre: '10,5 %', porcentaje: 10.5, exento: false }
const EXENTO: Alicuota = { id: 'ex', nombre: 'Exento', porcentaje: 0, exento: true }

const props = (extra: Partial<React.ComponentProps<typeof IvaProducto>> = {}): React.ComponentProps<typeof IvaProducto> => ({
  alicuotas: [A21, A105, EXENTO],
  alicuotaCategoria: A21,
  valor: '',
  onCambiar: vi.fn(),
  neto: 29186,
  cargando: false,
  hayError: false,
  onReintentar: vi.fn(),
  ...extra,
})

describe('IvaProducto (F-PRE-12, FR-021)', () => {
  it('hereda la alícuota de la categoría y muestra «Con IVA 21 %» con el IVA aparte', () => {
    render(<IvaProducto {...props()} />)
    expect(screen.getByRole('combobox', { name: 'IVA' })).toHaveTextContent('Heredar de la categoría (21 %)')
    expect(screen.getByText('Con IVA 21 %: $ 35.315 (IVA $ 6.129)')).toBeInTheDocument()
  })

  it('con alícuota propia manda sobre la de la categoría', () => {
    render(<IvaProducto {...props({ valor: 'a105', neto: 1000 })} />)
    expect(screen.getByText('Con IVA 10,5 %: $ 1.105 (IVA $ 105)')).toBeInTheDocument()
  })

  it('Exento: el final es el neto', () => {
    render(<IvaProducto {...props({ valor: 'ex', neto: 1000 })} />)
    expect(screen.getByText('Exento: $ 1.000 (sin IVA)')).toBeInTheDocument()
  })

  it('elegir una opción avisa con su id', () => {
    const onCambiar = vi.fn()
    render(<IvaProducto {...props({ onCambiar })} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'IVA' }))
    fireEvent.click(screen.getByRole('option', { name: '10,5 %' }))
    expect(onCambiar).toHaveBeenCalledWith('a105')
  })

  it('«Heredar» vuelve a vacío para que mande la alícuota de la categoría', () => {
    const onCambiar = vi.fn()
    render(<IvaProducto {...props({ valor: 'a105', onCambiar })} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'IVA' }))
    fireEvent.click(screen.getByRole('option', { name: 'Heredar de la categoría (21 %)' }))
    expect(onCambiar).toHaveBeenCalledWith('')
  })

  it('sin importe en pesos no escribe un ejemplo inventado', () => {
    render(<IvaProducto {...props({ neto: null })} />)
    expect(screen.queryByText(/Con IVA/)).not.toBeInTheDocument()
  })

  it('si falla la carga avisa y ofrece reintentar', () => {
    const onReintentar = vi.fn()
    render(<IvaProducto {...props({ hayError: true, onReintentar, alicuotas: [] })} />)
    expect(screen.getByText('No pudimos cargar las alícuotas de IVA.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar IVA' }))
    expect(onReintentar).toHaveBeenCalled()
  })

  it('solo lectura deshabilita el selector', () => {
    render(<IvaProducto {...props({ soloLectura: true })} />)
    expect(screen.getByRole('combobox', { name: 'IVA' })).toHaveAttribute('aria-disabled', 'true')
  })
})
