import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type FilaVariante, AVISO_VARIANTE_AGREGADA, NOMBRE_VARIANTE_NUEVA, TEXTO_SIN_VARIANTES } from '../../lib/productos-variantes'
import { BloqueVariantes } from './BloqueVariantes'

const NEGRO: FilaVariante = { clave: 'c1', id: 'v1', nombre: 'Negro', codigo: '5134a-N', codigoBarras: '7790000000011', activa: true, stock: 4 }
const BLANCO: FilaVariante = { clave: 'c2', id: 'v2', nombre: 'Blanco', codigo: '5134a-B', codigoBarras: '', activa: false, stock: 3 }

// Mantiene el estado como lo hace el formulario y expone el último valor.
function Envoltorio({ inicial = [], onCambio, ...resto }: { inicial?: FilaVariante[]; onCambio?: (filas: FilaVariante[]) => void } & Partial<React.ComponentProps<typeof BloqueVariantes>>) {
  const [filas, setFilas] = useState<FilaVariante[]>(inicial)
  return <BloqueVariantes filas={filas} onCambiar={(siguiente) => { setFilas(siguiente); onCambio?.(siguiente) }} skuProducto="5134a" verStock editarStock {...resto} />
}

describe('BloqueVariantes', () => {
  it('sin variantes: título, subtítulo, tabla de cinco columnas y el texto del prototipo (FR-003)', () => {
    render(<Envoltorio />)
    expect(screen.getByRole('heading', { name: 'Variantes' })).toBeInTheDocument()
    expect(screen.getByText(/Para un mismo producto con distintos colores o modelos/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Variantes del producto' })).toBeInTheDocument()
    for (const columna of ['Variante', 'Código', 'Código de barras', 'Stock', 'Activa']) {
      expect(screen.getByRole('columnheader', { name: columna })).toBeInTheDocument()
    }
    expect(screen.getByText(TEXTO_SIN_VARIANTES)).toBeInTheDocument()
    expect(screen.queryByText(/Stock del producto/)).not.toBeInTheDocument()
  })

  it('«Agregar variante» agrega la fila por defecto, avisa y suma al stock (FR-003)', () => {
    const onCambio = vi.fn()
    render(<Envoltorio inicial={[NEGRO]} onCambio={onCambio} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar variante' }))
    expect(screen.getByRole('status')).toHaveTextContent(AVISO_VARIANTE_AGREGADA)
    expect(onCambio).toHaveBeenCalledTimes(1)
    const filas = onCambio.mock.calls[0][0] as FilaVariante[]
    expect(filas).toHaveLength(2)
    expect(filas[1]).toMatchObject({ nombre: NOMBRE_VARIANTE_NUEVA, codigo: '5134a-2', codigoBarras: '', activa: true, stock: 0 })
    expect(screen.getByText(/Stock del producto/)).toHaveTextContent('Stock del producto (suma de las variantes activas): 4')
  })

  it('edita nombre, código y código de barras en línea', () => {
    const onCambio = vi.fn()
    render(<Envoltorio inicial={[NEGRO]} onCambio={onCambio} />)
    fireEvent.change(screen.getByLabelText('Nombre de la variante 1'), { target: { value: 'Negro intenso' } })
    expect(onCambio).toHaveBeenLastCalledWith([expect.objectContaining({ nombre: 'Negro intenso', codigo: '5134a-N' })])
    fireEvent.change(screen.getByLabelText('Código de la variante 1'), { target: { value: '5134a-N2' } })
    expect(onCambio).toHaveBeenLastCalledWith([expect.objectContaining({ nombre: 'Negro intenso', codigo: '5134a-N2' })])
    fireEvent.change(screen.getByLabelText('Código de barras de la variante 1'), { target: { value: '7790000000011' } })
    expect(onCambio).toHaveBeenLastCalledWith([expect.objectContaining({ codigoBarras: '7790000000011' })])
  })

  it('el interruptor Activa desactiva la variante y resta del stock (FR-010)', () => {
    const onCambio = vi.fn()
    render(<Envoltorio inicial={[NEGRO, BLANCO]} onCambio={onCambio} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activa: Negro' }))
    expect(onCambio).toHaveBeenLastCalledWith([{ ...NEGRO, activa: false }, BLANCO])
    expect(screen.getByText(/Stock del producto/)).toHaveTextContent('Stock del producto (suma de las variantes activas): 0')
  })

  it('muestra «—» en Stock sin acceso a Stock y no publica el total (FR-005)', () => {
    render(<Envoltorio inicial={[NEGRO]} verStock={false} editarStock={false} />)
    expect(screen.getAllByText('—')).toHaveLength(1)
    expect(screen.queryByText(/Stock del producto/)).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('con lectura en Stock ve la cantidad pero no la edita; con edición la edita (FR-005)', () => {
    const { rerender } = render(<Envoltorio inicial={[NEGRO]} editarStock={false} />)
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    rerender(<Envoltorio inicial={[NEGRO]} editarStock />)
    const stock = screen.getByRole('spinbutton', { name: 'Stock de la variante 1' })
    expect(stock).toHaveValue(4)
    fireEvent.change(stock, { target: { value: '6' } })
    expect(screen.getByRole('spinbutton', { name: 'Stock de la variante 1' })).toHaveValue(6)
  })

  it('muestra los errores por campo sin perder lo escrito (FR-002, FR-003)', () => {
    render(<Envoltorio inicial={[NEGRO]} errores={{ c1: { campo: 'codigo', mensaje: 'El código "5134a-N" ya lo usa otra variante' } }} />)
    expect(screen.getByLabelText('Código de la variante 1')).toHaveValue('5134a-N')
    expect(screen.getByText('El código "5134a-N" ya lo usa otra variante')).toBeInTheDocument()
  })

  it('solo lectura: ve la tabla sin botón ni campos y el interruptor deshabilitado (FR-003)', () => {
    render(<Envoltorio inicial={[NEGRO]} soloLectura />)
    expect(screen.getByText('Negro')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agregar variante' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Activa: Negro' })).toBeDisabled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('carga y error de lectura con reintento', () => {
    const onReintentar = vi.fn()
    const { rerender } = render(<BloqueVariantes filas={[]} onCambiar={vi.fn()} skuProducto="A" verStock editarStock cargando />)
    expect(screen.getByText('Cargando variantes…')).toBeInTheDocument()
    rerender(<BloqueVariantes filas={[]} onCambiar={vi.fn()} skuProducto="A" verStock editarStock hayError onReintentar={onReintentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las variantes.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar variantes' }))
    expect(onReintentar).toHaveBeenCalledTimes(1)
  })

  it('los controles se alcanzan con el teclado (botón, campo e interruptor nativos)', () => {
    render(<Envoltorio inicial={[NEGRO]} />)
    const agregar = screen.getByRole('button', { name: 'Agregar variante' })
    agregar.focus()
    expect(agregar).toHaveFocus()
    const codigo = screen.getByLabelText('Código de la variante 1')
    codigo.focus()
    expect(codigo).toHaveFocus()
    const activa = screen.getByRole('switch', { name: 'Activa: Negro' })
    activa.focus()
    expect(activa).toHaveFocus()
  })

  it('deshabilitado durante el guardado: no agrega ni edita', () => {
    render(<Envoltorio inicial={[NEGRO]} deshabilitado />)
    expect(screen.getByRole('button', { name: 'Agregar variante' })).toBeDisabled()
    expect(screen.getByLabelText('Nombre de la variante 1')).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Activa: Negro' })).toBeDisabled()
  })
})
