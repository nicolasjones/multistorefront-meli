// Lectura de la planilla: CSV (UTF-8 o Latin-1, separador `,` `;` tab o `|`) y Excel `.xlsx` (FR-005).
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/node';

export type Celda = string | number | boolean | Date | null | undefined;
export type Matriz = Celda[][];

/** El archivo no se puede leer como planilla: falla definitiva (no se reintenta). */
export class ArchivoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ArchivoInvalidoError';
  }
}

export function esXlsx(nombre: string, contenido: Buffer): boolean {
  if (/\.xlsx$/i.test(nombre)) return true;
  return contenido.length > 4 && contenido[0] === 0x50 && contenido[1] === 0x4b && contenido[2] === 0x03 && contenido[3] === 0x04;
}

/** UTF-8 (con o sin BOM); si no es válido, Windows-1252/Latin-1 que exporta el panel anterior. */
export function decodificar(contenido: Buffer): string {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(contenido);
  } catch {
    texto = new TextDecoder('windows-1252').decode(contenido);
  }
  return texto.replace(/^﻿/, '');
}

function leerCsv(contenido: Buffer): Matriz {
  const resultado = Papa.parse<string[]>(decodificar(contenido), {
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
  });
  if (resultado.errors.some((e) => e.type === 'Quotes')) {
    throw new ArchivoInvalidoError('El CSV tiene comillas sin cerrar');
  }
  return resultado.data;
}

async function leerExcel(contenido: Buffer): Promise<Matriz> {
  try {
    return (await readSheet(contenido)) as Matriz;
  } catch {
    throw new ArchivoInvalidoError('No se pudo leer la planilla Excel (.xlsx)');
  }
}

export async function leerPlanilla(contenido: Buffer, nombre: string): Promise<Matriz> {
  return esXlsx(nombre, contenido) ? leerExcel(contenido) : leerCsv(contenido);
}
