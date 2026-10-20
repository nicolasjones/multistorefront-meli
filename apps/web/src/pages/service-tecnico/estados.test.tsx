import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarEstados: vi.fn(),
  crearEstado: vi.fn(),
  cambiarAvisaCliente: vi.fn(),
  cambiarActivoEstado: vi.fn(),
  moverEstado: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/serviceTecnico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/serviceTecnico')>()),
  listarEstados: mocks.listarEstados,
  crearEstado: mocks.crearEstado,
  cambiarAvisaCliente: mocks.cambiarAvisaCliente,
  cambiarActivoEstado: mocks.cambiarActivoEstado,
  moverEstado: mocks.moverEstado,
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ServicioEstados } from './estados'

const ESTADOS = [
  { id: 'e-1', nombre: 'Recibido', descripcion: 'El equipo ingresó.', orden: 1, avisa_cliente: true, cierra: false, tono: 'neutral', activo: true, updated_at: 't1' },
  { id: 'e-2', nombre: 'En reparación', descripcion: 'Se trabaja.', orden: 2, avisa_cliente: false, cierra: false, tono: 'primario', activo: true, updated_at: 't2' },
  { id: 'e-3', nombre: 'Entregado', descripcion: 'Se registra la entrega.', orden: 3, avisa_cliente: false, cierra: true, tono: 'exito', activo: true, updated_at: 't3' },
]

const abrir = () => render(<MemoryRouter><ServicioEstados /></MemoryRouter>)

describe('Service técnico · Estados de reparación', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.listarEstados.mockResolvedValue(ESTADOS)
    mocks.crearEstado.mockResolvedValue(undefined)
    mocks.cambiarAvisaCliente.mockResolvedValue(undefined)
    mocks.cambiarActivoEstado.mockResolvedValue(undefined)
    mocks.moverEstado.mockResolvedValue(undefined)
  })

  it('muestra la tabla con orden, estado, qué significa, avisa y cierra (solo lectura)', async () => {
    abrir()
    expect(screen.getByRole('tab', { name: 'Estados de reparación' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('El equipo ingresó.')).toBeInTheDocument()
    expect(screen.getByText('Entregado')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Avisa al cliente: Recibido' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Avisa al cliente: En reparación' })).not.toBeChecked()
    expect(screen.getByText('Sí')).toBeInTheDocument()
    expect(screen.getByText(/Los estados valen para toda la organización/)).toBeInTheDocument()
  })

  it('deshabilita Subir en el primero y Bajar en el último, y reordena con el resto', async () => {
    abrir()
    await screen.findByText('El equipo ingresó.')
    expect(screen.getByRole('button', { name: 'Subir Recibido' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Bajar Entregado' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Subir En reparación' }))
    await waitFor(() => expect(mocks.moverEstado).toHaveBeenCalledWith('e-2', 'subir'))
    await waitFor(() => expect(mocks.listarEstados).toHaveBeenCalledTimes(2))
  })

  it('activa y desactiva un estado desde el switch «Activo»', async () => {
    abrir()
    await screen.findByText('El equipo ingresó.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activo: En reparación' }))
    await waitFor(() => expect(mocks.cambiarActivoEstado).toHaveBeenCalledWith('e-2', false))
  })

  it('guarda el cambio de «Avisa al cliente» y muestra el error si la base lo rechaza', async () => {
    abrir()
    await screen.findByText('El equipo ingresó.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Avisa al cliente: En reparación' }))
    await waitFor(() => expect(mocks.cambiarAvisaCliente).toHaveBeenCalledWith(expect.objectContaining({ id: 'e-2' }), true))

    mocks.cambiarAvisaCliente.mockRejectedValueOnce({ code: '40001' })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Avisa al cliente: Recibido' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Avisa al cliente: Recibido' }))
    expect(await screen.findByText(/Otra persona modificó este registro/)).toBeInTheDocument()
  })

  it('valida «Nuevo estado» y lo crea con el aviso al cliente elegido', async () => {
    abrir()
    await screen.findByText('El equipo ingresó.')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo estado' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear estado' }))
    expect(await within(dialogo).findByText('Ingresá el nombre del estado.')).toBeInTheDocument()
    expect(mocks.crearEstado).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Presupuesto aprobado' } })
    fireEvent.change(within(dialogo).getByLabelText(/Qué significa/), { target: { value: 'El cliente aceptó el presupuesto' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Avisar al cliente al pasar a este estado' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear estado' }))
    await waitFor(() =>
      expect(mocks.crearEstado).toHaveBeenCalledWith({ nombre: 'Presupuesto aprobado', descripcion: 'El cliente aceptó el presupuesto', avisa_cliente: true }),
    )
    expect(await screen.findByText('Estado creado')).toBeInTheDocument()
  })

  it('muestra en el campo Nombre que el estado ya existe', async () => {
    mocks.crearEstado.mockRejectedValueOnce({ code: '23505', message: 'estados_reparacion_org_nombre_key' })
    abrir()
    await screen.findByText('El equipo ingresó.')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo estado' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Recibido' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear estado' }))
    expect(await within(dialogo).findByText(/Ya existe un estado con ese nombre/)).toBeInTheDocument()
  })

  it('muestra vacío y error con reintento', async () => {
    mocks.listarEstados.mockResolvedValueOnce([])
    const { unmount } = abrir()
    expect(await screen.findByText('Todavía no hay estados.')).toBeInTheDocument()
    unmount()

    mocks.listarEstados.mockRejectedValueOnce(new Error('falla'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los estados.')).toBeInTheDocument()
  })

  it('con solo lectura oculta «Nuevo estado», Subir/Bajar y deshabilita los switches', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('El equipo ingresó.')
    expect(screen.queryByRole('button', { name: 'Nuevo estado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Subir/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Avisa al cliente: Recibido' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Activo: Recibido' })).toBeDisabled()
  })
})
