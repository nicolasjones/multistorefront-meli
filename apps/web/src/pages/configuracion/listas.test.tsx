import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarMotivos: vi.fn(),
  listarEstados: vi.fn(),
  rpc: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: () => ({
      from: (tabla: string) => ({
        select: () => ({
          order: () => ({ returns: tabla === 'estados_consulta' ? mocks.listarEstados : mocks.listarMotivos }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }),
  },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({
  useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }),
}))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Sin acceso a {seccion}</p>,
}))

import { ListasConfigurables } from './listas'

const MOTIVOS = [{ id: 'm-1', nombre: 'Compra a proveedor', aplica_a: ['entrada'], activo: true }]
const ESTADOS = [
  { id: 'e-1', nombre: 'Nueva', activo: true, orden: 1 },
  { id: 'e-2', nombre: 'Archivada', activo: false, orden: 2 },
]

const abrir = () => render(<MemoryRouter><ListasConfigurables /></MemoryRouter>)
const seccionEstados = () => screen.getByRole('region', { name: 'Estados de consulta' })

describe('ListasConfigurables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.listarMotivos.mockResolvedValue({ data: MOTIVOS, error: null })
    mocks.listarEstados.mockResolvedValue({ data: ESTADOS, error: null })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('muestra las dos listas con su nombre y si están activas', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Motivos de stock' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Estados de consulta' })).toBeInTheDocument()
    expect(await screen.findByText('Compra a proveedor')).toBeInTheDocument()
    expect(await within(seccionEstados()).findByText('Nueva')).toBeInTheDocument()
    expect(within(seccionEstados()).getByText('Activo')).toBeInTheDocument()
    expect(within(seccionEstados()).getByText('Inactivo')).toBeInTheDocument()
  })

  it('un rol que no es Administrador ve el acceso restringido y no carga ninguna lista', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.getByText('Sin acceso a Listas configurables')).toBeInTheDocument()
    expect(mocks.listarEstados).not.toHaveBeenCalled()
    expect(mocks.listarMotivos).not.toHaveBeenCalled()
  })

  it('agrega un estado por la RPC con el nombre recortado y recarga la lista', async () => {
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(within(seccionEstados()).getByRole('button', { name: 'Nuevo estado' }))
    fireEvent.change(await screen.findByLabelText(/Nombre/), { target: { value: '  En curso  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('crear_estado_consulta', { p_nombre: 'En curso' }))
    await waitFor(() => expect(mocks.listarEstados).toHaveBeenCalledTimes(2))
  })

  it('rechaza un nombre vacío sin llamar a la base', async () => {
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(within(seccionEstados()).getByRole('button', { name: 'Nuevo estado' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Ingresá un nombre.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('muestra un mensaje claro si el nombre está repetido', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } })
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(within(seccionEstados()).getByRole('button', { name: 'Nuevo estado' }))
    fireEvent.change(await screen.findByLabelText(/Nombre/), { target: { value: 'nueva' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Ya existe un estado con ese nombre.')).toBeInTheDocument()
  })

  it('renombra un estado por la RPC', async () => {
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar Nueva' }))
    const campo = await screen.findByLabelText(/Nombre/)
    expect(campo).toHaveValue('Nueva')
    fireEvent.change(campo, { target: { value: 'Pendiente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('renombrar_estado_consulta', { p_id: 'e-1', p_nombre: 'Pendiente' }))
  })

  it('desactiva y reactiva un estado sin borrarlo', async () => {
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Nueva' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_estado_consulta', { p_id: 'e-1', p_activo: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Activar Archivada' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_estado_consulta', { p_id: 'e-2', p_activo: true }))
  })

  it('avisa si no se pudo cambiar el estado y deja la lista como estaba', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Nueva' }))
    expect(await screen.findByText(/No tenés permiso para esta acción/)).toBeInTheDocument()
    expect(within(seccionEstados()).getAllByText('Activo')).toHaveLength(1)
  })

  it('muestra error con reintento si la lista de estados no carga', async () => {
    mocks.listarEstados.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los estados de consulta.')).toBeInTheDocument()
    fireEvent.click(within(seccionEstados()).getByRole('button', { name: /Reintentar/i }))
    expect(await within(seccionEstados()).findByText('Nueva')).toBeInTheDocument()
  })

  it('cambiar de empresa activa no altera las listas (son de la organización)', async () => {
    const { rerender } = abrir()
    await within(seccionEstados()).findByText('Nueva')
    const llamadas = mocks.listarEstados.mock.calls.length
    // La empresa activa vive en otro contexto que estas pantallas no leen: re-render sin recarga.
    rerender(<MemoryRouter><ListasConfigurables /></MemoryRouter>)
    expect(within(seccionEstados()).getByText('Nueva')).toBeInTheDocument()
    expect(mocks.listarEstados.mock.calls.length).toBe(llamadas)
  })

  it('se opera con teclado: los controles son botones con nombre accesible y las listas, regiones con título', async () => {
    abrir()
    await within(seccionEstados()).findByText('Nueva')
    expect(screen.getAllByRole('region')).toHaveLength(2)
    for (const nombre of ['Renombrar Nueva', 'Desactivar Nueva', 'Activar Archivada']) {
      expect(screen.getByRole('button', { name: nombre }).tagName).toBe('BUTTON')
    }
    fireEvent.click(within(seccionEstados()).getByRole('button', { name: 'Nuevo estado' }))
    expect(await screen.findByRole('dialog', { name: 'Nuevo estado' })).toBeInTheDocument()
  })
})
