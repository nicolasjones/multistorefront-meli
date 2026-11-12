// Pruebas de la pantalla «API» · suscripciones, entregas y llamadas (F-API-01, FR-010, FR-014):
// se crea una suscripción con el secreto visible una sola vez, se pausa y se elimina, y las tablas de
// entregas y llamadas muestran su estado con el error saneado. Corre con `pnpm --filter @platform/web test`.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  datos: {} as Record<string, { data: unknown[]; error: { message: string } | null }>,
  rpcResultado: { data: null as unknown, error: null as { message: string } | null },
  usePuedeEscribir: vi.fn(),
  filtros: [] as [string, string, string][],
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { from: mocks.from, rpc: mocks.rpc },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useNombreRolActual', () => ({ useNombreRolActual: () => 'Administrador' }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <p>Sin acceso a {seccion}</p>,
}))

import { ApiList } from './list'

const SUSCRIPCIONES = [
  {
    id: 's-1',
    url: 'https://ejemplo.com/aviso',
    tipos: ['stock.actualizado'],
    activa: true,
    creada_en: '2027-01-01T00:00:00Z',
    actualizada_en: '2027-01-01T00:00:00Z',
  },
]

const ENTREGAS = [
  {
    id: 'e-1',
    evento_id: 'ev-1',
    suscripcion_id: 's-1',
    estado: 'agotada',
    intentos: 5,
    ultimo_estado_http: 500,
    ultimo_error_sanitizado: 'El destino respondió 500',
    creada_en: '2027-01-01T00:00:00Z',
    actualizada_en: '2027-01-01T00:00:00Z',
  },
]

const LLAMADAS = [
  {
    id: 'l-1',
    metodo: 'GET',
    ruta: '/v1/productos',
    version: 'v1',
    estado_http: 429,
    duracion_ms: 12,
    creada_en: '2027-01-01T00:00:00Z',
  },
]

const abrir = () => render(<MemoryRouter><ApiList /></MemoryRouter>)

