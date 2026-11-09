// CSV de cada conjunto de la exportación total. Mismo criterio que la exportación de comprobantes
// (workers/exportar-comprobantes/src/csv.ts) y que el CSV del navegador: separador `;`, BOM UTF-8, CRLF y
// neutralización de fórmulas. Los valores llegan como JSON (to_jsonb): números y booleanos conservan su tipo.
const BOM = '﻿';
const SEPARADOR = ';';
const SALTO = '\r\n';

// Las hojas de cálculo interpretan como fórmula un texto que empieza con = + - @ (o tab / retorno);
// se le antepone un apóstrofo (OWASP, «CSV injection»). Solo aplica a texto, nunca a un número.
export function neutralizarFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Celda de texto: neutraliza fórmulas y cita según RFC 4180 cuando hace falta. */
export function celdaTexto(valor: string): string {
  const texto = neutralizarFormula(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Celda de un valor JSON: null vacío, número/booleano tal cual, objeto o arreglo como JSON. */
export function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor);
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  if (typeof valor === 'string') return celdaTexto(valor);
  return celdaTexto(JSON.stringify(valor));
}

export function encabezadoCsv(columnas: readonly string[]): string {
  return BOM + columnas.map(celdaTexto).join(SEPARADOR) + SALTO;
}

export function cuerpoCsv(columnas: readonly string[], filas: readonly Record<string, unknown>[]): string {
  return filas.map((fila) => columnas.map((columna) => celda(fila[columna])).join(SEPARADOR) + SALTO).join('');
}
