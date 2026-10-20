import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listarModelos: vi.fn(),
  crearModelo: vi.fn(),
  actualizarModelo: vi.fn(),
  cambiarActivoModelo: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../lib/serviceTecnico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/serviceTecnico')>()),
  listarModelos: mocks.listarModelos,
  crearModelo: mocks.crearModelo,
  actualizarModelo: mocks.actualizarModelo,
  cambiarActivoModelo: mocks.cambiarActivoModelo,
}))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ServicioModelos } from './modelos'

const MODELOS = [
  { id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite', mano_obra_base: 20000, activo: true, updated_at: 't1' },
  { id: 'm-2', equipo: 'PlayStation 4', modelo: 'Slim', mano_obra_base: 26000, activo: false, updated_at: 't2' },
]

const abrir = () => render(<MemoryRouter><ServicioModelos /></MemoryRouter>)

describe('Service técnico · Modelos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.listarModelos.mockResolvedValue(MODELOS)
    mocks.crearModelo.mockResolvedValue(undefined)
    mocks.actualizarModelo.mockResolvedValue(undefined)
    mocks.cambiarActivoModelo.mockResolvedValue(undefined)
  })

  it('muestra título, subtítulo, pestañas y la tabla con equipo, modelo, mano de obra y activo', async () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Modelos' })).toBeInTheDocument()
    expect(screen.getByText('Consolas y equipos que se reparan, con su mano de obra base.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Modelos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Estados de reparación' })).toBeInTheDocument()
    expect(await screen.findByText('Lite')).toBeInTheDocument()
    expect(screen.getByText('Nintendo Switch')).toBeInTheDocument()
    expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: 'Activo: Nintendo Switch Lite' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Activo: PlayStation 4 Slim' })).not.toBeChecked()
  })

  it('muestra carga, vacío y error con reintento', async () => {
    mocks.listarModelos.mockResolvedValueOnce([])
    const { unmount } = abrir()
    expect(await screen.findByText('Todavía no hay modelos.')).toBeInTheDocument()
    unmount()

    mocks.listarModelos.mockRejectedValueOnce(new Error('falla'))
    abrir()
    expect(await screen.findByText('No pudimos cargar los modelos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Lite')).toBeInTheDocument()
  })

  it('valida el diálogo «Nuevo modelo» con errores por campo y no envía', async () => {
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo modelo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Mano de obra base/), { target: { value: '-5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear modelo' }))
    expect(await within(dialogo).findByText('Ingresá el equipo.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá el modelo.')).toBeInTheDocument()
    expect(within(dialogo).getByText(/importe de cero o más/)).toBeInTheDocument()
    expect(mocks.crearModelo).not.toHaveBeenCalled()
  })

  it('crea un modelo, cierra el diálogo, avisa «Modelo creado» y recarga', async () => {
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo modelo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Equipo/), { target: { value: 'Nintendo Switch' } })
    fireEvent.change(within(dialogo).getByLabelText(/^Modelo/), { target: { value: 'Switch 2' } })
    fireEvent.change(within(dialogo).getByLabelText(/Mano de obra base/), { target: { value: '25000' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear modelo' }))
    await waitFor(() => expect(mocks.crearModelo).toHaveBeenCalledWith({ equipo: 'Nintendo Switch', modelo: 'Switch 2', mano_obra_base: '25000' }))
    expect(await screen.findByText('Modelo creado')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listarModelos).toHaveBeenCalledTimes(2))
  })

  it('edita un modelo con el formulario precargado y avisa «Modelo guardado»', async () => {
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Nintendo Switch Lite' }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByLabelText(/^Modelo/)).toHaveValue('Lite')
    fireEvent.change(within(dialogo).getByLabelText(/^Modelo/), { target: { value: 'Lite 2' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.actualizarModelo).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-1' }), expect.objectContaining({ modelo: 'Lite 2' })),
    )
    expect(mocks.crearModelo).not.toHaveBeenCalled()
    expect(await screen.findByText('Modelo guardado')).toBeInTheDocument()
  })

  it('al editar, un conflicto de bloqueo optimista se muestra en el diálogo', async () => {
    mocks.actualizarModelo.mockRejectedValueOnce({ code: '40001' })
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Nintendo Switch Lite' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))
    expect(await within(dialogo).findByText(/Otra persona modificó este registro/)).toBeInTheDocument()
  })

  it('muestra en el campo Modelo que el par equipo + modelo ya existe', async () => {
    mocks.crearModelo.mockRejectedValueOnce({ code: '23505', message: 'modelos_equipo_org_equipo_modelo_key' })
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo modelo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Equipo/), { target: { value: 'Nintendo Switch' } })
    fireEvent.change(within(dialogo).getByLabelText(/^Modelo/), { target: { value: 'Lite' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear modelo' }))
    expect(await within(dialogo).findByText(/Ya existe ese modelo/)).toBeInTheDocument()
  })

  it('activa y desactiva con el switch; si falla muestra el error y recarga', async () => {
    abrir()
    await screen.findByText('Lite')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activo: Nintendo Switch Lite' }))
    await waitFor(() => expect(mocks.cambiarActivoModelo).toHaveBeenCalledWith('m-1', false))

    mocks.cambiarActivoModelo.mockRejectedValueOnce({ code: '42501' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Activo: PlayStation 4 Slim' }))
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument()
  })

  it('con solo lectura oculta «Nuevo modelo» y deshabilita los switches', async () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    await screen.findByText('Lite')
    expect(screen.queryByRole('button', { name: 'Nuevo modelo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Activo: Nintendo Switch Lite' })).toBeDisabled()
  })
})
