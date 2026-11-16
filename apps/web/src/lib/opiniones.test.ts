import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('./supabase', () => {
  const cadena: Record<string, unknown> = {}
  for (const metodo of ['from', 'select', 'eq']) cadena[metodo] = () => cadena
  cadena.maybeSingle = mocks.maybeSingle
  return { supabaseClient: { ...cadena, rpc: mocks.rpc } }
})

import {
  CONTADORES_VACIOS, esConflictoOpinion, esSinPermisoOpiniones, leerBanderaOpiniones, listarOpiniones, mensajeDeErrorOpiniones,
  largoMotivo, moderarOpinion, MENSAJE_CONFLICTO_OPINION, normalizarMotivo, textoPuntuacion,
} from './opiniones'

describe('cliente de datos de opiniones', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.maybeSingle.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('lista con el cursor y la tienda como parámetros de la RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { contadores: { pendientes: 2, aceptadas: 1, rechazadas: 0 }, filas: [], siguiente: null }, error: null })
    const tanda = await listarOpiniones({ estado: 'pendiente', empresaId: 'e-1', desde: { creada: '2027-03-10T10:00:00Z', id: 'o-1' }, limite: 5 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_opiniones', {
      p_estado: 'pendiente', p_empresa_id: 'e-1', p_desde_creada: '2027-03-10T10:00:00Z', p_desde_id: 'o-1', p_limite: 5,
    })
    expect(tanda.contadores.pendientes).toBe(2)
  })

  it('una respuesta vacía no rompe: contadores en cero y sin filas', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const tanda = await listarOpiniones({ estado: 'todas', empresaId: null })
    expect(tanda).toEqual({ contadores: CONTADORES_VACIOS, filas: [], siguiente: null })
  })

  it('T029 (H-2): una fila con la forma del contrato se muestra tal cual', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        contadores: { pendientes: 1, aceptadas: 0, rechazadas: 0 },
        filas: [{
          id: '11111111-1111-1111-1111-111111111111', empresa_id: 'e1', empresa_nombre: 'Tienda A',
          cliente_id: 'c1', cliente_nombre: 'Valeria Sánchez', producto_id: 'p1', producto_nombre: 'Alfa',
          puntuacion: 5, comentario: 'Excelente <script>alert(1)</script>', estado: 'pendiente', motivo_rechazo: null,
          creada_en: '2027-03-10T10:00:00Z', actualizada_en: '2027-03-10T10:00:00Z',
        }],
        siguiente: null,
      },
      error: null,
    })
    const tanda = await listarOpiniones({ estado: 'pendiente', empresaId: null })
    expect(tanda.filas).toHaveLength(1)
    // El texto viene tal cual (la pantalla lo pinta como texto, nunca como HTML).
    expect(tanda.filas[0].comentario).toBe('Excelente <script>alert(1)</script>')
    expect(tanda.filas[0].cliente_nombre).toBe('Valeria Sánchez')
  })

  it('T029 (H-2): una fila fuera del contrato se descarta (no rompe la pantalla ni se ofrece moderar)', async () => {
    const base = {
      id: '11111111-1111-1111-1111-111111111111', empresa_id: 'e1', empresa_nombre: 'Tienda A',
      cliente_id: 'c1', cliente_nombre: 'Valeria', producto_id: 'p1', producto_nombre: 'Alfa',
      puntuacion: 4, comentario: 'Un comentario normal', estado: 'pendiente', motivo_rechazo: null,
      creada_en: '2027-03-10T10:00:00Z', actualizada_en: '2027-03-10T10:00:00Z',
    }
    mocks.rpc.mockResolvedValue({
      data: {
        contadores: { pendientes: 1, aceptadas: 0, rechazadas: 0 },
        filas: [
          base,
          { ...base, comentario: { no: 'es texto' } },
          { ...base, estado: 'publicada' },
          { ...base, puntuacion: 9 },
          { ...base, id: '' },
          { ...base, actualizada_en: '' },
        ],
        siguiente: null,
      },
      error: null,
    })
    const tanda = await listarOpiniones({ estado: 'todas', empresaId: null })
    expect(tanda.filas).toHaveLength(1)
    expect(tanda.filas[0].comentario).toBe('Un comentario normal')
  })

  it('T029 (H-2): contadores que no son números valen cero y un cursor incompleto no se usa', async () => {
    mocks.rpc.mockResolvedValue({
      data: { contadores: { pendientes: 'muchas', aceptadas: 2 }, filas: [], siguiente: { creada: 'x' } },
      error: null,
    })
    const tanda = await listarOpiniones({ estado: 'todas', empresaId: null })
    expect(tanda.contadores).toEqual({ pendientes: 0, aceptadas: 2, rechazadas: 0 })
    expect(tanda.siguiente).toBeNull()
  })

  it('un error de la RPC se propaga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(listarOpiniones({ estado: 'todas', empresaId: null })).rejects.toMatchObject({ code: '42501' })
  })

  it('modera con la fecha vista (bloqueo optimista) y el motivo', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'ok' }, error: null })
    await expect(moderarOpinion({ id: 'o-1', decision: 'rechazar', motivo: 'Spam', actualizadaEn: '2027-03-10T10:00:00Z' })).resolves.toEqual({ estado: 'ok' })
    expect(mocks.rpc).toHaveBeenCalledWith('moderar_opinion', {
      p_id: 'o-1', p_decision: 'rechazar', p_motivo: 'Spam', p_actualizada_en_esperada: '2027-03-10T10:00:00Z',
    })
  })

  it('distingue la opinión inexistente', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado: 'no_encontrada' }, error: null })
    await expect(moderarOpinion({ id: 'o-1', decision: 'aceptar', actualizadaEn: 'x' })).resolves.toEqual({ estado: 'no_encontrada' })
  })

  it('la bandera falla cerrada: error o ausencia cuentan como apagada', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { activa: true }, error: null })
    expect(await leerBanderaOpiniones()).toBe(true)
    mocks.maybeSingle.mockResolvedValueOnce({ data: { activa: false }, error: null })
    expect(await leerBanderaOpiniones()).toBe(false)
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: 'x' } })
    expect(await leerBanderaOpiniones()).toBe(false)
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await leerBanderaOpiniones()).toBe(false)
    // Un rechazo real de la consulta (red caída) tampoco rompe: cuenta como apagada.
    mocks.maybeSingle.mockRejectedValueOnce(new Error('red caída'))
    expect(await leerBanderaOpiniones()).toBe(false)
  })

  it('normaliza el motivo: saltos de línea y rachas de espacios pasan a un espacio y se recorta', () => {
    expect(normalizarMotivo('  Primera línea\n\nsegunda\t línea  ')).toBe('Primera línea segunda línea')
    expect(normalizarMotivo('\n \n')).toBe('')
  })

  it('cuenta el motivo en caracteres (puntos de código), como el servidor, y no en UTF-16', () => {
    expect(largoMotivo('😀'.repeat(150))).toBe(150)
    expect(largoMotivo('  hola\nmundo  ')).toBe(10)
  })

  it('traduce los errores de la base a mensajes claros', () => {
    expect(esConflictoOpinion({ code: '40001' })).toBe(true)
    expect(esSinPermisoOpiniones({ code: '42501' })).toBe(true)
    expect(mensajeDeErrorOpiniones({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO_OPINION)
    expect(mensajeDeErrorOpiniones({ code: '55000' }, 'x')).toMatch(/desactivadas/)
    expect(mensajeDeErrorOpiniones({ code: '22023', message: 'El motivo admite hasta 200 caracteres' }, 'x')).toMatch(/hasta 200 caracteres/)
    // Un motivo con caracteres no permitidos no se presenta como un problema de largo.
    const noPermitidos = mensajeDeErrorOpiniones({ code: '22023', message: 'El motivo tiene caracteres no permitidos (saltos de línea, enlaces o marcas ocultas)' }, 'x')
    expect(noPermitidos).toMatch(/caracteres no permitidos/)
    expect(noPermitidos).not.toMatch(/200/)
    expect(mensajeDeErrorOpiniones({}, 'por defecto')).toBe('por defecto')
    expect(textoPuntuacion(4)).toBe('4 sobre 5')
  })
})
