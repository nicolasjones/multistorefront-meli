import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import { MisOpiniones } from './MisOpiniones'

const HOST = 'mundojc.localhost'
const P_1 = 'a1000000-0000-4000-8000-000000000001'
const P_2 = 'a1000000-0000-4000-8000-000000000002'
const P_3 = 'a1000000-0000-4000-8000-000000000003'
const O_1 = '0c000000-0000-4000-8000-000000000001'
const O_2 = '0c000000-0000-4000-8000-000000000002'
const O_3 = '0c000000-0000-4000-8000-000000000003'

const mia = (id: string, productoId: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, producto_id: productoId, producto_nombre: nombre, puntuacion: 4, comentario: `Comentario sobre ${nombre}`, estado: 'pendiente', motivo_rechazo: null,
  creada_en: '2027-03-10T10:00:00+00:00', actualizada_en: '2027-03-10T10:00:00+00:00', ...extra,
})
const PAGINA_1 = {
  estado: 'ok', total: 3, siguiente: { creada: '2027-03-09T10:00:00+00:00', id: O_2 },
  filas: [mia(O_1, P_1, 'Joystick', { estado: 'aceptada' }), mia(O_2, P_2, 'Cable', { estado: 'rechazada', motivo_rechazo: 'Contenido ajeno', puntuacion: 1 })],
}
const PAGINA_2 = { estado: 'ok', total: 3, siguiente: null, filas: [mia(O_3, P_3, 'Funda')] }

type Respuesta = Record<string, unknown> | ((argumentos: Record<string, unknown>) => unknown)
function rpcs(respuestas: Record<string, Respuesta>) {
  mocks.rpc.mockImplementation(async (funcion: string, argumentos: Record<string, unknown>) => {
    const respuesta = respuestas[funcion]
    return { data: typeof respuesta === 'function' ? (respuesta as (a: Record<string, unknown>) => unknown)(argumentos) : respuesta ?? null, error: null }
  })
}
const montar = (alSinAcceso = vi.fn()) => render(<MemoryRouter><MisOpiniones host={HOST} alSinAcceso={alSinAcceso} /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  fijarAncho(1440)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  rpcs({ mis_opiniones_por_dominio: (a) => (a.desde_id ? PAGINA_2 : PAGINA_1) })
})

describe('MisOpiniones · «Mi cuenta» (RF-OPI-8, RF-OPI-11)', () => {
  it('lista las opiniones con su estado y el motivo del rechazo', async () => {
    montar()
    const lista = await screen.findByRole('list', { name: 'Mis opiniones' })
    const items = within(lista).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Publicada')).toBeInTheDocument()
    expect(within(items[1]).getByText('Rechazada')).toBeInTheDocument()
    expect(within(items[1]).getByText('Motivo: Contenido ajeno')).toBeInTheDocument()
    expect(screen.getByText('3 opiniones')).toBeInTheDocument()
  })

  it('«Cargar más» suma la siguiente tanda', async () => {
    montar()
    await screen.findByText('Joystick')
    fireEvent.click(screen.getByRole('button', { name: /cargar más/i }))
    expect(await screen.findByText('Funda')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Mis opiniones' })).getAllByRole('listitem')).toHaveLength(3)
    expect(within(screen.getAllByRole('listitem')[2]).getByText('Pendiente de revisión')).toBeInTheDocument()
  })

  it('estado vacío', async () => {
    rpcs({ mis_opiniones_por_dominio: { estado: 'ok', total: 0, filas: [], siguiente: null } })
    montar()
    expect(await screen.findByText('Todavía no dejaste opiniones')).toBeInTheDocument()
  })

  it('error con reintento', async () => {
    let falla = true
    rpcs({ mis_opiniones_por_dominio: () => (falla ? { estado: 'error' } : PAGINA_2) })
    montar()
    const reintentar = await screen.findByRole('button', { name: /reintentar/i })
    falla = false
    fireEvent.click(reintentar)
    expect(await screen.findByText('Funda')).toBeInTheDocument()
  })

  it('sin acceso avisa a la pantalla y no dibuja la lista', async () => {
    rpcs({ mis_opiniones_por_dominio: { estado: 'sin_acceso' } })
    const alSinAcceso = vi.fn()
    const { container } = montar(alSinAcceso)
    await waitFor(() => expect(alSinAcceso).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('editar abre el formulario con lo actual, guarda y recarga la lista', async () => {
    rpcs({
      mis_opiniones_por_dominio: PAGINA_1,
      guardar_opinion_por_dominio: { estado: 'ok', opinion: { id: O_1, estado: 'pendiente', puntuacion: 2, comentario: 'Ahora cambié de idea' } },
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar mi opinión sobre Joystick' }))
    const comentario = screen.getByLabelText(/tu comentario/i)
    expect(comentario).toHaveValue('Comentario sobre Joystick')
    expect(screen.getByRole('radio', { name: '4 estrellas de 5' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: '2 estrellas de 5' }))
    fireEvent.change(comentario, { target: { value: 'Ahora cambié de idea' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('guardar_opinion_por_dominio', { host: HOST, producto_id: P_1, puntuacion: 2, comentario: 'Ahora cambié de idea' }))
    expect(await screen.findByRole('status')).toHaveTextContent('se publicará cuando la revisemos')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Tu opinión' })).not.toBeInTheDocument())
    expect(mocks.rpc.mock.calls.filter(([funcion]) => funcion === 'mis_opiniones_por_dominio').length).toBeGreaterThanOrEqual(2)
  })

  it('cancelar la edición cierra el formulario sin llamar al servidor', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar mi opinión sobre Joystick' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('form', { name: 'Tu opinión' })).not.toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'guardar_opinion_por_dominio')).toBe(false)
  })

  it('borrar pide confirmación; cancelar no borra y confirmar la saca de la lista', async () => {
    rpcs({ mis_opiniones_por_dominio: PAGINA_1, borrar_opinion_por_dominio: { estado: 'ok' } })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar mi opinión sobre Joystick' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Borrar tu opinión?' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'borrar_opinion_por_dominio')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Borrar mi opinión sobre Joystick' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Borrar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('borrar_opinion_por_dominio', { host: HOST, producto_id: P_1 }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Borrar mi opinión sobre Joystick' })).not.toBeInTheDocument())
    expect(await screen.findByText('Borramos tu opinión')).toBeInTheDocument()
  })

  it.each(ANCHOS_TIENDA)('sin violaciones de accesibilidad a %i px', async (ancho) => {
    fijarAncho(ancho)
    const { container } = montar()
    await screen.findByText('Joystick')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
