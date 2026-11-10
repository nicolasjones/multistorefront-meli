import { describe, expect, it } from 'vitest'
import { armarCsv, BOM_UTF8, nombreArchivoCsv, type ColumnaCsv } from './exportarCsv'

type Fila = { nombre: string | null; cantidad: number; fecha: string; estado: string }

const COLUMNAS: ColumnaCsv<Fila>[] = [
  { encabezado: 'Producto', valor: (f) => f.nombre },
  { encabezado: 'Cantidad', valor: (f) => f.cantidad },
  { encabezado: 'Fecha', valor: (f) => f.fecha },
  { encabezado: 'Estado', valor: (f) => f.estado },
]

const fila = (extra: Partial<Fila> = {}): Fila => ({ nombre: 'Joystick', cantidad: 6, fecha: '17/10/2026', estado: 'Sin stock', ...extra })

describe('armarCsv', () => {
  it('empieza con BOM UTF-8, separa con «;» y termina cada línea con CRLF', () => {
    const csv = armarCsv(COLUMNAS, [fila(), fila({ nombre: 'Cable', cantidad: 0 })])
    expect(csv.startsWith(BOM_UTF8)).toBe(true)
    expect(csv.slice(1)).toBe('Producto;Cantidad;Fecha;Estado\r\nJoystick;6;17/10/2026;Sin stock\r\nCable;0;17/10/2026;Sin stock\r\n')
  })

  it('escapa comillas y encierra entre comillas lo que trae «;», salto de línea o comillas', () => {
    const csv = armarCsv(COLUMNAS, [fila({ nombre: 'Mouse "pro"; 2 botones' }), fila({ nombre: 'Línea 1\nLínea 2' })])
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[1]).toBe('"Mouse ""pro""; 2 botones";6;17/10/2026;Sin stock')
    expect(csv).toContain('"Línea 1\nLínea 2";6')
  })

  it.each(['=SUMA(A1)', '+54 11 5555', '-10', '@cmd', '\tcelda', '\rcelda'])('neutraliza «%s» al inicio de un texto', (valor) => {
    const csv = armarCsv(COLUMNAS, [fila({ nombre: valor })])
    const dato = csv.slice(1).split('\r\n')[1]
    expect(dato.startsWith(`'${valor}`) || dato.startsWith(`"'${valor}`)).toBe(true)
  })

  it('no toca un texto con «=» en el medio ni un número negativo', () => {
    const csv = armarCsv(COLUMNAS, [fila({ nombre: 'a=b', cantidad: -3 })])
    expect(csv.slice(1).split('\r\n')[1]).toBe('a=b;-3;17/10/2026;Sin stock')
  })

  it('deja vacías las celdas nulas', () => {
    expect(armarCsv(COLUMNAS, [fila({ nombre: null })]).slice(1).split('\r\n')[1]).toBe(';6;17/10/2026;Sin stock')
  })

  it('sin filas devuelve solo los encabezados', () => {
    expect(armarCsv(COLUMNAS, [])).toBe(`${BOM_UTF8}Producto;Cantidad;Fecha;Estado\r\n`)
  })
})

describe('nombreArchivoCsv', () => {
  it('usa la fecha de hoy en la zona de la organización, no la UTC', () => {
    // 02:00 UTC del 26 todavía es 25 en Buenos Aires (UTC-3).
    const ahora = new Date('2026-10-26T02:00:00Z')
    expect(nombreArchivoCsv('stock-actual', ahora)).toBe('stock-actual-2026-10-25.csv')
    expect(nombreArchivoCsv('movimientos-stock', ahora)).toBe('movimientos-stock-2026-10-25.csv')
  })
})
