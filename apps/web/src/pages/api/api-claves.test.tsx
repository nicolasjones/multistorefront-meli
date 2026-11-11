// Pruebas de la pantalla «API» · bloque de claves (F-API-01, FR-001, FR-002, FR-013): el valor de la
// clave se ve una sola vez, rotar y revocar funcionan, los estados (carga, vacío, error) son los
// compartidos y el acceso es del Administrador. Corre con `pnpm --filter @platform/web test`.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  datos: {} as Record<string, { data: unknown[]; error: { message: string } | null }>,
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useNombreRolActual', () => ({ useNombreRolActual: () => 'Miembro' }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Sin acceso a {seccion}</p>,
}))

import { ApiList } from './list'

const CLAVES = [
  {
    id: 'c-1',
    nombre: 'Integración del cliente',
    prefijo: 'a1b2c3d4',
    alcances: ['productos', 'stock'],
    limite_por_minuto: 60,
    creada_en: '2027-01-01T00:00:00Z',
    vence_en: null,
    revocada_en: null,
    ultimo_uso_en: '2027-01-02T00:00:00Z',
  },
]

const abrir = () => render(<MemoryRouter><ApiList /></MemoryRouter>)

describe('pantalla API · claves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.datos = { api_claves: { data: CLAVES, error: null } }
    mocks.from.mockImplementation((tabla: string) => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve(mocks.datos[tabla] ?? { data: [], error: null }),
        }),
      }),
    }))
    mocks.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { id: 'c-2', valor: 'msf_a1b2c3d4_secreto' }, error: null }) })
  })

  it('muestra las claves con su prefijo, alcances y estado', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Claves' })).toBeInTheDocument()
    expect(await screen.findByText('Integración del cliente')).toBeInTheDocument()
    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
    expect(screen.getByText('productos, stock')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('un rol que no es Administrador ve el acceso restringido y no carga las claves', async () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(await screen.findByText('Sin acceso a API')).toBeInTheDocument()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('crea una clave con la RPC y muestra el valor una sola vez', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Crear clave' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Crear clave' })
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Integración del cliente' } })
    fireEvent.click(within(dialogo).getByLabelText('productos'))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('crear_clave_api', {
      p_nombre: 'Integración del cliente',
      p_alcances: ['productos'],
      p_vence_en: null,
    }))
    const valor = await screen.findByRole('dialog', { name: 'Copiá la clave' })
    expect(within(valor).getByLabelText('Clave de API')).toHaveValue('msf_a1b2c3d4_secreto')
    expect(within(valor).getByRole('button', { name: 'Copiar' })).toBeInTheDocument()
  })

  it('no crea la clave sin nombre ni alcances', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Crear clave' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Crear clave' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    expect(await within(dialogo).findByText('Ingresá un nombre.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Elegí al menos un alcance.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rota una clave después de confirmar y muestra el valor nuevo', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Rotar Integración del cliente' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    const confirmacion = await screen.findByRole('dialog', { name: 'Rotar clave' })
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Rotar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('rotar_clave_api', { p_clave_id: 'c-1' }))
    expect(await screen.findByRole('dialog', { name: 'Copiá la clave' })).toBeInTheDocument()
  })

  it('revoca una clave después de confirmar y avisa que quedó revocada', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar Integración del cliente' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
    const confirmacion = await screen.findByRole('dialog', { name: 'Revocar clave' })
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Revocar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('revocar_clave_api', { p_clave_id: 'c-1' }))
    expect(await screen.findByText('Revocaste la clave Integración del cliente.')).toBeInTheDocument()
  })

  it('si la revocación falla, el error se muestra dentro del diálogo abierto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Revocar Integración del cliente' }))
    const confirmacion = await screen.findByRole('dialog', { name: 'Revocar clave' })
    fireEvent.click(within(confirmacion).getByRole('button', { name: 'Revocar' }))
    expect(await within(confirmacion).findByText('No pudimos revocar la clave.')).toBeInTheDocument()
  })

  it('avisa si no se pudo crear la clave', async () => {
    mocks.rpc.mockReturnValue({ single: () => Promise.resolve({ data: null, error: { message: 'denied' } }) })
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Crear clave' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Crear clave' })
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Otra' } })
    fireEvent.click(within(dialogo).getByLabelText('stock'))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('No pudimos crear la clave.')).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando no hay claves', async () => {
    mocks.datos = { api_claves: { data: [], error: null } }
    abrir()
    expect(await screen.findByText('Todavía no hay claves.')).toBeInTheDocument()
  })

  it('muestra error con reintento si la lista no carga', async () => {
    mocks.datos = { api_claves: { data: [], error: { message: 'boom' } } }
    abrir()
    expect(await screen.findByText('No pudimos cargar las claves.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    expect(await screen.findByText('No pudimos cargar las claves.')).toBeInTheDocument()
  })

  it('se opera con teclado: las acciones son botones con nombre accesible', async () => {
    abrir()
    await screen.findByText('Integración del cliente')
    for (const nombre of ['Rotar Integración del cliente', 'Revocar Integración del cliente']) {
      expect(screen.getByRole('button', { name: nombre }).tagName).toBe('BUTTON')
    }
    expect(screen.getByRole('region', { name: 'Claves' })).toBeInTheDocument()
  })
})
