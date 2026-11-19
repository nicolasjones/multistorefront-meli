import { describe, expect, it, vi } from 'vitest'
import { TAMANO_PAGINA_HISTORIAL_COTIZACIONES, formatearFechaHoraCarga, listarCotizacionesRpc, textoPreciosCarga, tonoVariacion } from './cotizacionHistorial'

describe('tonoVariacion', () => {
  it('sube, baja o igual según el valor redondeado a un decimal', () => {
    expect(tonoVariacion(1.2)).toBe('sube')
    expect(tonoVariacion(-0.6)).toBe('baja')
    expect(tonoVariacion(0.04)).toBe('igual')
    expect(tonoVariacion(-0.04)).toBe('igual')
  })

  it('sin dato o no finito es neutro', () => {
    expect(tonoVariacion(null)).toBe('igual')
    expect(tonoVariacion(Number.NaN)).toBe('igual')
    expect(tonoVariacion(Number.POSITIVE_INFINITY)).toBe('igual')
  })
})

describe('textoPreciosCarga', () => {
  it('con recálculo cuenta los precios en singular o plural', () => {
    expect(textoPreciosCarga({ recalculoAplicado: true, preciosRecalculados: 38 })).toBe('38 precios')
    expect(textoPreciosCarga({ recalculoAplicado: true, preciosRecalculados: 1 })).toBe('1 precio')
  })

  it('sin recálculo muestra el umbral usado y asume 1 % si no se guardó', () => {
    expect(textoPreciosCarga({ recalculoAplicado: false, preciosRecalculados: 0, umbralPct: 2 })).toMatch(/Sin cambios \(< 2/)
    expect(textoPreciosCarga({ recalculoAplicado: false, preciosRecalculados: 0, umbralPct: null })).toMatch(/Sin cambios \(< 1/)
  })
})

describe('formatearFechaHoraCarga', () => {
  it('muestra día de la semana, fecha y hora de Buenos Aires', () => {
    expect(formatearFechaHoraCarga('2026-09-25T12:12:00Z')).toBe('vie 25/09 · 09:12')
  })

  it('una fecha inválida se muestra como guion', () => {
    expect(formatearFechaHoraCarga('x')).toBe('—')
  })
})

describe('listarCotizacionesRpc', () => {
  const pagina = { filas: [{ id: 'c1', cargada_en: 't', valor: '1200.5', variacion_pct: null, cargada_por_nombre: null, recalculo_aplicado: true, precios_recalculados: '3' }], siguiente_cursor: 'cur' }

  it('convierte números, deja nulos y no manda empresa si no hay', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: pagina, error: null })
    const resultado = await listarCotizacionesRpc({ rpc } as never, null)
    expect(rpc).toHaveBeenCalledWith('listar_cotizaciones', { p_limite: TAMANO_PAGINA_HISTORIAL_COTIZACIONES, p_cursor: null })
    expect(resultado.siguienteCursor).toBe('cur')
    expect(resultado.filas[0]).toEqual({ id: 'c1', cargadaEn: 't', valor: 1200.5, variacionPct: null, cargadaPorNombre: null, recalculoAplicado: true, preciosRecalculados: 3, umbralPct: null })
  })

  it('con empresa agrega el alcance y convierte el umbral guardado', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...pagina, filas: [{ ...pagina.filas[0], variacion_pct: '2.5', umbral_pct: '2' }] }, error: null })
    const { filas } = await listarCotizacionesRpc({ rpc } as never, 'cur0', 5, 'e1')
    expect(rpc).toHaveBeenCalledWith('listar_cotizaciones', { p_limite: 5, p_cursor: 'cur0', p_empresa: 'e1' })
    expect(filas[0]).toMatchObject({ variacionPct: 2.5, umbralPct: 2 })
  })

  it('propaga el error de la base', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(listarCotizacionesRpc({ rpc } as never, null)).rejects.toMatchObject({ code: '42501' })
  })
})
