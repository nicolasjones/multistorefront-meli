import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodoCategoria } from '../../lib/categorias'
import { EliminarCategoriaDialogo } from './EliminarCategoriaDialogo'

const CATEGORIA: NodoCategoria = {
  id: 'joy',
  nombre: 'Joysticks',
  padre_id: null,
  posicion: 0,
  empresa_ids: ['e1'],
  hijos: [
    { id: 'cab', nombre: 'Cableados', padre_id: 'joy', posicion: 0, empresa_ids: [], hijos: [], productos_directos: 0, productos: 0 },
    { id: 'ina', nombre: 'Inalámbricos', padre_id: 'joy', posicion: 1, empresa_ids: [], hijos: [], productos_directos: 0, productos: 0 },
  ],
  productos_directos: 3,
  productos: 3,
}

describe('EliminarCategoriaDialogo (F-CAT-08, FR-021)', () => {
  it('usa el texto del prototipo con los productos y subcategorías afectados', () => {
    render(<EliminarCategoriaDialogo categoria={CATEGORIA} onCancelar={vi.fn()} onConfirmar={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Eliminar categoría' })).toBeInTheDocument()
    expect(
      screen.getByText('«Joysticks» tiene 3 productos y 2 subcategorías. Los productos quedan sin categoría y las subcategorías suben un nivel.'),
    ).toBeInTheDocument()
  })

  it('singulariza los conteos cuando hay uno solo', () => {
    const una: NodoCategoria = { ...CATEGORIA, productos_directos: 1, hijos: [CATEGORIA.hijos[0]] }
    render(<EliminarCategoriaDialogo categoria={una} onCancelar={vi.fn()} onConfirmar={vi.fn()} />)
    expect(
      screen.getByText('«Joysticks» tiene 1 producto y 1 subcategoría. Los productos quedan sin categoría y las subcategorías suben un nivel.'),
    ).toBeInTheDocument()
  })

  it('confirma la eliminación atómica y deshabilita el botón mientras trabaja', async () => {
    let resolver: () => void = () => undefined
    const onConfirmar = vi.fn(() => new Promise<void>((resolve) => { resolver = resolve }))
    render(<EliminarCategoriaDialogo categoria={CATEGORIA} onCancelar={vi.fn()} onConfirmar={onConfirmar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminando…' })).toBeDisabled())
    expect(onConfirmar).toHaveBeenCalledTimes(1)
    resolver()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar' })).not.toBeDisabled())
  })

  it('si el servidor rechaza (choque de nombres) muestra el error y deja reintentar', async () => {
    const onConfirmar = vi.fn().mockRejectedValue({
      code: '23505',
      message: 'No se puede eliminar: una subcategoría tiene el mismo nombre que otra categoría raíz. Renombrala primero.',
    })
    render(<EliminarCategoriaDialogo categoria={CATEGORIA} onCancelar={vi.fn()} onConfirmar={onConfirmar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Renombrala primero')
    expect(screen.getByRole('dialog', { name: 'Eliminar categoría' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar' })).not.toBeDisabled()
  })

  it('cancelar cierra sin llamar a confirmar', () => {
    const onCancelar = vi.fn()
    const onConfirmar = vi.fn()
    render(<EliminarCategoriaDialogo categoria={CATEGORIA} onCancelar={onCancelar} onConfirmar={onConfirmar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancelar).toHaveBeenCalled()
    expect(onConfirmar).not.toHaveBeenCalled()
  })
})
