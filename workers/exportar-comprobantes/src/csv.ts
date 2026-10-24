// Armado del CSV de comprobantes. Replica el criterio de `apps/web/src/lib/exportarClientes.ts`
// (neutralización de fórmulas) y de la exportación inmediata: separador `;`, BOM UTF-8, CRLF.
export const ENCABEZADOS = ['Comprobante', 'Tipo', 'Tienda', 'Fecha', 'Cliente', 'Operador', 'Estado', 'Pago', 'Envío', 'Total'] as const;
export const BOM = '﻿';
export const SEPARADOR = ';';
export const SALTO = '\r\n';

// Mismas etiquetas que el CSV del navegador (apps/web/src/lib/exportarComprobantes.ts).
const ETIQUETA_TIPO: Readonly<Record<string, string>> = { factura: 'Factura', nota_credito: 'Nota de crédito', presupuesto: 'Presupuesto' };

/** Fila tal como la devuelve `private.filas_exportacion_comprobantes` (sin la columna `filas`). */
export interface FilaComprobante {
  numero: string | null;
  tipo: string | null;
  empresa: string | null;
  fecha: string | Date | null;
  cliente: string | null;
  operador: string | null;
  estado_etiqueta: string | null;
  forma_pago: string | null;
  envio: string | null;
  total: string | number | null;
}

// Las hojas de cálculo interpretan como fórmula un texto que empieza con = + - @ (o tab / retorno);
// se le antepone un apóstrofo (OWASP, «CSV injection»). Solo aplica a texto, nunca al Total numérico.
export function neutralizarFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Celda de texto: neutraliza fórmulas y cita según RFC 4180 cuando hace falta. */
export function celdaTexto(valor: string | null | undefined): string {
  const texto = neutralizarFormula(valor ?? '');
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** `2026-10-24` (o Date) -> `24/10/2026`. */
export function formatearFecha(fecha: string | Date | null): string {
  if (fecha === null || fecha === undefined) return '';
  if (fecha instanceof Date) {
    const d = String(fecha.getDate()).padStart(2, '0');
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${fecha.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha;
}

/** Total con coma decimal y dos decimales; el signo negativo (nota de crédito) se conserva sin apóstrofo. */
export function formatearTotal(total: string | number | null): string {
  if (total === null || total === undefined || total === '') return '';
  const n = Number(total);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

export function lineaCsv(fila: FilaComprobante): string {
  return [
    celdaTexto(fila.numero),
    celdaTexto(fila.tipo === null ? null : (ETIQUETA_TIPO[fila.tipo] ?? fila.tipo)),
    celdaTexto(fila.empresa),
    formatearFecha(fila.fecha),
    celdaTexto(fila.cliente),
    celdaTexto(fila.operador),
    celdaTexto(fila.estado_etiqueta),
    celdaTexto(fila.forma_pago),
    celdaTexto(fila.envio),
    formatearTotal(fila.total),
  ].join(SEPARADOR);
}

export function encabezadoCsv(): string {
  return BOM + ENCABEZADOS.map(celdaTexto).join(SEPARADOR) + SALTO;
}

export function cuerpoCsv(filas: FilaComprobante[]): string {
  return filas.map((f) => lineaCsv(f) + SALTO).join('');
}
