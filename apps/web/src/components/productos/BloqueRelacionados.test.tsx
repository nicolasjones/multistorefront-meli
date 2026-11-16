import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Relacionado } from '../../lib/productos-relacionados'

const mocks = vi.hoisted(() => ({ buscar: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/productos-relacionados', async (original) => ({
  ...(await original<typeof import('../../lib/productos-relacionados')>()),
  buscarRelacionables: mocks.buscar,
}))

import { BloqueRelacionados } from './BloqueRelacionados'

const A: Relacionado = { id: 'a', nombre: 'Vidrio templado', sku: 'VID-1', categoria: 'Accesorios', precio: 10, moneda: 'USD' }
const B: Relacionado = { id: 'b', nombre: 'Funda', sku: 'FUN-1', categoria: 'Accesorios', precio: 15, moneda: 'USD' }
const C: Relacionado = { id: 'c', nombre: 'Cable', sku: 'CAB-1', categoria: null, precio: 5, moneda: 'USD' }

// Mantiene el estado como lo hace el formulario y expone el último valor.
function Envoltorio({ inicial = [], onCambio, ...resto }: { inicial?: Relacionado[]; onCambio?: (lista: Relacionado[]) => void } & Partial<React.ComponentProps<typeof BloqueRelacionados>>) {
  const [lista, setLista] = useState<Relacionado[]>(inicial)
  return <BloqueRelacionados productoId="yo" seleccion={lista} onCambiar={(siguiente) => { setLista(siguiente); onCambio?.(siguiente) }} {...resto} />
}

describe('BloqueRelacionados', () => {
  beforeEach(() => {
    mocks.buscar.mockReset()
  })

  it('vacío: título, subtítulo, contador «0 productos» y el texto del estado vacío', () => {
    render(<Envoltorio />)
    expect(screen.getByRole('heading', { name: 'Productos relacionados' })).toBeInTheDocument()
    expect(screen.getByText(/Se muestran como «Productos relacionados» en la ficha pública de las tiendas/)).toBeInTheDocument()
    expect(screen.getByText('0 productos')).toBeInTheDocument()
    expect(screen.getByText('En este producto (el orden es el que ve el cliente)')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay productos relacionados. Buscá arriba y agregá accesorios o alternativas.')).toBeInTheDocument()
  })

  it('busca, agrega al final, limpia la búsqueda y avisa', async () => {
    mocks.buscar.mockResolvedValue([A])
    render(<Envoltorio inicial={[B]} />)
    const buscador = screen.getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' })
    fireEvent.change(buscador, { target: { value: 'vidrio' } })
    expect(await screen.findByText('VID-1 · Accesorios · USD 10,00')).toBeInTheDocument()
    expect(mocks.buscar).toHaveBeenLastCalledWith(expect.anything(), 'vidrio', ['yo', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Vidrio templado' }))
    expect(buscador).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Agregado a relacionados: Vidrio templado')
    expect(screen.getByText('2 productos')).toBeInTheDocument()
    const filas = within(screen.getByRole('list', { name: '' })).getAllByRole('listitem')
    expect(filas.map((fila) => fila.textContent)).toEqual([expect.stringContaining('Funda'), expect.stringContaining('Vidrio templado')])
  })

  it('sin resultados muestra el mensaje del prototipo', async () => {
    mocks.buscar.mockResolvedValue([])
    render(<Envoltorio />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), { target: { value: 'zzz' } })
    expect(await screen.findByText('Sin resultados. Probá con otro nombre, SKU o categoría.')).toBeInTheDocument()
  })

  it('si la búsqueda falla lo avisa sin romper el bloque', async () => {
    const silenciar = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.buscar.mockRejectedValue(new Error('boom'))
    render(<Envoltorio />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), { target: { value: 'a' } })
    expect(await screen.findByText('No pudimos buscar productos. Probá de nuevo.')).toBeInTheDocument()
    silenciar.mockRestore()
  })

  it('reordena con ↑ ↓, atenúa los extremos y devuelve el orden mostrado', () => {
    const onCambio = vi.fn()
    render(<Envoltorio inicial={[A, B, C]} onCambio={onCambio} />)
    expect(screen.getByRole('button', { name: 'Subir Vidrio templado' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Bajar Cable' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Subir Funda' })).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Subir Vidrio templado' }))
    expect(onCambio).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Subir Cable' }))
    expect(onCambio).toHaveBeenLastCalledWith([A, C, B])
    fireEvent.click(screen.getByRole('button', { name: 'Bajar Vidrio templado' }))
    expect(onCambio).toHaveBeenLastCalledWith([C, A, B])
  })

  it('quita con ✕ y avisa; el contador usa el singular', () => {
    render(<Envoltorio inicial={[A, B]} />)
    expect(screen.getByText('2 productos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Funda' }))
    expect(screen.getByRole('status')).toHaveTextContent('Quitado de relacionados')
    expect(screen.getByText('1 producto')).toBeInTheDocument()
    expect(screen.queryByText('Funda')).not.toBeInTheDocument()
  })

  it('los controles se alcanzan con el teclado (botones nativos)', () => {
    render(<Envoltorio inicial={[A]} />)
    const quitar = screen.getByRole('button', { name: 'Quitar Vidrio templado' })
    quitar.focus()
    expect(quitar).toHaveFocus()
    expect(quitar.tagName).toBe('BUTTON')
  })

  it('solo lectura: ve la lista sin buscador ni controles', () => {
    render(<Envoltorio inicial={[A]} soloLectura />)
    expect(screen.getByText('Vidrio templado')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('cambiar de empresa en la barra no altera el bloque: no depende de la empresa activa', async () => {
    // Declaración «no aplica» de la matriz: el bloque no lee la empresa activa ni la envía a la búsqueda.
    mocks.buscar.mockResolvedValue([])
    render(<Envoltorio inicial={[A]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar por nombre, SKU o categoría' }), { target: { value: 'x' } })
    await waitFor(() => expect(mocks.buscar).toHaveBeenCalled())
    expect(mocks.buscar.mock.calls[0]).toHaveLength(3)
    expect(screen.getByText('Vidrio templado')).toBeInTheDocument()
  })

  it('carga y error de lectura con reintento', () => {
    const onReintentar = vi.fn()
    const { rerender } = render(<BloqueRelacionados productoId="yo" seleccion={[]} onCambiar={vi.fn()} cargando />)
    expect(screen.getByText('Cargando productos relacionados…')).toBeInTheDocument()
    rerender(<BloqueRelacionados productoId="yo" seleccion={[]} onCambiar={vi.fn()} hayError onReintentar={onReintentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar los productos relacionados.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar relacionados' }))
    expect(onReintentar).toHaveBeenCalledTimes(1)
  })
})
