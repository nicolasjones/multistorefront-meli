import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabaseClient: { rpc } }))

import {
  facturarPresupuesto,
  hoyEnArgentina,
  listarPresupuestos,
  mensajeDeAceptarPresupuesto,
  mensajeDeFacturarPresupuesto,
  obtenerVinculoPresupuesto,
  puedeFacturarPresupuesto,
} from './ventasPresupuestos'

const base = { busqueda: '', estado: 'todos' as const, empresaId: null, pagina: 1, tamano: 10 }

describe('listarPresupuestos', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [], error: null })
  })

  it('manda p_origen nulo con «todos» o sin origen, y el canal elegido en los demás casos', async () => {
    await listarPresupuestos(base)
    await listarPresupuestos({ ...base, origen: 'todos' })
    await listarPresupuestos({ ...base, origen: 'tienda' })
    await listarPresupuestos({ ...base, origen: 'panel' })
    expect(rpc.mock.calls.map((c) => c[1].p_origen)).toEqual([null, null, 'tienda', 'panel'])
    expect(rpc.mock.calls[0][0]).toBe('listar_presupuestos')
  })

  it('el total sale de `filas` de la base (el filtro cuenta antes de paginar)', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'p-1', numero: '1', total: '10', filas: '37' }], error: null })
    const pagina = await listarPresupuestos({ ...base, origen: 'tienda', pagina: 2 })
    expect(pagina.total).toBe(37)
    expect(pagina.presupuestos[0].total).toBe(10)
  })
})

describe('mensajeDeAceptarPresupuesto', () => {
  it('muestra el texto de la RPC cuando el presupuesto está vencido o ya no se acepta', () => {
    const vencido = { code: '55000', message: 'El presupuesto está vencido y no se puede aceptar' }
    expect(mensajeDeAceptarPresupuesto(vencido, 'x')).toBe('El presupuesto está vencido y no se puede aceptar')
    // Texto con cola del servidor: se devuelve la constante, no el mensaje crudo.
    expect(mensajeDeAceptarPresupuesto({ ...vencido, message: `${vencido.message} (id 123)` }, 'x')).toBe(vencido.message)
    const otro = { code: '55000', message: 'Este presupuesto ya no se puede aceptar' }
    expect(mensajeDeAceptarPresupuesto(otro, 'x')).toBe(otro.message)
  })

  it('un 55000 con texto desconocido no filtra el mensaje crudo y cae al genérico de comprobantes', () => {
    expect(mensajeDeAceptarPresupuesto({ code: '55000', message: 'relation x' }, 'x')).toMatch(/cerrado/)
  })
})

describe('facturar presupuesto', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('llama a la RPC con el presupuesto y devuelve la factura', async () => {
    rpc.mockResolvedValue({ data: { id: 'f-1', numero: '00000031', estado: 'borrador' }, error: null })
    expect(await facturarPresupuesto('p-1')).toEqual({ id: 'f-1', numero: '00000031', estado: 'borrador' })
    expect(rpc).toHaveBeenCalledWith('facturar_presupuesto', { p_presupuesto_id: 'p-1' })
  })

  it('propaga el error de la base y rechaza una respuesta sin factura', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000' } })
    await expect(facturarPresupuesto('p-1')).rejects.toEqual({ code: '55000' })
    rpc.mockResolvedValue({ data: {}, error: null })
    await expect(facturarPresupuesto('p-1')).rejects.toThrow('La base no devolvió el presupuesto')
  })

  it('puedeFacturarPresupuesto: aceptado, vigente y con permiso de edición', () => {
    const base = { estado: 'aceptado', puede_editar: true, valido_hasta: null as string | null }
    expect(puedeFacturarPresupuesto(base, '2026-11-18')).toBe(true)
    expect(puedeFacturarPresupuesto({ ...base, valido_hasta: '2026-11-18' }, '2026-11-18')).toBe(true)
    expect(puedeFacturarPresupuesto({ ...base, valido_hasta: '2026-11-17' }, '2026-11-18')).toBe(false)
    expect(puedeFacturarPresupuesto({ ...base, estado: 'pendiente' }, '2026-11-18')).toBe(false)
    expect(puedeFacturarPresupuesto({ ...base, estado: 'convertido' }, '2026-11-18')).toBe(false)
    expect(puedeFacturarPresupuesto({ ...base, puede_editar: false }, '2026-11-18')).toBe(false)
  })

  it('hoyEnArgentina usa la fecha de Buenos Aires, no la de UTC', () => {
    expect(hoyEnArgentina(new Date('2026-11-18T02:30:00Z'))).toBe('2026-11-17')
    expect(hoyEnArgentina(new Date('2026-11-18T03:30:00Z'))).toBe('2026-11-18')
  })

  it('mensajeDeFacturarPresupuesto muestra los textos de negocio conocidos y nada del servidor desconocido', () => {
    const conocidos = [
      ['55000', 'Aceptá el presupuesto antes de facturarlo'],
      ['55000', 'El presupuesto está vencido y no se puede facturar'],
      ['55000', 'Este presupuesto ya no se puede facturar'],
      ['22023', 'El presupuesto no tiene líneas para facturar'],
      ['22023', 'El cliente del presupuesto ya no está disponible'],
      ['42501', 'Tu rol no puede facturar presupuestos de esta tienda'],
    ] as const
    for (const [code, message] of conocidos) expect(mensajeDeFacturarPresupuesto({ code, message }, 'x')).toBe(message)
    const producto = 'El producto «Cable USB» ya no está activo: reactivalo para facturar el presupuesto'
    expect(mensajeDeFacturarPresupuesto({ code: '22023', message: producto }, 'x')).toBe(producto)
    expect(mensajeDeFacturarPresupuesto({ code: '55000', message: 'texto interno raro' }, 'x')).toMatch(/cerrado/)
    expect(mensajeDeFacturarPresupuesto({ code: '22023', message: 'detalle de tabla secreta' }, 'x')).not.toMatch(/secreta/)
    expect(mensajeDeFacturarPresupuesto({ code: '42501', message: 'otro' }, 'x')).toMatch(/permiso/)
    expect(mensajeDeFacturarPresupuesto({ code: 'P0002' }, 'x')).toMatch(/no existe/)
    expect(mensajeDeFacturarPresupuesto(null, 'No pudimos facturar')).toBe('No pudimos facturar')
  })

  it('obtenerVinculoPresupuesto devuelve la primera fila o null', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await obtenerVinculoPresupuesto('p-1')).toBeNull()
    const fila = { presupuesto_id: 'p-1', presupuesto_numero: '1', factura_id: 'f-1', factura_numero: '2', factura_estado: 'borrador' }
    rpc.mockResolvedValue({ data: [fila], error: null })
    expect(await obtenerVinculoPresupuesto('p-1')).toEqual(fila)
    expect(rpc).toHaveBeenLastCalledWith('obtener_vinculo_presupuesto', { p_id: 'p-1' })
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(obtenerVinculoPresupuesto('p-1')).rejects.toEqual({ code: '42501' })
  })
})
