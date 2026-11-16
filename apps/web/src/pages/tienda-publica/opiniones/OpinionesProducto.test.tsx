import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANCHOS_TIENDA, fijarAncho } from '../../../test/ancho'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn(), sesionActivaEnTienda: vi.fn(), onAuthStateChange: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { schema: mocks.schema, auth: { onAuthStateChange: mocks.onAuthStateChange } } }))
vi.mock('../../../lib/tiendaCuenta', async (original) => ({ ...(await original<typeof import('../../../lib/tiendaCuenta')>()), sesionActivaEnTienda: mocks.sesionActivaEnTienda }))

import { reiniciarCapacidadOpiniones } from '../../../lib/tiendaOpiniones'
import OpinionesProducto from './OpinionesProducto'
import { TEXTO_ERROR_COMENTARIO, TEXTO_ERROR_PUNTUACION, TEXTO_GRACIAS } from './FormularioOpinion'

const HOST = 'mundojc.localhost'
const P = 'a1000000-0000-4000-8000-000000000001'
const O_1 = '0c000000-0000-4000-8000-000000000001'
const O_2 = '0c000000-0000-4000-8000-000000000002'
const O_3 = '0c000000-0000-4000-8000-000000000003'

const fila = (id: string, extra: Record<string, unknown> = {}) => ({ id, nombre_pila: 'Valeria', puntuacion: 5, comentario: 'Excelente producto', fecha: '2027-03-10', es_mia: false, ...extra })
const PAGINA_1 = { estado: 'ok', resumen: { promedio: 4.3, cantidad: 3 }, filas: [fila(O_1), fila(O_2, { nombre_pila: 'Bruno', puntuacion: 4 })], siguiente: { creada: '2027-03-10T10:00:00+00:00', id: O_2 } }
const PAGINA_2 = { estado: 'ok', resumen: { promedio: 4.3, cantidad: 3 }, filas: [fila(O_3, { nombre_pila: 'Carla', puntuacion: 4, fecha: '2027-03-09' })], siguiente: null }

type Respuesta = Record<string, unknown> | ((argumentos: Record<string, unknown>) => unknown)
function rpcs(respuestas: Record<string, Respuesta>) {
  mocks.rpc.mockImplementation(async (funcion: string, argumentos: Record<string, unknown>) => {
    const respuesta = respuestas[funcion]
    return { data: typeof respuesta === 'function' ? (respuesta as (a: Record<string, unknown>) => unknown)(argumentos) : respuesta ?? null, error: null }
  })
}
const montar = () => render(<MemoryRouter><OpinionesProducto host={HOST} productoId={P} /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  reiniciarCapacidadOpiniones()
  fijarAncho(1440)
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  mocks.sesionActivaEnTienda.mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: PAGINA_1 })
})

