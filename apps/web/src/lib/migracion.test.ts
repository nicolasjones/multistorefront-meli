import { describe, expect, it, vi } from 'vitest'
import {
  contarEstados,
  erroresPorMotivo,
  filasAplicables,
  leerInforme,
  leerResultadosPrevisualizacion,
  marcarFilasInconsistentes,
  marcarIdentificadoresRepetidos,
  mensajeDeErrorMigracion,
  type FilaMigracion,
  type ResultadoFila,
} from './migracion'

describe('marcarIdentificadoresRepetidos', () => {
  const fila = (numero: number, id: string): FilaMigracion => ({ fila: numero, id_externo: id, nombre: `Cliente ${numero}` })
  const resultado = (numero: number, estado: ResultadoFila['estado'] = 'nueva'): ResultadoFila => ({
    fila: numero, estado, motivo: estado === 'error' ? 'Falta el nombre o la razón social' : null,
  })

  it('marca la segunda fila válida con el mismo identificador y deja la primera', () => {
    const resultados = marcarIdentificadoresRepetidos(
      [fila(2, 'SINT-1'), fila(3, 'SINT-1'), fila(4, 'SINT-2')],
      [resultado(2), resultado(3), resultado(4, 'actualizada')],
    )
    expect(resultados).toEqual([
      { fila: 2, estado: 'nueva', motivo: null },
      { fila: 3, estado: 'error', motivo: 'El identificador está repetido en el archivo' },
      { fila: 4, estado: 'actualizada', motivo: null },
    ])
  })

  it('no cuenta como válida una fila que ya venía con error de otra validación', () => {
    const resultados = marcarIdentificadoresRepetidos(
      [fila(2, 'SINT-1'), fila(3, 'SINT-1')],
      [resultado(2, 'error'), resultado(3)],
    )
    expect(resultados[1]).toEqual({ fila: 3, estado: 'nueva', motivo: null })
  })
})

describe('filas con más columnas que el encabezado (MSF-699)', () => {
  const resultados: ResultadoFila[] = [
    { fila: 2, estado: 'nueva', motivo: null },
    { fila: 3, estado: 'nueva', motivo: null },
    { fila: 4, estado: 'nueva', motivo: null },
  ]
  const errores = [{ fila: 3, motivo: 'La fila 3 tiene 4 columnas y se esperaban 3' }]

  it('marca como error la fila que la base daría por válida', () => {
    expect(marcarFilasInconsistentes(resultados, errores)).toEqual([
      { fila: 2, estado: 'nueva', motivo: null },
      { fila: 3, estado: 'error', motivo: 'La fila 3 tiene 4 columnas y se esperaban 3' },
      { fila: 4, estado: 'nueva', motivo: null },
    ])
  })

  it('deja los resultados como están cuando no hay filas inconsistentes', () => {
    expect(marcarFilasInconsistentes(resultados, [])).toEqual(resultados)
  })

  it('deja fuera del lote las filas inconsistentes', () => {
    const filas: FilaMigracion[] = [{ fila: 2 }, { fila: 3 }, { fila: 4 }]
    expect(filasAplicables(filas, errores)).toEqual([{ fila: 2 }, { fila: 4 }])
  })
})

describe('resumen de la vista previa', () => {  const resultados: ResultadoFila[] = [
    { fila: 2, estado: 'nueva', motivo: null },
    { fila: 3, estado: 'error', motivo: 'Falta el nombre o la razón social' },
    { fila: 4, estado: 'error', motivo: 'Falta el nombre o la razón social' },
    { fila: 5, estado: 'actualizada', motivo: null },
  ]

  it('cuenta nuevos, actualizados y con error', () => {
    expect(contarEstados(resultados)).toEqual({ nueva: 1, actualizada: 1, error: 2 })
  })

  it('agrupa los errores por motivo con sus filas ordenadas', () => {
    expect(erroresPorMotivo(resultados)).toEqual([
      { motivo: 'Falta el nombre o la razón social', filas: [3, 4] },
    ])
  })
})

describe('lectura de respuestas de las RPC', () => {
  it('normaliza la vista previa y descarta entradas inválidas', () => {
    expect(leerResultadosPrevisualizacion([
      { fila: 2, estado: 'nueva', motivo: null },
      { fila: 'no-es-numero' },
      { fila: 3, estado: 'desconocido' },
    ])).toEqual([
      { fila: 2, estado: 'nueva', motivo: null },
      { fila: 3, estado: 'error', motivo: null },
    ])
  })

  it('normaliza el informe de cierre', () => {
    expect(leerInforme({
      carga: 'carga-1', entidad: 'clientes', archivo: 'clientes.csv', estado: 'aplicada', error: null,
      filas_total: 2, nuevos: 1, actualizados: 0, con_error: 1,
      errores: [{ fila: 3, motivo: 'Falta el nombre' }, { fila: 'x' }],
    })).toMatchObject({
      carga: 'carga-1', estado: 'aplicada', filas_total: 2, nuevos: 1, con_error: 1,
      errores: [{ fila: 3, motivo: 'Falta el nombre' }],
    })
  })

  it('traduce códigos de autorización sin filtrar detalles técnicos', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeErrorMigracion({ code: '42501' }, 'por defecto')).toBe('Solo un administrador puede importar datos.')
    expect(mensajeDeErrorMigracion({ message: 'relation "x" does not exist' }, 'No pudimos importar.')).toBe('No pudimos importar.')
    mensajeDeErrorMigracion({ code: 'XX000', details: 'Key (documento)=(20111111111)' }, 'No pudimos importar.')
    expect(consola).toHaveBeenCalled()
    expect(JSON.stringify(consola.mock.calls)).not.toContain('20111111111')
    consola.mockRestore()
  })
})
