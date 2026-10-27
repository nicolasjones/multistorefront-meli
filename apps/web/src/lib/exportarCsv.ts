import { descargarArchivo, neutralizarFormula } from './exportarClientes'
import { hoyEnOrganizacion } from './periodosRanking'

// Exportación a CSV de Stock actual y Movimientos (F-STK-08, FR-102…FR-106).
// Formato que abre bien en Excel con configuración regional en castellano:
// UTF-8 con BOM, separador `;`, fin de línea CRLF y comillas escapadas.

export const BOM_UTF8 = '﻿'
export const SEPARADOR_CSV = ';'
export const FIN_DE_LINEA_CSV = '\r\n'
export const TOPE_FILAS_EXPORTACION = 100_000

// Una columna de datos de la tabla: la misma declaración sirve a la pantalla y al CSV (FR-104).
export type ColumnaCsv<T> = {
  encabezado: string
  valor: (fila: T) => string | number | null
}

// Los números salen tal cual; todo texto pasa por `neutralizarFormula` antes de escaparse (FR-106).
function campo(valor: string | number | null): string {
  if (valor === null || valor === '') return ''
  const texto = typeof valor === 'number' ? String(valor) : neutralizarFormula(valor)
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function armarCsv<T>(columnas: readonly ColumnaCsv<T>[], filas: readonly T[]): string {
  const lineas = [
    columnas.map((columna) => campo(columna.encabezado)).join(SEPARADOR_CSV),
    ...filas.map((fila) => columnas.map((columna) => campo(columna.valor(fila))).join(SEPARADOR_CSV)),
  ]
  return BOM_UTF8 + lineas.join(FIN_DE_LINEA_CSV) + FIN_DE_LINEA_CSV
}

// `stock-actual-2026-10-25.csv`: la fecha es la de hoy en la zona de la organización (FR-105).
export function nombreArchivoCsv(prefijo: 'stock-actual' | 'movimientos-stock', ahora: Date = new Date()): string {
  return `${prefijo}-${hoyEnOrganizacion(ahora)}.csv`
}

export function descargarCsv(contenido: string, nombre: string): void {
  descargarArchivo(new Blob([contenido], { type: 'text/csv;charset=utf-8' }), nombre)
}
