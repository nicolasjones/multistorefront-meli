import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resultado: vi.fn(),
  schema: vi.fn(),
  usePuedeEscribir: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
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
    mocks.rpc.mockReset()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
  })

  it('ofrece editar cada empresa hacia su pantalla General (F-EMP-02)', async () => {
    mocks.resultado.mockResolvedValue({ data: [empresa(1, 'San Javucho')], error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(await screen.findByText('San Javucho')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /editar/i })).toHaveAttribute('href', '/empresas/edit/e-1')
  })

  it.each([
    [1, ['San Javucho']],
    [2, ['San Javucho', 'Mundo JC']],
    [3, ['San Javucho', 'Mundo JC', 'Tercera']],
  ])('lista las %i empresas de la organización, sin límite fijo de dos', async (_cantidad, nombres) => {
    mocks.resultado.mockResolvedValue({ data: nombres.map((nombre, i) => empresa(i, nombre)), error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    for (const nombre of nombres) {
      expect(await screen.findByText(nombre)).toBeInTheDocument()
    }
    expect(mocks.schema).toHaveBeenCalledWith('dominio')
    expect(screen.queryByText(/e-\d/)).not.toBeInTheDocument()
  })

  it('muestra «Sin configurar» donde no hay origen de datos y la moneda ARS', async () => {
    mocks.resultado.mockResolvedValue({ data: [empresa(1, 'Mundo JC')], error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    await screen.findByText('Mundo JC')
    // Tienda web, Mercado Libre, precio y productos visibles.
    expect(screen.getAllByText('Sin configurar')).toHaveLength(4)
    expect(screen.getByText('ARS')).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras consulta', () => {
    mocks.resultado.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando la organización no tiene empresas', async () => {
    mocks.resultado.mockResolvedValue({ data: [], error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(await screen.findByText('Todavía no hay empresas cargadas.')).toBeInTheDocument()
  })

  it('muestra el error con reintento y vuelve a consultar', async () => {
    mocks.resultado.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    mocks.resultado.mockResolvedValueOnce({ data: [empresa(1, 'Mundo JC')], error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(await screen.findByText('No pudimos cargar las empresas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Mundo JC')).toBeInTheDocument()
    expect(mocks.resultado).toHaveBeenCalledTimes(2)
  })

  it('muestra acceso restringido y no consulta datos a un miembro', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toBeInTheDocument()
    expect(screen.getByText('Tu rol (actual) no incluye Empresas. Pedile acceso a un administrador.')).toBeInTheDocument()
    // El aviso no es un error rojo: se fue el «Acceso restringido» de otra pantalla (MSF-639).
    expect(screen.queryByText('Acceso restringido')).not.toBeInTheDocument()
    expect(document.querySelector('.MuiAlert-standardError')).toBeNull()
    await waitFor(() => expect(mocks.resultado).not.toHaveBeenCalled())
  })

  it('no consulta datos mientras todavía verifica el permiso', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: null, isLoading: true })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(mocks.resultado).not.toHaveBeenCalled()
  })

  it('no muestra el estado vacío al resolverse el permiso (null → true)', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: null, isLoading: true })
    mocks.resultado.mockResolvedValue({ data: [empresa(1, 'San Javucho'), empresa(2, 'Mundo JC')], error: null })
    const { rerender } = render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    rerender(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(screen.queryByText('Todavía no hay empresas cargadas.')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(await screen.findByText('Mundo JC')).toBeInTheDocument()
  })
  it('muestra la etiqueta de estado de cada empresa: activa o pausada (F-EMP-04)', async () => {
    mocks.resultado.mockResolvedValue({
      data: [empresa(1, 'San Javucho'), { ...empresa(2, 'Mundo JC'), activa: false }],
      error: null,
    })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    await screen.findByText('Mundo JC')
    expect(screen.getAllByText('Activa')).toHaveLength(1)
    expect(screen.getAllByText('Pausada')).toHaveLength(1)
  })

  it('ofrece «Nueva empresa» y la fila «Crear» a quien puede escribir (F-EMP-03)', async () => {
    mocks.resultado.mockResolvedValue({ data: [empresa(1, 'San Javucho')], error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    await screen.findByText('San Javucho')
    expect(screen.getByRole('button', { name: 'Nueva empresa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear nueva empresa' })).toBeInTheDocument()
  })

  it('un miembro no ve «Nueva empresa» ni «Crear»', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: 'Nueva empresa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear nueva empresa' })).not.toBeInTheDocument()
  })

  it('crea una empresa copiando de otra, confirma «borrador» y la nueva aparece en el listado', async () => {
    mocks.resultado
      .mockResolvedValueOnce({ data: [empresa(1, 'San Javucho'), empresa(2, 'Mundo JC')], error: null })
      .mockResolvedValueOnce({ data: [empresa(1, 'San Javucho'), empresa(2, 'Mundo JC'), empresa(3, 'Tienda Oeste')], error: null })
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
    render(<MemoryRouter><EmpresaList /></MemoryRouter>)

    await screen.findByText('Mundo JC')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva empresa' }))
    fireEvent.change(await screen.findByLabelText(/Nombre/), { target: { value: 'Tienda Oeste' } })
    fireEvent.change(screen.getByLabelText('Copiar configuración de'), { target: { value: 'e-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }))

    expect(await screen.findByText('Empresa creada como borrador')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('crear_empresa', { p_nombre: 'Tienda Oeste', p_copiar_de: 'e-2' })
    expect(await screen.findByText('Tienda Oeste')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
