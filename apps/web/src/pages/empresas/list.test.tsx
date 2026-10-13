import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resultado: vi.fn(),
  schema: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('@refinedev/mui', () => ({ EditButton: () => <button type="button">Editar</button> }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: mocks.schema.mockImplementation(() => ({
      from: () => ({ select: () => ({ order: () => ({ returns: mocks.resultado }) }) }),
    })),
  },
}))

import { EmpresaList } from './list'

const empresa = (n: number, nombre: string) => ({ id: `e-${n}`, nombre, activa: true })

describe('EmpresaList', () => {
  beforeEach(() => {
    mocks.resultado.mockReset()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
  })

  it.each([
    [1, ['San Javucho']],
    [2, ['San Javucho', 'Mundo JC']],
    [3, ['San Javucho', 'Mundo JC', 'Tercera']],
  ])('lista las %i empresas de la organización, sin límite fijo de dos', async (_cantidad, nombres) => {
    mocks.resultado.mockResolvedValue({ data: nombres.map((nombre, i) => empresa(i, nombre)), error: null })
    render(<EmpresaList />)

    for (const nombre of nombres) {
      expect(await screen.findByText(nombre)).toBeInTheDocument()
    }
    expect(mocks.schema).toHaveBeenCalledWith('dominio')
    expect(screen.queryByText(/e-\d/)).not.toBeInTheDocument()
  })

  it('muestra «Sin configurar» donde no hay origen de datos y la moneda ARS', async () => {
    mocks.resultado.mockResolvedValue({ data: [empresa(1, 'Mundo JC')], error: null })
    render(<EmpresaList />)

    await screen.findByText('Mundo JC')
    // Tienda web, Mercado Libre, precio y productos visibles.
    expect(screen.getAllByText('Sin configurar')).toHaveLength(4)
    expect(screen.getByText('ARS')).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras consulta', () => {
    mocks.resultado.mockReturnValue(new Promise(() => {}))
    render(<EmpresaList />)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando la organización no tiene empresas', async () => {
    mocks.resultado.mockResolvedValue({ data: [], error: null })
    render(<EmpresaList />)

    expect(await screen.findByText('Todavía no hay empresas cargadas.')).toBeInTheDocument()
  })

  it('muestra el error con reintento y vuelve a consultar', async () => {
    mocks.resultado.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    mocks.resultado.mockResolvedValueOnce({ data: [empresa(1, 'Mundo JC')], error: null })
    render(<EmpresaList />)

    expect(await screen.findByText('No pudimos cargar las empresas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Mundo JC')).toBeInTheDocument()
    expect(mocks.resultado).toHaveBeenCalledTimes(2)
  })

  it('muestra acceso restringido y no consulta datos a un miembro', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<EmpresaList />)

    expect(screen.getByText('Acceso restringido')).toBeInTheDocument()
    await waitFor(() => expect(mocks.resultado).not.toHaveBeenCalled())
  })

  it('no consulta datos mientras todavía verifica el permiso', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: null, isLoading: true })
    render(<EmpresaList />)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(mocks.resultado).not.toHaveBeenCalled()
  })
})
