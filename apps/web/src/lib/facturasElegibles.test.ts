import { beforeEach, describe, expect, it, vi } from 'vitest'

const listar = vi.hoisted(() => vi.fn())
vi.mock('./ventasComprobantes', () => ({ listarComprobantes: listar }))

import { listarFacturasElegibles, TAMANO_PAGINA_ELEGIBLES } from './facturasElegibles'

const fila = (n: number, estado: string, tipo = 'factura') => ({ id: `c${n}`, numero: String(n), tipo, estado }) as never
const filtros = { busqueda: '', estado: '', pagoId: '', envioId: '', operadorId: '', empresaId: '' }
const buenas = (c: { estado: string }) => !['borrador', 'anulada'].includes(c.estado)

describe('listarFacturasElegibles', () => {
  beforeEach(() => listar.mockReset())

  it('sigue a la página siguiente cuando la primera solo trae borradores, anuladas y notas', async () => {
    const pagina1 = Array.from({ length: TAMANO_PAGINA_ELEGIBLES }, (_, i) => fila(i, i % 2 ? 'anulada' : 'borrador'))
    const pagina2 = [fila(900, 'cobrado'), fila(901, 'deuda', 'nota_credito'), fila(902, 'pendiente')]
    listar.mockResolvedValueOnce({ comprobantes: pagina1, total: TAMANO_PAGINA_ELEGIBLES + 3 })
    listar.mockResolvedValueOnce({ comprobantes: pagina2, total: TAMANO_PAGINA_ELEGIBLES + 3 })
    const r = (await listarFacturasElegibles(filtros, buenas)).facturas
    expect(r.map((c) => c.id)).toEqual(['c900', 'c902'])
    expect(listar).toHaveBeenCalledTimes(2)
    expect(listar.mock.calls[1][1]).toBe(2)
  })

  it('corta al juntar la cantidad pedida y no pide más páginas', async () => {
    listar.mockResolvedValue({ comprobantes: Array.from({ length: 50 }, (_, i) => fila(i, 'cobrado')), total: 500 })
    const r = (await listarFacturasElegibles(filtros, buenas, 20)).facturas
    expect(r).toHaveLength(20)
    expect(listar).toHaveBeenCalledTimes(1)
  })

  it('termina cuando el listado se agota o el tope de páginas se alcanza', async () => {
    listar.mockResolvedValue({ comprobantes: [fila(1, 'anulada')], total: 1 })
    expect(await listarFacturasElegibles(filtros, buenas)).toEqual({ facturas: [], truncado: false, cancelado: false })
    expect(listar).toHaveBeenCalledTimes(1)
    listar.mockReset()
    listar.mockResolvedValue({ comprobantes: Array.from({ length: 50 }, (_, i) => fila(i, 'anulada')), total: 100000 })
    const r = await listarFacturasElegibles(filtros, buenas)
    expect(listar).toHaveBeenCalledTimes(10)
    expect(r.truncado).toBe(true)
  })

  it('una página vacía corta el bucle aunque el total diga que quedan filas', async () => {
    listar.mockResolvedValue({ comprobantes: [], total: 100000 })
    expect(await listarFacturasElegibles(filtros, buenas)).toEqual({ facturas: [], truncado: false, cancelado: false })
    expect(listar).toHaveBeenCalledTimes(1)
  })

  it('corta antes de pedir otra página cuando la persona cancela', async () => {
    let cancelar = false
    listar.mockImplementation(async () => {
      cancelar = true
      return { comprobantes: [fila(1, 'anulada')], total: 100000 }
    })
    const r = await listarFacturasElegibles(filtros, buenas, 20, () => cancelar)
    expect(listar).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ facturas: [], truncado: false, cancelado: true })
  })

  it('propaga el error de una página del bucle', async () => {
    listar.mockResolvedValueOnce({ comprobantes: Array.from({ length: 50 }, (_, i) => fila(i, 'anulada')), total: 500 })
    listar.mockRejectedValueOnce(new Error('falla'))
    await expect(listarFacturasElegibles(filtros, buenas)).rejects.toThrow('falla')
  })
})