describe('pantalla API · suscripciones, entregas y llamadas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.filtros = []
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.datos = {
      api_suscripciones: { data: SUSCRIPCIONES, error: null },
      api_entregas: { data: ENTREGAS, error: null },
      api_llamadas: { data: LLAMADAS, error: null },
    }
    mocks.from.mockImplementation((tabla: string) => {
      const consulta = {
        order: () => ({
          limit: () => Promise.resolve(mocks.datos[tabla] ?? { data: [], error: null }),
        }),
        eq: (columna: string, valor: string) => {
          mocks.filtros.push([tabla, columna, valor])
          return consulta
        },
      }
      return { select: () => consulta }
    })
    mocks.rpcResultado = { data: { id: 's-2', secreto: 'secreto-nuevo' }, error: null }
    mocks.rpc.mockImplementation(() => {
      // La RPC se usa como promesa (updates) y con `.single()` (alta): el mock sirve para las dos.
      const resultado = Promise.resolve({ data: mocks.rpcResultado.data, error: mocks.rpcResultado.error })
      return Object.assign(resultado, { single: () => resultado })
    })
  })

  it('muestra la suscripción con su URL, sus eventos y su estado', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Suscripciones a avisos' })).toBeInTheDocument()
    expect((await screen.findAllByText('https://ejemplo.com/aviso')).length).toBeGreaterThan(0)
    expect(screen.getByText('stock.actualizado')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('crea una suscripción y muestra el secreto una sola vez', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva suscripción' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva suscripción' })
    fireEvent.change(within(dialogo).getByLabelText(/URL del aviso/), { target: { value: 'https://ejemplo.com/otro' } })
    fireEvent.click(within(dialogo).getByLabelText('precio.actualizado'))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('crear_suscripcion_api', {
      p_url: 'https://ejemplo.com/otro',
      p_tipos: ['precio.actualizado'],
    }))
    const secreto = await screen.findByRole('dialog', { name: 'Copiá el secreto' })
    expect(within(secreto).getByLabelText(/Secreto de firma/)).toHaveValue('secreto-nuevo')
  })

  it('rechaza una URL sin https antes de llamar a la base', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva suscripción' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva suscripción' })
    fireEvent.change(within(dialogo).getByLabelText(/URL del aviso/), { target: { value: 'http://ejemplo.com/aviso' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    expect(await within(dialogo).findByText('La URL tiene que empezar con https.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('pausa y elimina una suscripción', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar https://ejemplo.com/aviso' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('actualizar_suscripcion_api', {
      p_id: 's-1',
      p_activa: false,
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar https://ejemplo.com/aviso' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('eliminar_suscripcion_api', { p_id: 's-1' }))
    expect(await screen.findByText('Eliminaste la suscripción https://ejemplo.com/aviso.')).toBeInTheDocument()
  })

  it('avisa que se llegó al máximo de suscripciones', async () => {
    mocks.rpcResultado = { data: null, error: { code: '54000', message: 'tope' } as { message: string } }
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva suscripción' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva suscripción' })
    fireEvent.change(within(dialogo).getByLabelText(/URL del aviso/), { target: { value: 'https://ejemplo.com/otro' } })
    fireEvent.click(within(dialogo).getByLabelText('precio.actualizado'))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Crear' }))
    expect(await screen.findByText('Llegaste al máximo de 20 suscripciones. Eliminá alguna antes de crear otra.')).toBeInTheDocument()
  })

  it('muestra las entregas con su estado, sus intentos y el último error', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Entregas recientes' })).toBeInTheDocument()
    expect(await screen.findByText('agotada')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText(/El destino respondió 500/)).toBeInTheDocument()
  })

  it('las entregas muestran la URL de la suscripción como destino, no su identificador', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Entregas de avisos' })
    expect(await within(tabla).findByText('https://ejemplo.com/aviso')).toBeInTheDocument()
    expect(within(tabla).queryByText('s-1')).not.toBeInTheDocument()
  })

  it('una entrega agotada se puede reintentar y avisa que volvió a la cola', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar el aviso a https://ejemplo.com/aviso' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('reintentar_entrega_api', { p_entrega_id: 'e-1' }))
    expect(await screen.findByText(/Volvimos a poner en la cola el aviso para https:\/\/ejemplo\.com\/aviso/)).toBeInTheDocument()
  })

  it('«Solo agotadas» pide al servidor únicamente las agotadas', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Entregas de avisos' })
    expect(mocks.filtros.filter(([tabla]) => tabla === 'api_entregas')).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo agotadas' }))
    await waitFor(() => expect(mocks.filtros).toContainEqual(['api_entregas', 'estado', 'agotada']))
  })

  it('con «Solo agotadas» y sin ninguna avisa que no hay entregas agotadas', async () => {
    abrir()
    await screen.findByRole('table', { name: 'Entregas de avisos' })
    mocks.datos = { ...mocks.datos, api_entregas: { data: [], error: null } }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo agotadas' }))
    expect(await screen.findByText('No hay entregas agotadas.')).toBeInTheDocument()
  })

  it('si no se puede reintentar la entrega, recarga la lista', async () => {
    mocks.rpcResultado = { data: null, error: { message: 'denied' } }
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar el aviso a https://ejemplo.com/aviso' }))
    await screen.findByText(/No pudimos reintentar la entrega/)
    await waitFor(() => expect(mocks.from.mock.calls.filter(([tabla]) => tabla === 'api_entregas').length).toBeGreaterThan(1))
  })

  it('solo las entregas agotadas tienen el botón Reintentar', async () => {
    mocks.datos = {
      ...mocks.datos,
      api_entregas: { data: [{ ...ENTREGAS[0], estado: 'completada' }], error: null },
    }
    abrir()
    await screen.findByRole('table', { name: 'Entregas de avisos' })
    expect(screen.queryByRole('button', { name: /Reintentar el aviso/ })).not.toBeInTheDocument()
  })

  it('avisa si no se pudo reintentar la entrega', async () => {
    mocks.rpcResultado = { data: null, error: { message: 'denied' } }
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar el aviso a https://ejemplo.com/aviso' }))
    expect(await screen.findByText(/No pudimos reintentar la entrega/)).toBeInTheDocument()
  })

  it('muestra las llamadas con su estado y su duración', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Llamadas recientes' })).toBeInTheDocument()
    expect(await screen.findByText('429')).toBeInTheDocument()
    expect(screen.getByText('12 ms')).toBeInTheDocument()
  })

  it('muestra el estado vacío de cada bloque', async () => {
    mocks.datos = {
      api_suscripciones: { data: [], error: null },
      api_entregas: { data: [], error: null },
      api_llamadas: { data: [], error: null },
    }
    abrir()
    expect(await screen.findByText('Todavía no hay suscripciones.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay entregas.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay llamadas registradas.')).toBeInTheDocument()
  })

  it('muestra error con reintento si un bloque no carga', async () => {
    mocks.datos = { api_suscripciones: { data: [], error: { message: 'boom' } } }
    abrir()
    expect(await screen.findByText('No pudimos cargar las suscripciones.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Reintentar/i })[0])
  })

  it('avisa si no se pudo cambiar la suscripción', async () => {
    mocks.rpcResultado = { data: null, error: { message: 'denied' } }
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar https://ejemplo.com/aviso' }))
    expect(await screen.findByText('No pudimos cambiar el estado de la suscripción.')).toBeInTheDocument()
  })
})
