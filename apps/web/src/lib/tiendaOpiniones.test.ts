import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schema: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { schema: mocks.schema } }))

import { esSinAcceso } from './tiendaCuentaDatos'
import { borrarOpinion, guardarOpinion, leerCapacidadOpiniones, leerMisOpiniones, leerOpinionesProducto, reiniciarCapacidadOpiniones } from './tiendaOpiniones'

const HOST = 'mundojc.localhost'
const P = 'a1000000-0000-4000-8000-000000000001'
const O = '0c000000-0000-4000-8000-000000000001'

function responde(data: unknown) {
  mocks.rpc.mockResolvedValue({ data, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  reiniciarCapacidadOpiniones()
  mocks.schema.mockReturnValue({ rpc: mocks.rpc })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('tiendaOpiniones · capacidad', () => {
  it('una sola llamada por host y devuelve el booleano del servidor', async () => {
    responde({ estado: 'ok', opiniones: true })
    expect(await leerCapacidadOpiniones(HOST)).toBe(true)
    expect(await leerCapacidadOpiniones(HOST)).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('capacidades_opiniones_por_dominio', { host: HOST })
  })

  it('error del servidor, host desconocido y bandera apagada: false', async () => {
    responde({ estado: 'error' })
    expect(await leerCapacidadOpiniones(HOST)).toBe(false)
    reiniciarCapacidadOpiniones()
    responde({ estado: 'ok', opiniones: false })
    expect(await leerCapacidadOpiniones(HOST)).toBe(false)
  })

  it('si la llamada falla no se guarda: el siguiente uso reintenta', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'red' } })
    await expect(leerCapacidadOpiniones(HOST)).rejects.toThrow('red')
    responde({ estado: 'ok', opiniones: true })
    expect(await leerCapacidadOpiniones(HOST)).toBe(true)
  })
})

describe('tiendaOpiniones · lectura de la ficha', () => {
  it('acomoda resumen y filas con la lista blanca y manda el cursor', async () => {
    responde({
      estado: 'ok', resumen: { promedio: 4.5, cantidad: 2 },
      filas: [{ id: O, nombre_pila: 'Valeria', puntuacion: 5, comentario: '<b>Genial</b> producto', fecha: '2027-03-10', es_mia: true, estado: 'pendiente', cliente_id: 'x' }],
      siguiente: { creada: '2027-03-10T10:00:00+00:00', id: O },
    })
    const pagina = await leerOpinionesProducto(HOST, P, { creada: '2027-03-11T00:00:00+00:00', id: O }, 5)
    expect(mocks.rpc).toHaveBeenCalledWith('opiniones_producto_por_dominio', { host: HOST, producto_id: P, desde_creada: '2027-03-11T00:00:00+00:00', desde_id: O, limite: 5 })
    expect(pagina.resumen).toEqual({ promedio: 4.5, cantidad: 2 })
    expect(pagina.filas).toEqual([{ id: O, nombrePila: 'Valeria', puntuacion: 5, comentario: '<b>Genial</b> producto', fecha: '2027-03-10', esMia: true }])
    expect(pagina.siguiente).toEqual({ creada: '2027-03-10T10:00:00+00:00', id: O })
  })

  it('descarta filas inválidas y acota el límite; una respuesta que no es ok es un error', async () => {
    responde({ estado: 'ok', resumen: { promedio: null, cantidad: 0 }, filas: [{ id: 'no-es-uuid', puntuacion: 5 }, { id: O, puntuacion: 9 }], siguiente: null })
    expect((await leerOpinionesProducto(HOST, P, null, 999)).filas).toEqual([])
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ limite: 50, desde_creada: null, desde_id: null })
    responde({ estado: 'no_encontrado' })
    await expect(leerOpinionesProducto(HOST, P)).rejects.toMatchObject({ codigo: 'error' })
  })
})

describe('tiendaOpiniones · cuenta', () => {
  it('guardar: ok, inválido, topes, no_encontrado y límite', async () => {
    responde({ estado: 'ok', opinion: { id: O, estado: 'pendiente', puntuacion: 4, comentario: 'Muy buen producto' } })
    expect(await guardarOpinion(HOST, P, 4, 'Muy buen producto')).toEqual({ estado: 'ok', opinion: { id: O, estado: 'pendiente', puntuacion: 4, comentario: 'Muy buen producto' } })
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_opinion_por_dominio', { host: HOST, producto_id: P, puntuacion: 4, comentario: 'Muy buen producto' })
    responde({ estado: 'invalido', campos: ['comentario', 'otro'] })
    expect(await guardarOpinion(HOST, P, 4, 'x')).toEqual({ estado: 'invalido', campos: ['comentario'] })
    for (const estado of ['limite_opiniones', 'limite_pendientes', 'no_encontrado'] as const) {
      responde({ estado })
      expect(await guardarOpinion(HOST, P, 4, 'x')).toEqual({ estado })
    }
    responde({ estado: 'limite', espera_segundos: 12 })
    expect(await guardarOpinion(HOST, P, 4, 'x')).toEqual({ estado: 'limite', esperaSegundos: 12 })
  })

  it('sin_acceso y fallas se vuelven un ErrorCuentaTienda', async () => {
    responde({ estado: 'sin_acceso' })
    await expect(guardarOpinion(HOST, P, 4, 'x')).rejects.toSatisfy(esSinAcceso)
    responde({ estado: 'error' })
    await expect(guardarOpinion(HOST, P, 4, 'x')).rejects.toMatchObject({ codigo: 'error' })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'red' } })
    await expect(borrarOpinion(HOST, P)).rejects.toMatchObject({ codigo: 'error' })
  })

  it('borrar: ok y límite', async () => {
    responde({ estado: 'ok' })
    expect(await borrarOpinion(HOST, P)).toEqual({ estado: 'ok' })
    expect(mocks.rpc).toHaveBeenCalledWith('borrar_opinion_por_dominio', { host: HOST, producto_id: P })
    responde({ estado: 'limite', espera_segundos: 5 })
    expect(await borrarOpinion(HOST, P)).toEqual({ estado: 'limite', esperaSegundos: 5 })
  })

  it('mis opiniones: acomoda estado y motivo', async () => {
    responde({
      estado: 'ok', total: 1, siguiente: null,
      filas: [{ id: O, producto_id: P, producto_nombre: 'Joystick', puntuacion: 2, comentario: 'No me gustó nada', estado: 'rechazada', motivo_rechazo: 'Spam', creada_en: '2027-03-10T10:00:00+00:00', actualizada_en: '2027-03-11T10:00:00+00:00' }],
    })
    const pagina = await leerMisOpiniones(HOST)
    expect(mocks.rpc).toHaveBeenCalledWith('mis_opiniones_por_dominio', { host: HOST, desde_creada: null, desde_id: null, limite: 20 })
    expect(pagina.total).toBe(1)
    expect(pagina.filas[0]).toMatchObject({ productoNombre: 'Joystick', estado: 'rechazada', motivoRechazo: 'Spam' })
  })
})

describe('tiendaOpiniones · límite de «Mis opiniones»', () => {
  it('un estado distinto de ok (por ejemplo limite) es un error con reintento, no una lista vacía', async () => {
    responde({ estado: 'limite', espera_segundos: 20 })
    await expect(leerMisOpiniones(HOST)).rejects.toMatchObject({ codigo: 'error' })
  })
})