describe('OpinionesProducto · bloque de la ficha', () => {
  it('con la función apagada no dibuja nada ni lee opiniones (paridad con la ficha de antes)', async () => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: false } })
    const { container } = montar()
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('capacidades_opiniones_por_dominio', { host: HOST }))
    expect(container).toBeEmptyDOMElement()
    expect(mocks.rpc.mock.calls.map(([funcion]) => funcion)).toEqual(['capacidades_opiniones_por_dominio'])
  })

  it('si falla la capacidad tampoco dibuja nada', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'red' } })
    const { container } = montar()
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra promedio, cantidad y las opiniones con nombre de pila, estrellas y fecha', async () => {
    montar()
    expect(await screen.findByText('4,3 de 5 · 3 opiniones')).toBeInTheDocument()
    const lista = screen.getByRole('list', { name: 'Opiniones del producto' })
    const items = within(lista).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Valeria')).toBeInTheDocument()
    expect(within(items[0]).getByRole('img', { name: '5 estrellas de 5' })).toBeInTheDocument()
    expect(within(items[0]).getByText('10/03/2027')).toBeInTheDocument()
    expect(within(items[1]).getByRole('img', { name: '4 estrellas de 5' })).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('opiniones_producto_por_dominio', { host: HOST, producto_id: P, desde_creada: null, desde_id: null, limite: 10 })
  })

  it('«Cargar más» suma la tanda siguiente con el cursor y no repite filas', async () => {
    rpcs({
      capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true },
      opiniones_producto_por_dominio: (a) => (a.desde_id ? PAGINA_2 : PAGINA_1),
    })
    montar()
    await screen.findByText('Valeria')
    fireEvent.click(screen.getByRole('button', { name: /cargar más/i }))
    expect(await screen.findByText('Carla')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('opiniones_producto_por_dominio', { host: HOST, producto_id: P, desde_creada: '2027-03-10T10:00:00+00:00', desde_id: O_2, limite: 10 })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('estado vacío: «Todavía no hay opiniones»', async () => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: { estado: 'ok', resumen: { promedio: null, cantidad: 0 }, filas: [], siguiente: null } })
    montar()
    expect((await screen.findAllByText('Todavía no hay opiniones')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('list', { name: 'Opiniones del producto' })).not.toBeInTheDocument()
  })

  it('error con reintento', async () => {
    let falla = true
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: () => (falla ? { estado: 'error' } : PAGINA_2) })
    montar()
    const reintentar = await screen.findByRole('button', { name: /reintentar/i })
    falla = false
    fireEvent.click(reintentar)
    expect(await screen.findByText('Carla')).toBeInTheDocument()
  })

  it('un comentario con HTML se muestra como texto literal, sin interpretarse (CA-OPI-3)', async () => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: { ...PAGINA_2, filas: [fila(O_3, { comentario: '<script>alert(1)</script> <b>negrita</b>' })] } })
    const { container } = montar()
    expect(await screen.findByText('<script>alert(1)</script> <b>negrita</b>')).toBeInTheDocument()
    expect(container.querySelector('script, b')).toBeNull()
  })

  it('sin sesión invita a ingresar y no muestra el formulario', async () => {
    montar()
    const enlace = await screen.findByRole('link', { name: 'Ingresá para dejar tu opinión' })
    expect(enlace.getAttribute('href')).toContain('/ingresar')
    expect(screen.queryByRole('form', { name: 'Tu opinión' })).not.toBeInTheDocument()
  })

  it('marca la opinión propia', async () => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: { ...PAGINA_2, filas: [fila(O_3, { es_mia: true })] } })
    montar()
    expect(await screen.findByText('Valeria (vos)')).toBeInTheDocument()
  })

  it.each(ANCHOS_TIENDA)('sin violaciones de accesibilidad a %i px (con formulario y lista)', async (ancho) => {
    fijarAncho(ancho)
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
    const { container } = montar()
    await screen.findByRole('form', { name: 'Tu opinión' })
    await screen.findByText('Bruno')
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('OpinionesProducto · «Tu opinión» (RF-OPI-11)', () => {
  beforeEach(() => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
  })

  it('las estrellas se operan con el teclado: flechas, Inicio y Fin; una sola parada de tabulación', async () => {
    montar()
    const grupo = await screen.findByRole('radiogroup', { name: 'Tu puntuación' })
    const estrellas = within(grupo).getAllByRole('radio')
    expect(estrellas).toHaveLength(5)
    expect(estrellas.filter((e) => e.getAttribute('tabindex') === '0')).toHaveLength(1)
    estrellas[0].focus()
    fireEvent.keyDown(estrellas[0], { key: 'ArrowRight' })
    expect(estrellas[1]).toHaveAttribute('aria-checked', 'true')
    expect(estrellas[1]).toHaveFocus()
    fireEvent.keyDown(estrellas[1], { key: 'End' })
    expect(estrellas[4]).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(estrellas[4], { key: 'Home' })
    expect(estrellas[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(estrellas[0], { key: 'ArrowLeft' })
    expect(estrellas[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(estrellas[3])
    expect(estrellas[3]).toHaveAttribute('aria-checked', 'true')
    expect(estrellas[3]).toHaveAttribute('tabindex', '0')
  })

  it('muestra el contador de caracteres', async () => {
    montar()
    const comentario = await screen.findByLabelText(/tu comentario/i)
    expect(screen.getByText('0 de 1000 caracteres (mínimo 10)')).toBeInTheDocument()
    fireEvent.change(comentario, { target: { value: 'Muy bueno' } })
    expect(screen.getByText('9 de 1000 caracteres (mínimo 10)')).toBeInTheDocument()
  })

  it('errores por campo antes de enviar y no llama al servidor', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar opinión' }))
    expect(await screen.findByText(TEXTO_ERROR_PUNTUACION)).toBeInTheDocument()
    expect(screen.getByText(TEXTO_ERROR_COMENTARIO)).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.some(([funcion]) => funcion === 'guardar_opinion_por_dominio')).toBe(false)
  })

  it('un comentario con enlace se rechaza en el campo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('radio', { name: '4 estrellas de 5' }))
    fireEvent.change(screen.getByLabelText(/tu comentario/i), { target: { value: 'Mirá https://ejemplo.com ahora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar opinión' }))
    expect(await screen.findByText(TEXTO_ERROR_COMENTARIO)).toBeInTheDocument()
    expect(screen.queryByText(TEXTO_ERROR_PUNTUACION)).not.toBeInTheDocument()
  })

  it('al enviar manda puntuación y comentario recortado y muestra «se publicará cuando la revisemos»', async () => {
    rpcs({
      capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true },
      opiniones_producto_por_dominio: PAGINA_1,
      guardar_opinion_por_dominio: { estado: 'ok', opinion: { id: O_3, estado: 'pendiente', puntuacion: 4, comentario: 'Muy buen producto, lo recomiendo' } },
    })
    montar()
    fireEvent.click(await screen.findByRole('radio', { name: '4 estrellas de 5' }))
    fireEvent.change(screen.getByLabelText(/tu comentario/i), { target: { value: '  Muy buen producto, lo recomiendo  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar opinión' }))
    expect(await screen.findByText(TEXTO_GRACIAS)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_opinion_por_dominio', { host: HOST, producto_id: P, puntuacion: 4, comentario: 'Muy buen producto, lo recomiendo' })
    expect(screen.queryByRole('form', { name: 'Tu opinión' })).not.toBeInTheDocument()
  })

  it.each([
    ['limite_opiniones', /máximo de opiniones/],
    ['limite_pendientes', /esperando revisión/],
    ['no_encontrado', /ya no está disponible/],
  ])('respuesta %s: aviso claro y el formulario conserva lo escrito', async (estado, texto) => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: PAGINA_1, guardar_opinion_por_dominio: { estado } })
    montar()
    fireEvent.click(await screen.findByRole('radio', { name: '5 estrellas de 5' }))
    fireEvent.change(screen.getByLabelText(/tu comentario/i), { target: { value: 'Comentario válido y largo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar opinión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(texto)
    expect(screen.getByLabelText(/tu comentario/i)).toHaveValue('Comentario válido y largo')
  })

  it('si el servidor dice sin_acceso (cuenta suspendida) deja de ofrecer el formulario', async () => {
    rpcs({ capacidades_opiniones_por_dominio: { estado: 'ok', opiniones: true }, opiniones_producto_por_dominio: PAGINA_1, guardar_opinion_por_dominio: { estado: 'sin_acceso' } })
    montar()
    fireEvent.click(await screen.findByRole('radio', { name: '5 estrellas de 5' }))
    fireEvent.change(screen.getByLabelText(/tu comentario/i), { target: { value: 'Comentario válido y largo' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enviar opinión' })) })
    expect(await screen.findByText(/tu cuenta no está activa/i)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Tu opinión' })).not.toBeInTheDocument()
  })
})
