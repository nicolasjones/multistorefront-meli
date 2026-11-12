import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { CambiarEmpresasDialog } from './CambiarEmpresasDialog'
import { CambiarEstadoDialog } from './CambiarEstadoDialog'
import { MoverCategoriaDialog } from './MoverCategoriaDialog'

const base = () => ({ open: true, onCerrar: vi.fn(), onHecho: vi.fn() })
const categorias = [{ id: 'c-1', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: [] }]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.rpc.mockResolvedValue({ data: 2, error: null })
})

describe('MoverCategoriaDialog', () => {
  it('mueve los ids elegidos y avisa con la categoría', async () => {
    const p = base()
    render(<MoverCategoriaDialog {...p} ids={['a', 'b']} categorias={categorias} />)
    fireEvent.click(screen.getByRole('button', { name: 'Joysticks' }))
    await waitFor(() => expect(p.onHecho).toHaveBeenCalledWith('2 productos movidos a Joysticks'))
    expect(mocks.rpc).toHaveBeenCalledWith('mover_productos_categoria', { p_producto_ids: ['a', 'b'], p_categoria_id: 'c-1' })
  })

  it('con 0 cambios avisa «No hubo cambios»', async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null })
    const p = base()
    render(<MoverCategoriaDialog {...p} ids={['a']} categorias={categorias} />)
    fireEvent.click(screen.getByRole('button', { name: 'Joysticks' }))
    await waitFor(() => expect(p.onHecho).toHaveBeenCalledWith('No hubo cambios'))
  })

  it('producto de otra organización o inexistente (P0002): mensaje claro y no se cierra', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'x' } })
    const p = base()
    render(<MoverCategoriaDialog {...p} ids={['a']} categorias={categorias} />)
    fireEvent.click(screen.getByRole('button', { name: 'Joysticks' }))
    expect(await screen.findByText(/ya no existe/)).toBeInTheDocument()
    expect(p.onHecho).not.toHaveBeenCalled()
  })

  it('sin permiso (42501): mensaje claro', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'x' } })
    render(<MoverCategoriaDialog {...base()} ids={['a']} categorias={categorias} />)
    fireEvent.click(screen.getByRole('button', { name: 'Joysticks' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
  })
})

describe('CambiarEstadoDialog', () => {
  it('no confirma sin elegir un estado', () => {
    render(<CambiarEstadoDialog {...base()} ids={['a']} />)
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('desactiva los ids elegidos y avisa', async () => {
    const p = base()
    render(<CambiarEstadoDialog {...p} ids={['a', 'b']} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Desactivar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar 2 productos' }))
    await waitFor(() => expect(p.onHecho).toHaveBeenCalledWith('2 productos desactivados'))
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_productos', { p_producto_ids: ['a', 'b'], p_activo: false })
  })

  it('error de datos (22023): mensaje claro y la selección sigue intacta', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'x' } })
    const p = base()
    render(<CambiarEstadoDialog {...p} ids={['a']} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Activar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activar 1 producto' }))
    expect(await screen.findByText(/No se cambió ningún producto/)).toBeInTheDocument()
    expect(p.onHecho).not.toHaveBeenCalled()
  })
})

describe('CambiarEmpresasDialog', () => {
  it('no aplica sin elegir ninguna empresa', () => {
    render(<CambiarEmpresasDialog {...base()} ids={['a']} empresas={empresas} />)
    expect(screen.getByRole('button', { name: 'Aplicar a 1 producto' })).toBeDisabled()
  })

  it('una empresa en «Agregar a» y «Quitar de» bloquea el botón', () => {
    render(<CambiarEmpresasDialog {...base()} ids={['a']} empresas={empresas} />)
    const [agregar, quitar] = screen.getAllByRole('checkbox', { name: 'San Javucho' })
    fireEvent.click(agregar)
    fireEvent.click(quitar)
    expect(screen.getByText(/no puede estar a la vez/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar a 1 producto' })).toBeDisabled()
  })

  it('agrega y quita empresas con los ids elegidos', async () => {
    const p = base()
    render(<CambiarEmpresasDialog {...p} ids={['a', 'b']} empresas={empresas} />)
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'San Javucho' })[0])
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Mundo JC' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a 2 productos' }))
    await waitFor(() => expect(p.onHecho).toHaveBeenCalledWith('2 productos actualizados'))
    expect(mocks.rpc).toHaveBeenCalledWith('definir_empresas_productos', { p_producto_ids: ['a', 'b'], p_agregar: ['e-1'], p_quitar: ['e-2'] })
  })

  it('empresa ajena (22023): mensaje claro y no se cierra', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'x' } })
    const p = base()
    render(<CambiarEmpresasDialog {...p} ids={['a']} empresas={empresas} />)
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'San Javucho' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a 1 producto' }))
    expect(await screen.findByText(/no es válido/)).toBeInTheDocument()
    expect(p.onHecho).not.toHaveBeenCalled()
  })
})
