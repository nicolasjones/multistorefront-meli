import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  insertar: vi.fn(),
  actualizar: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: () => ({
        select: () => ({ order: () => ({ returns: mocks.listar }) }),
        insert: mocks.insertar,
        update: (valores: unknown) => ({ eq: (columna: string, id: string) => mocks.actualizar(valores, columna, id) }),
      }),
    }),
  },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Sin acceso a {seccion}</p>,
}))

import { MotivosMovimiento } from './motivos'

const MOTIVOS = [
  { id: 'm-1', nombre: 'Compra a proveedor', aplica_a: ['entrada'], activo: true },
  { id: 'm-2', nombre: 'Vieja', aplica_a: ['salida', 'ajuste'], activo: false },
]

const abrir = () => render(<MemoryRouter><MotivosMovimiento /></MemoryRouter>)

describe('MotivosMovimiento', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.listar.mockResolvedValue({ data: MOTIVOS, error: null })
    mocks.insertar.mockResolvedValue({ error: null })
    mocks.actualizar.mockResolvedValue({ error: null })
  })

  it('lista los motivos con sus tipos y su estado', async () => {
    abrir()
    expect(await screen.findByText('Compra a proveedor')).toBeInTheDocument()
    expect(screen.getByText('Entrada')).toBeInTheDocument()
    expect(screen.getByText('Salida, Ajuste')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Inactivo')).toBeInTheDocument()
  })

  it('da de alta un motivo en la organización con el nombre recortado y los tipos elegidos', async () => {
    abrir()
    await screen.findByText('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo motivo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: '  Muestra  ' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Ajuste' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.insertar).toHaveBeenCalledWith({ organizacion_id: 'org-1', nombre: 'Muestra', aplica_a: ['entrada', 'salida'] }))
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledTimes(2))
  })

  it('renombra un motivo y cambia los tipos a los que aplica', async () => {
    abrir()
    await screen.findByText('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Compra a proveedor' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Compra' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Salida' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledWith({ nombre: 'Compra', aplica_a: ['entrada', 'salida'] }, 'id', 'm-1'))
  })

  it('desactiva y activa un motivo sin borrarlo', async () => {
    abrir()
    await screen.findByText('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Compra a proveedor' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledWith({ activo: false }, 'id', 'm-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Activar Vieja' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledWith({ activo: true }, 'id', 'm-2'))
  })

  it('un nombre duplicado se rechaza con un mensaje claro y el diálogo sigue abierto', async () => {
    mocks.insertar.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint "motivos_movimiento_nombre_uq"' } })
    abrir()
    await screen.findByText('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo motivo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'compra a proveedor' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Ya existe un motivo con ese nombre.')).toBeInTheDocument()
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument()
  })

  it('valida el nombre vacío y la falta de tipos antes de guardar', async () => {
    abrir()
    await screen.findByText('Compra a proveedor')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo motivo' }))
    const dialogo = await screen.findByRole('dialog')
    for (const tipo of ['Entrada', 'Salida', 'Ajuste']) fireEvent.click(within(dialogo).getByRole('checkbox', { name: tipo }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Ingresá el nombre del motivo.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Elegí al menos un tipo de movimiento.')).toBeInTheDocument()
    expect(mocks.insertar).not.toHaveBeenCalled()
  })

  it('quien no es Administrador no ve la pantalla ni carga ningún dato', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(await screen.findByText('Sin acceso a Motivos de movimiento')).toBeInTheDocument()
    expect(mocks.listar).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Nuevo motivo' })).not.toBeInTheDocument()
  })

  it('un error de carga se avisa y permite reintentar', async () => {
    mocks.listar.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los motivos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Compra a proveedor')).toBeInTheDocument()
  })
})
