import { describe, expect, it, vi } from 'vitest'
import {
  ErrorCsv,
  analizarCsv,
  descargarCsv,
  detectarSeparador,
  erroresDeColumnas,
  escaparCampoCsv,
  generarCsv,
  leerCsvUtf8,
  TAMANO_MAXIMO_BYTES,
} from './migracionCsv'

const archivo = (contenido: string, nombre = 'clientes.csv') => new File([contenido], nombre, { type: 'text/csv' })

describe('analizarCsv', () => {
  it('lee encabezados y filas numerando desde el encabezado como fila 1', () => {
    const csv = analizarCsv('nombre,id_externo\nUno,SINT-1\nDos,SINT-2\n')
    expect(csv.encabezados).toEqual(['nombre', 'id_externo'])
    expect(csv.filas).toEqual([
      { numero: 2, celdas: ['Uno', 'SINT-1'] },
      { numero: 3, celdas: ['Dos', 'SINT-2'] },
    ])
  })

  it('soporta comillas, comas y saltos de línea dentro de un campo', () => {
    const csv = analizarCsv('nombre,direccion\n"Cliente, S.A.","Calle 1\nPiso 2"\n')
    expect(csv.filas[0].celdas).toEqual(['Cliente, S.A.', 'Calle 1\nPiso 2'])
  })

  it('desescapa comillas dobles', () => {
    const csv = analizarCsv('nombre,nota\n"Cliente ""el bueno""",ok\n')
    expect(csv.filas[0].celdas[0]).toBe('Cliente "el bueno"')
  })

  it('acepta CRLF, BOM de Excel y punto y coma como separador', () => {
    const texto = '\uFEFFnombre;id_externo\r\nUno;SINT-1\r\n'
    expect(detectarSeparador(texto)).toBe(';')
    const csv = analizarCsv(texto)
    expect(csv.separador).toBe(';')
    expect(csv.encabezados).toEqual(['nombre', 'id_externo'])
    expect(csv.filas[0].celdas).toEqual(['Uno', 'SINT-1'])
  })

  it('descarta las líneas en blanco sin correr la numeración de las demás', () => {
    const csv = analizarCsv('nombre,id_externo\nUno,SINT-1\n\nTres,SINT-3\n')
    expect(csv.filas.map((fila) => fila.numero)).toEqual([2, 4])
  })

  it('rellena columnas faltantes y recorta los valores', () => {
    const csv = analizarCsv('nombre,documento\n  Uno  \n')
    expect(csv.filas[0].celdas).toEqual(['Uno', ''])
  })

  it('marca la fila con más columnas que el encabezado y no descarta las celdas sobrantes (MSF-699)', () => {
    // Export de Excel con punto y coma: la fila trae una celda de más.
    const csv = analizarCsv('id_externo;nombre\n1;Calle 1, piso 2;extra\n')
    expect(csv.filas[0].error).toBe('La fila 2 tiene 3 columnas y se esperaban 2')
    // Nada se descarta: las celdas sobrantes quedan en la fila.
    expect(csv.filas[0].celdas).toEqual(['1', 'Calle 1, piso 2', 'extra'])
  })

  it('marca la fila con una coma sin escapar en un valor (MSF-699)', () => {
    const csv = analizarCsv('id_externo,nombre\n1,Cliente, S.A.\n')
    expect(csv.filas[0].error).toBe('La fila 2 tiene 3 columnas y se esperaban 2')
    expect(csv.filas[0].celdas).toEqual(['1', 'Cliente', 'S.A.'])
  })

  it('no marca la fila cuando las celdas sobrantes están vacías (coma final)', () => {
    const csv = analizarCsv('id_externo,nombre\n1,Cliente,\n')
    expect(csv.filas[0].error).toBeUndefined()
    expect(csv.filas[0].celdas).toEqual(['1', 'Cliente', ''])
  })

  it('marca la fila cuando una celda vacía precede al dato sobrante y cuenta el ancho real (MSF-699)', () => {
    const csv = analizarCsv('id_externo,nombre,documento\n1,Cliente,,20300123456\n')
    expect(csv.filas[0].error).toBe('La fila 2 tiene 4 columnas y se esperaban 3')
  })

  it('no marca la fila cuando tiene menos columnas que el encabezado', () => {
    const csv = analizarCsv('id_externo,nombre,documento\n1,Cliente\n')
    expect(csv.filas[0].error).toBeUndefined()
  })

  it('devuelve los errores de columna por fila', () => {
    const csv = analizarCsv('id_externo,nombre\n1,Cliente, S.A.\n2,Otro\n3,Uno, Dos, Tres\n')
    expect(erroresDeColumnas(csv)).toEqual([
      { fila: 2, motivo: 'La fila 2 tiene 3 columnas y se esperaban 2' },
      { fila: 4, motivo: 'La fila 4 tiene 4 columnas y se esperaban 2' },
    ])
  })

  it('nombra las columnas sin encabezado en vez de perderlas', () => {
    const csv = analizarCsv('nombre,,correo\nUno,x@example.com,dos\n')
    expect(csv.encabezados).toEqual(['nombre', 'Columna 2', 'correo'])
  })

  it('falla con un mensaje claro si el archivo está vacío o sin filas', () => {
    expect(() => analizarCsv('   \n')).toThrow(new ErrorCsv('El archivo está vacío.'))
    expect(() => analizarCsv('nombre,id_externo\n')).toThrow(new ErrorCsv('El archivo no tiene filas para importar.'))
  })

  it('falla si hay comillas sin cerrar', () => {
    expect(() => analizarCsv('nombre\n"Cliente\n')).toThrow(/comillas sin cerrar/)
  })
})

