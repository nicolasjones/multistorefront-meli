import { describe, expect, it } from 'vitest'
import { COLUMNAS_CSV_ERRORES, correctas, nombreArchivoErrores, resultado } from './procesosMasivos'
import { armarCsv } from './exportarCsv'

describe('[MSF-354] resultado de un proceso (CA-IMP-01-1)', () => {
  it('procesados incluye los con error: 500 filas con 20 inválidas son 480 correctas y 20 con error', () => {
    expect(correctas({ procesados: 500, con_errores: 20 })).toBe(480)
    expect(resultado({ procesados: 500, con_errores: 20 })).toBe('480 correctas y 20 con error')
  })

  it('nunca da negativos ni plural incorrecto', () => {
    expect(correctas({ procesados: 3, con_errores: 5 })).toBe(0)
    expect(resultado({ procesados: 1, con_errores: 0 })).toBe('1 correcta y 0 con error')
  })
})

describe('[MSF-354] reporte de errores en CSV (RF-IMP-01-3)', () => {
  it('trae fila, columna y motivo, con BOM y sin fórmulas ejecutables', () => {
    const csv = armarCsv(COLUMNAS_CSV_ERRORES, [
      { id: '1', fila: 7, columna: 'precio', referencia: '-SKU', motivo_sanitizado: '@mal\tdato' },
    ])
    expect(csv.startsWith('﻿Fila;Columna;Referencia;Motivo\r\n')).toBe(true)
    expect(csv).toContain("7;precio;'-SKU;'@mal\tdato\r\n")
  })

  it('el nombre del archivo es claro y sin caracteres raros', () => {
    expect(nombreArchivoErrores('Carga de Catálogo / Mayo #2', new Date('2026-11-07T15:00:00Z'))).toBe('errores-carga-de-catalogo-mayo-2-2026-11-07.csv')
    expect(nombreArchivoErrores('???', new Date('2026-11-07T15:00:00Z'))).toBe('errores-proceso-2026-11-07.csv')
  })
})
