import { describe, expect, it, vi } from 'vitest'
import {
  aFechaHoraLocal,
  anularPromocion,
  guardarPromocion,
  leerPromociones,
  mapearPromocion,
  mensajeErrorPromocion,
  ordenarPromociones,
  parsearFechaHora,
  validarPromocion,
  type Promocion,
} from './promociones'

const base = (cambios: Partial<Promocion>): Promocion => ({
  id: 'p1', empresaId: 'e1', empresaNombre: 'Tienda A', productoId: 'a1', productoNombre: 'Alfa', productoSku: 'PR-1',
  precioPromocional: 800, desde: '2026-11-10T12:00:00Z', hasta: '2026-11-12T12:00:00Z', estado: 'programada',
  precioNormal: 1331, precioVigente: 1331, actualizadoEn: '2026-11-07T10:00:00.123456+00:00', ...cambios,
})

describe('promociones · mapeo y orden', () => {
  it('convierte los importes de texto a número y conserva updated_at tal cual', () => {
    const p = mapearPromocion({
      id: 'p1', empresa_id: 'e1', empresa_nombre: 'Tienda A', producto_id: 'a1', producto_nombre: 'Alfa', producto_sku: null,
      precio_promocional: '800.00', desde: 'd', hasta: 'h', estado: 'vigente', precio_normal: '1331', precio_vigente: null,
      updated_at: '2026-11-07T10:00:00.123456+00:00',
    })
    expect(p.precioPromocional).toBe(800)
    expect(p.precioNormal).toBe(1331)
    expect(p.precioVigente).toBeNull()
    expect(p.actualizadoEn).toBe('2026-11-07T10:00:00.123456+00:00')
  })

  it('ordena vigentes, programadas, vencidas y anuladas; dentro del grupo por fecha', () => {
    const lista = ordenarPromociones([
      base({ id: 'anulada', estado: 'anulada' }),
      base({ id: 'vencida', estado: 'vencida' }),
      base({ id: 'prog-tarde', estado: 'programada', desde: '2026-12-01T00:00:00Z' }),
      base({ id: 'prog-temprano', estado: 'programada', desde: '2026-11-20T00:00:00Z' }),
      base({ id: 'vigente', estado: 'vigente' }),
    ])
    expect(lista.map((p) => p.id)).toEqual(['vigente', 'prog-temprano', 'prog-tarde', 'vencida', 'anulada'])
  })
})

describe('promociones · validación (FR-016)', () => {
  const ahora = new Date('2026-11-07T12:00:00')
  const ok = { productoId: 'a1', precioTexto: '1.250,50', desdeTexto: '2026-11-10T09:00', hastaTexto: '2026-11-12T09:00' }

  it('un alta correcta no tiene errores (el precio acepta coma decimal)', () => {
    expect(validarPromocion({ ...ok, precioTexto: '1250,50' }, ahora)).toEqual({})
  })

  it('exige producto, precio mayor a 0 y fechas', () => {
    const errores = validarPromocion({ productoId: '', precioTexto: '0', desdeTexto: '', hastaTexto: '' }, ahora)
    expect(errores.producto).toBeDefined()
    expect(errores.precio).toBe('Ingresá un precio mayor a 0')
    expect(errores.desde).toBeDefined()
    expect(errores.hasta).toBeDefined()
  })

  it('rechaza un precio con formato inválido', () => {
    expect(validarPromocion({ ...ok, precioTexto: 'abc' }, ahora).precio).toBeDefined()
    expect(validarPromocion({ ...ok, precioTexto: '-5' }, ahora).precio).toBeDefined()
  })

  it('el fin tiene que ser posterior al inicio y futuro', () => {
    expect(validarPromocion({ ...ok, hastaTexto: '2026-11-10T09:00' }, ahora).hasta).toBe('La fecha de fin tiene que ser posterior a la de inicio')
    expect(validarPromocion({ ...ok, desdeTexto: '2026-11-01T09:00', hastaTexto: '2026-11-05T09:00' }, ahora).hasta).toBe('La fecha de fin tiene que ser futura')
  })
})