describe('leerCsvUtf8', () => {
  it('lee un archivo CSV UTF-8', async () => {
    const csv = await leerCsvUtf8(archivo('nombre\nSintético\n'))
    expect(csv.filas[0].celdas).toEqual(['Sintético'])
  })

  it('rechaza archivos que no son .csv', async () => {
    await expect(leerCsvUtf8(archivo('nombre\nUno\n', 'clientes.xlsx'))).rejects.toThrow(/no es un archivo \.csv/)
  })

  it('rechaza un archivo vacío antes de parsearlo', async () => {
    await expect(leerCsvUtf8(new File([], 'clientes.csv'))).rejects.toThrow(/está vacío/)
  })

  it('rechaza un archivo que pasa el tope de tamaño sin leerlo', async () => {
    const enorme = { name: 'clientes.csv', size: TAMANO_MAXIMO_BYTES + 1, arrayBuffer: () => Promise.reject(new Error('no debe leerse')) }
    await expect(leerCsvUtf8(enorme)).rejects.toThrow(/supera los 25 MB/)
  })

  it('rechaza bytes que no son UTF-8 válido', async () => {
    const invalido = new File([new Uint8Array([0xff, 0xfe, 0x00])], 'clientes.csv')
    await expect(leerCsvUtf8(invalido)).rejects.toThrow(/no está en UTF-8/)
  })
})

describe('plantilla CSV', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    expect(escaparCampoCsv('Nombre o razón social')).toBe('Nombre o razón social')
    expect(escaparCampoCsv('Uno, Dos')).toBe('"Uno, Dos"')
    expect(escaparCampoCsv('Di "hola"')).toBe('"Di ""hola"""')
  })

  it('genera solo los encabezados, en orden', () => {
    expect(generarCsv(['Identificador del panel actual', 'Nombre o razón social']))
      .toBe('Identificador del panel actual,Nombre o razón social\n')
  })

  it('descarga con un enlace temporal y libera la URL', () => {
    const crear = vi.fn(() => 'blob:prueba')
    const revocar = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: crear, revokeObjectURL: revocar })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    descargarCsv('clientes.csv', 'nombre\nUno\n')

    expect(crear).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revocar).toHaveBeenCalledWith('blob:prueba')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
