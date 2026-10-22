// Orquestación pura de una importación (FR-005…FR-007): lee, valida todo y recién entonces inserta
// por lotes. Sin red ni base: el punto de entrada inyecta la inserción, así se prueba entera.
import { leerCsv, type Tabla } from './csv.js';
import type { TipoHistorial } from './mapeo.js';
import { validarTabla, type Empresa, type FilaImportable, type Rechazo } from './validar.js';
import { esXlsx, leerXlsx } from './xlsx.js';

export const TAMANO_LOTE = 1000;

export interface ConteoLote {
  nuevas: number;
  existentes: number;
}

export type InsertarLote = (filas: FilaImportable[]) => Promise<ConteoLote>;

export type ResultadoImportacion =
  | { estado: 'exitosa'; nuevas: number; existentes: number; total: number }
  | { estado: 'fallida'; motivo: string; rechazos: Rechazo[]; totalRechazos: number };

export function leerTabla(bytes: Uint8Array): Tabla {
  return esXlsx(bytes) ? leerXlsx(bytes) : leerCsv(bytes);
}

export async function importarArchivo(
  tipo: TipoHistorial,
  bytes: Uint8Array,
  empresas: readonly Empresa[],
  insertarLote: InsertarLote,
): Promise<ResultadoImportacion> {
  let tabla: Tabla;
  try {
    tabla = leerTabla(bytes);
  } catch {
    // El mensaje de la librería puede traer contenido del archivo: se descarta.
    const rechazo: Rechazo = { fila: 1, columna: '—', motivo: 'No se pudo leer el archivo (formato inválido)' };
    return { estado: 'fallida', motivo: 'ARCHIVO_ILEGIBLE', rechazos: [rechazo], totalRechazos: 1 };
  }

  const { filas, rechazos, totalRechazos } = validarTabla(tipo, tabla, empresas);
  // Todo o nada (FR-006): con una sola fila inválida no se escribe nada.
  if (totalRechazos > 0) return { estado: 'fallida', motivo: 'ARCHIVO_INVALIDO', rechazos, totalRechazos };

  let nuevas = 0;
  let existentes = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const conteo = await insertarLote(filas.slice(i, i + TAMANO_LOTE));
    nuevas += conteo.nuevas;
    existentes += conteo.existentes;
  }
  return { estado: 'exitosa', nuevas, existentes, total: filas.length };
}