describe('promociones · fechas', () => {
  it('ida y vuelta entre el input datetime-local y el instante', () => {
    const fecha = parsearFechaHora('2026-11-10T09:30')
    expect(fecha).not.toBeNull()
    expect(aFechaHoraLocal((fecha as Date).toISOString())).toBe('2026-11-10T09:30')
    expect(parsearFechaHora('')).toBeNull()
    expect(parsearFechaHora('no es fecha')).toBeNull()
  })
})

describe('promociones · acceso a la base', () => {
  it('lee la vista de estado, filtra por empresa si se pide y ordena', async () => {
    const returns = vi.fn().mockResolvedValue({
      data: [
        { id: 'b', empresa_id: 'e1', empresa_nombre: 'A', producto_id: 'x', producto_nombre: 'X', producto_sku: null, precio_promocional: 1, desde: '2026-11-02T00:00:00Z', hasta: 'h', estado: 'vencida', precio_normal: 2, precio_vigente: 2, updated_at: 'u' },
        { id: 'a', empresa_id: 'e1', empresa_nombre: 'A', producto_id: 'y', producto_nombre: 'Y', producto_sku: null, precio_promocional: 1, desde: '2026-11-01T00:00:00Z', hasta: 'h', estado: 'vigente', precio_normal: 2, precio_vigente: 1, updated_at: 'u' },
      ],
      error: null,
    })
    const eq = vi.fn()
    const consulta = { eq, order: vi.fn(), limit: vi.fn(), returns }
    eq.mockReturnValue(consulta)
    consulta.order.mockReturnValue(consulta)
    consulta.limit.mockReturnValue(consulta)
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(consulta) })
    const cliente = { from } as never
    const lista = await leerPromociones(cliente, 'e1')
    expect(from).toHaveBeenCalledWith('promociones_precio_estado')
    expect(eq).toHaveBeenCalledWith('empresa_id', 'e1')
    expect(lista.map((p) => p.id)).toEqual(['a', 'b'])
    eq.mockClear()
    await leerPromociones(cliente, null)
    expect(eq).not.toHaveBeenCalled()
  })

  it('guardar envía la RPC con los instantes ISO y el updated_at leído', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null })
    await guardarPromocion({ rpc } as never, {
      id: 'p1', empresaId: 'e1', productoId: 'a1', precioTexto: '800,5', desdeTexto: '2026-11-10T09:00', hastaTexto: '2026-11-12T09:00',
      actualizadoEn: '2026-11-07T10:00:00.123456+00:00',
    })
    const args = rpc.mock.calls[0]
    expect(args[0]).toBe('guardar_promocion_precio')
    expect(args[1]).toMatchObject({ p_id: 'p1', p_empresa: 'e1', p_producto: 'a1', p_precio: 800.5, p_actualizado: '2026-11-07T10:00:00.123456+00:00' })
    expect(args[1].p_desde).toBe(new Date('2026-11-10T09:00').toISOString())
  })

  it('anular envía el id y el updated_at; un error de la base se propaga', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40001', message: 'x' } })
    await expect(anularPromocion({ rpc } as never, { id: 'p1', actualizadoEn: 'u' })).rejects.toMatchObject({ code: '40001' })
    expect(rpc).toHaveBeenCalledWith('anular_promocion_precio', { p_id: 'p1', p_actualizado: 'u' })
  })
})

describe('promociones · mensajes de error', () => {
  it('traduce solape, conflicto y permiso', () => {
    expect(mensajeErrorPromocion({ code: '23P01' }, 'x')).toMatch(/se solapa/)
    expect(mensajeErrorPromocion({ code: '40001' }, 'x')).toMatch(/Otra persona/)
    expect(mensajeErrorPromocion({ code: '42501' }, 'x')).toMatch(/rol/)
    expect(mensajeErrorPromocion({ code: '22023', message: 'La promoción ya venció y no se puede editar' }, 'x')).toBe('La promoción ya venció y no se puede editar')
    expect(mensajeErrorPromocion(new Error('boom'), 'por defecto')).toBe('por defecto')
  })
})
