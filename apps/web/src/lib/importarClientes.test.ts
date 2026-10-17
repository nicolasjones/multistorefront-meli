// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsearCsv, plantillaCsv } from './importarClientes'

describe('parsearCsv', () => {
  it('parsea la plantilla con punto y coma y valida lo obligatorio', () => {
    const { filas, errores } = parsearCsv(plantillaCsv())
    expect(errores).toEqual([])
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ nombre: 'Distribuidora Norte SRL', documento: '30-00000001-1', tipo: 'mayorista' })
  })

  it('marca filas sin nombre o sin documento con su número de fila', () => {
    const csv = 'nombre;documento;tipo\nSin doc;;minorista\n;30-1;mayorista\nOK;30-2;\n'
    const { filas, errores } = parsearCsv(csv)
    expect(filas.map((f) => f.nombre)).toEqual(['OK'])
    expect(filas[0].tipo).toBe('minorista')
    expect(errores).toEqual([
      { fila: 2, motivo: 'Falta el DNI/CUIT.' },
      { fila: 3, motivo: 'Falta el nombre.' },
    ])
  })

  it('rechaza tipo y número inválidos y acepta coma como separador', () => {
    const csv = 'nombre,documento,tipo,numero\nA,30-1,premium,xx\nB,30-2,mayorista,1044\n'
    const { filas, errores } = parsearCsv(csv)
    expect(filas.map((f) => f.fila)).toEqual([3])
    expect(filas[0].numero).toBe(1044)
    expect(errores).toHaveLength(1)
    expect(errores[0].fila).toBe(2)
  })

  it('respeta comillas y saltea líneas vacías', () => {
    const csv = 'nombre;documento\n"Gómez, Juan";30-3\n\nOK;30-4\n'
    const { filas, errores } = parsearCsv(csv)
    expect(errores).toEqual([])
    expect(filas.map((f) => f.nombre)).toEqual(['Gómez, Juan', 'OK'])
  })

  it('exige la columna nombre en la cabecera', () => {
    const { errores } = parsearCsv('documento\n30-1\n')
    expect(errores).toEqual([{ fila: 1, motivo: 'Falta la columna "nombre" en la cabecera.' }])
  })
})
