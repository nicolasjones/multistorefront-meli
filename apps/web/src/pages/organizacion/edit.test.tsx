import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useEmpresas: vi.fn(),
  invalidar: vi.fn(),
  setWarnWhen: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.setWarnWhen }) }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useContextoPanel', () => ({
  useContextoPanel: () => ({ contexto: { organizacion_id: 'org-1' }, isLoading: false, error: null, invalidar: mocks.invalidar }),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, createSignedUrl: mocks.createSignedUrl }) },
  },
}))

import { OrganizacionEdit } from './edit'

const organizacion = { id: 'org-1', nombre: 'Agenmatica', zona_horaria: 'America/Argentina/Buenos_Aires', logo_path: null }
const sinEmpresas = { empresas: [], isLoading: false, isError: false, refetch: vi.fn() }

const abrir = () => render(<MemoryRouter><OrganizacionEdit /></MemoryRouter>)

describe('OrganizacionEdit', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useEmpresas.mockReturnValue(sinEmpresas)
    mocks.maybeSingle.mockResolvedValue({ data: organizacion, error: null })
    mocks.createSignedUrl.mockResolvedValue({ data: null })
    mocks.remove.mockResolvedValue({ error: null })
  })

  it('carga los datos actuales de la organización', async () => {
    abrir()

    expect(await screen.findByLabelText(/Nombre de la organización/)).toHaveValue('Agenmatica')
    expect(screen.getByLabelText('Zona horaria')).toHaveValue('America/Argentina/Buenos_Aires')
    expect(screen.getByText('Todavía no cargaste un logo.')).toBeInTheDocument()
  })

  it('guarda los cambios por la RPC y confirma con el patrón de éxito', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...organizacion, nombre: 'Nuevo nombre', zona_horaria: 'America/Montevideo' }, error: null })
    abrir()

    fireEvent.change(await screen.findByLabelText(/Nombre de la organización/), { target: { value: '  Nuevo nombre ' } })
    fireEvent.change(screen.getByLabelText('Zona horaria'), { target: { value: 'America/Montevideo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_organizacion', {
      p_nombre: 'Nuevo nombre',
      p_zona_horaria: 'America/Montevideo',
      p_logo_path: null,
    })
    expect(mocks.invalidar).toHaveBeenCalled()
  })

  it('valida el nombre vacío sin llamar a la base', async () => {
    abrir()

    fireEvent.change(await screen.findByLabelText(/Nombre de la organización/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('El nombre de la organización es obligatorio.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('muestra el error de la base y no confirma el guardado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'La zona horaria no es válida' } })
    abrir()

    fireEvent.change(await screen.findByLabelText(/Nombre de la organización/), { target: { value: 'Otro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('La zona horaria no es válida')).toBeInTheDocument()
    expect(screen.queryByText('Cambios guardados.')).not.toBeInTheDocument()
  })

  it('rechaza un logo de tipo o tamaño no admitido sin subirlo', async () => {
    abrir()
    const entrada = await screen.findByLabelText('Archivo del logo')

    fireEvent.change(entrada, { target: { files: [new File(['x'], 'logo.svg', { type: 'image/svg+xml' })] } })
    expect(await screen.findByText('El logo debe ser una imagen PNG, JPG o WebP.')).toBeInTheDocument()

    const grande = new File([new Uint8Array(1024 * 1024 + 1)], 'logo.png', { type: 'image/png' })
    fireEvent.change(entrada, { target: { files: [grande] } })
    expect(await screen.findByText('El logo no puede superar 1 MB.')).toBeInTheDocument()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('sube el logo bajo el prefijo de la organización y lo envía a la RPC', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    mocks.rpc.mockImplementation(async (_nombre: string, args: { p_logo_path: string }) => ({
      data: { ...organizacion, logo_path: args.p_logo_path },
      error: null,
    }))
    abrir()

    fireEvent.change(await screen.findByLabelText('Archivo del logo'), { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument()
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^org-1\/[\w-]+\.png$/)
    expect(mocks.rpc.mock.calls[0][1].p_logo_path).toBe(mocks.upload.mock.calls[0][0])
  })

  it('borra el logo subido si la RPC rechaza el guardado', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'El logo no es válido' } })
    abrir()

    fireEvent.change(await screen.findByLabelText('Archivo del logo'), { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('El logo no es válido')).toBeInTheDocument()
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]))
  })

  it('un no administrador ve acceso restringido y no consulta nada', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()

    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('muestra error con reintento si no pueden cargarse los datos', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    abrir()

    expect(await screen.findByText('No pudimos cargar los datos de la organización.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText(/Nombre de la organización/)).toHaveValue('Agenmatica')
  })

  it('lista las empresas con enlace a editar, sin alta', async () => {
    mocks.useEmpresas.mockReturnValue({
      ...sinEmpresas,
      empresas: [{ id: 'e-1', nombre: 'San Javucho', activa: true }, { id: 'e-2', nombre: 'Mundo JC', activa: false }],
    })
    abrir()

    expect(await screen.findByText('San Javucho')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar Mundo JC' })).toHaveAttribute('href', '/empresas/edit/e-2')
    expect(screen.queryByRole('link', { name: /nueva|crear|agregar/i })).not.toBeInTheDocument()
  })

  it('muestra el vacío cuando la organización no tiene empresas', async () => {
    abrir()

    expect(await screen.findByText('Todavía no hay empresas cargadas.')).toBeInTheDocument()
  })
})
