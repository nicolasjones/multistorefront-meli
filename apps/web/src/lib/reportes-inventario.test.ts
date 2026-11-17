import { describe, expect, it } from 'vitest'
import { NOMBRE_REPORTE_PRODUCTOS_STOCK, NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES, tableroProductosStock } from './reportes-inventario'

describe('tableroProductosStock', () => {
  it('elige el tablero con costos solo si la base lo lista para la persona', () => {
    const resultado = tableroProductosStock([{ nombre: 'Otro' }, { nombre: NOMBRE_REPORTE_PRODUCTOS_STOCK }])
    expect(resultado).toEqual({ nombre: NOMBRE_REPORTE_PRODUCTOS_STOCK, conCostos: true })
  })

  it('cae a la versión de cantidades cuando solo hay esa o no hay ninguna', () => {
    const soloCantidades = tableroProductosStock([{ nombre: NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES }])
    expect(soloCantidades).toEqual({ nombre: NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES, conCostos: false })
    expect(tableroProductosStock([]).conCostos).toBe(false)
  })

  it('no confunde el nombre de cantidades con el de costos', () => {
    expect(NOMBRE_REPORTE_PRODUCTOS_STOCK_CANTIDADES).not.toBe(NOMBRE_REPORTE_PRODUCTOS_STOCK)
    expect(tableroProductosStock([{ nombre: `${NOMBRE_REPORTE_PRODUCTOS_STOCK} ` }]).conCostos).toBe(false)
  })
})
