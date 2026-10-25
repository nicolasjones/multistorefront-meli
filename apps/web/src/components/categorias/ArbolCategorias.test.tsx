import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodoCategoria } from '../../lib/categorias'
import { ArbolCategorias } from './ArbolCategorias'

const nodo = (datos: Partial<NodoCategoria> & Pick<NodoCategoria, 'id' | 'nombre'>): NodoCategoria => ({
  padre_id: null,
  posicion: 0,
  empresa_ids: [],
  hijos: [],
  productos_directos: 0,
  productos: 0,
  ...datos,
})

const ARBOL: NodoCategoria[] = [
  nodo({
    id: 'joy',
    nombre: 'Joysticks',
    empresa_ids: ['e1', 'e2'],
    productos_directos: 1,
    productos: 6,
    hijos: [nodo({ id: 'cab', nombre: 'Cableados', padre_id: 'joy', empresa_ids: ['e2'], productos_directos: 5, productos: 5 })],
  }),
  nodo({ id: 'fun', nombre: 'Fundas', posicion: 1, empresa_ids: ['e1'], productos: 2 }),
]

const EMPRESAS = [
  { id: 'e1', nombre: 'San Javucho' },
  { id: 'e2', nombre: 'Mundo JC' },
]

const props = () => ({
  arbol: ARBOL,
  empresas: EMPRESAS,
  expandidos: new Set(['joy']),
  onAlternar: vi.fn(),
  puedeEditar: true,
  onAgregarSubcategoria: vi.fn(),
  onEditar: vi.fn(),
  onEliminar: vi.fn(),
  onMover: vi.fn(),
  onSoltar: vi.fn(),
})

describe('ArbolCategorias (F-CAT-08, FR-018/FR-019)', () => {
  it('muestra categoría, subcategorías, productos (con las subcategorías) y visibilidad por tienda', () => {
    render(<ArbolCategorias {...props()} />)
    expect(screen.getByText('Joysticks')).toBeInTheDocument()
    expect(screen.getByText('1 subcategoría')).toBeInTheDocument()
    expect(screen.getByText('Cableados')).toBeInTheDocument()
    expect(screen.getByText('Fundas')).toBeInTheDocument()
    for (const encabezado of ['Categoría', 'Productos', 'Visible en', 'Acciones']) {
      expect(screen.getByText(encabezado)).toBeInTheDocument()
    }
    const filaJoy = screen.getByText('Joysticks').closest('li') as HTMLElement
    expect(within(filaJoy).getByText('6')).toBeInTheDocument()
    expect(within(filaJoy).getByLabelText('San Javucho: se ve')).toBeInTheDocument()
    expect(within(filaJoy).getByLabelText('Mundo JC: se ve')).toBeInTheDocument()
    const filaCab = screen.getByText('Cableados').closest('li') as HTMLElement
    expect(within(filaCab).getByLabelText('San Javucho: no se ve')).toBeInTheDocument()
    expect(within(filaCab).getByLabelText('Mundo JC: se ve')).toBeInTheDocument()
  })

  it('oculta las subcategorías de una raíz contraída y avisa para expandirla', () => {
    const onAlternar = vi.fn()
    render(<ArbolCategorias {...props()} expandidos={new Set()} onAlternar={onAlternar} />)
    expect(screen.queryByText('Cableados')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Joysticks' }))
    expect(onAlternar).toHaveBeenCalledWith('joy')
  })

  it('sube y baja por teclado con acciones accesibles y deshabilitadas en los bordes', () => {
    const onMover = vi.fn()
    render(<ArbolCategorias {...props()} onMover={onMover} />)
    fireEvent.click(screen.getByRole('button', { name: 'Subir Fundas' }))
    expect(onMover).toHaveBeenCalledWith(expect.objectContaining({ id: 'fun' }), -1)
    expect(screen.getByRole('button', { name: 'Subir Joysticks' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar Fundas' })).toBeDisabled()
  })

  it('arrastrar una fila sobre otra dispara el movimiento sin depender del mouse', () => {
    const onSoltar = vi.fn()
    render(<ArbolCategorias {...props()} onSoltar={onSoltar} />)
    const origen = screen.getByText('Fundas').closest('li') as HTMLElement
    const destino = screen.getByText('Cableados').closest('li') as HTMLElement
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'fun') }
    fireEvent.dragStart(origen, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'fun')
    fireEvent.dragOver(destino, { dataTransfer })
    fireEvent.drop(destino, { dataTransfer })
    expect(onSoltar).toHaveBeenCalledWith('fun', 'cab')
  })

  it('ofrece agregar subcategoría solo en las raíces, y editar y eliminar en toda fila', () => {
    const onAgregar = vi.fn()
    const onEditar = vi.fn()
    const onEliminar = vi.fn()
    render(<ArbolCategorias {...props()} onAgregarSubcategoria={onAgregar} onEditar={onEditar} onEliminar={onEliminar} />)
    expect(screen.queryByRole('button', { name: 'Agregar subcategoría a Cableados' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar subcategoría a Joysticks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar Cableados' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Fundas' }))
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ id: 'joy' }))
    expect(onEditar).toHaveBeenCalledWith(expect.objectContaining({ id: 'cab' }))
    expect(onEliminar).toHaveBeenCalledWith(expect.objectContaining({ id: 'fun' }))
  })

  it('en solo lectura muestra el árbol sin acciones ni arrastre', () => {
    const { container } = render(<ArbolCategorias {...props()} puedeEditar={false} />)
    expect(screen.queryByRole('button', { name: 'Editar Joysticks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar Joysticks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar subcategoría a Joysticks' })).toBeNull()
    expect(screen.queryByText('Acciones')).toBeNull()
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0)
  })

  it('con el árbol vacío no inventa filas', () => {
    render(<ArbolCategorias {...props()} arbol={[]} />)
    expect(screen.queryByText('Joysticks')).toBeNull()
    expect(screen.getByRole('list', { name: 'Categorías' })).toBeEmptyDOMElement()
  })
})
