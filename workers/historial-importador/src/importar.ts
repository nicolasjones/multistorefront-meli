// Orquestación de la importación (FR-005…FR-007) sobre el contrato de workers (workers/CONTRATO.md):
// 0 = éxito; 78 = falla no reintentable (validación, ejecución cerrada, configuración); cualquier
// otra excepción es técnica y la reintenta el flow (la inserción es idempotente).
import type { Tipo } from './campos.js';
import { TIPOS } from './campos.js';
import { ArchivoInvalidoError, leerPlanilla } from './lector.js';
import { validarPlanilla, type FilaValida, type Rechazo } from './validar.js';

export const SALIDA_OK = 0;
export const SALIDA_NO_REINTENTABLE = 78;
/** Rechazos que se guardan en el detalle de la ejecución; el total real va aparte. */
export const MAX_RECHAZOS_EN_DETALLE = 100;
const TAMANO_LOTE = 1000;
const MAX_FILAS_POR_DEFECTO = 200_000;

export interface DatosImportacion {
  tipo: string;
  archivo: string;
}

/** Todo lo que el importador necesita del exterior: facilita probarlo sin base ni Storage. */
export interface Puertos {
  enCurso(ejecucionId: string): Promise<boolean>;
  datos(ejecucionId: string): Promise<DatosImportacion>;
  tiendas(ejecucionId: string): Promise<string[]>;
  descargar(archivo: string): Promise<Buffer>;
  insertarLote(ejecucionId: string, tipo: Tipo, filas: FilaValida[]): Promise<{ nuevas: number; existentes: number }>;
  cerrar(ejecucionId: string, estado: 'exitosa' | 'fallida', motivo: string, detalle: Record<string, unknown>): Promise<void>;
  evento(etapa: string, estado: 'iniciada' | 'completada' | 'fallida', mensaje?: string): void;
}

export interface Salida {
  codigo: number;
  /** Línea para stderr, ya sanitizada (`<MOTIVO>:<id>`). */
  stderr?: string;
}

export interface Opciones {
  tamanoLote?: number;
  maxFilas?: number;
}

function esTipo(valor: string): valor is Tipo {
  return (TIPOS as readonly string[]).includes(valor);
}

async function cerrarFallida(
  puertos: Puertos,
  ejecucionId: string,
  tipo: string,
  rechazos: Rechazo[],
  truncado: boolean,
  totalFilas: number,
): Promise<Salida> {
  await puertos.cerrar(ejecucionId, 'fallida', `VALIDACION_FALLIDA: ${rechazos.length}${truncado ? '+' : ''} rechazos`, {
    tipo,
    total_filas: totalFilas,
    total_rechazos: rechazos.length,
    rechazos_truncados: truncado,
    rechazos: rechazos.slice(0, MAX_RECHAZOS_EN_DETALLE),
  });
  puertos.evento('validacion', 'fallida', `${rechazos.length} rechazos`);
  return { codigo: SALIDA_NO_REINTENTABLE, stderr: `VALIDACION_FALLIDA:${ejecucionId}` };
}

export async function importarHistorial(ejecucionId: string, puertos: Puertos, opciones: Opciones = {}): Promise<Salida> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;
  const maxFilas = opciones.maxFilas ?? MAX_FILAS_POR_DEFECTO;

  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso (un reintento tardío no repite nada).
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  const datos = await puertos.datos(ejecucionId);
  if (!esTipo(datos.tipo)) {
    puertos.evento('inicio', 'fallida', 'Tipo de importación desconocido');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${ejecucionId}` };
  }
  const tipo = datos.tipo;

  puertos.evento('validacion', 'iniciada');
  let matriz;
  try {
    matriz = await leerPlanilla(await puertos.descargar(datos.archivo), datos.archivo);
  } catch (error) {
    if (error instanceof ArchivoInvalidoError) {
      return cerrarFallida(puertos, ejecucionId, tipo, [{ fila: 1, columna: '(archivo)', motivo: error.message }], false, 0);
    }
    throw error;
  }

  const validacion = validarPlanilla(tipo, matriz, await puertos.tiendas(ejecucionId), maxFilas);
  if (validacion.rechazos.length > 0) {
    return cerrarFallida(puertos, ejecucionId, tipo, validacion.rechazos, validacion.truncado, Math.max(matriz.length - 1, 0));
  }
  puertos.evento('validacion', 'completada', `${validacion.filas.length} filas válidas`);

  puertos.evento('insercion', 'iniciada');
  let nuevas = 0;
  let existentes = 0;
  for (let desde = 0; desde < validacion.filas.length; desde += tamanoLote) {
    const resultado = await puertos.insertarLote(ejecucionId, tipo, validacion.filas.slice(desde, desde + tamanoLote));
    nuevas += resultado.nuevas;
    existentes += resultado.existentes;
  }
  puertos.evento('insercion', 'completada', `${nuevas} nuevas, ${existentes} existentes`);

  await puertos.cerrar(ejecucionId, 'exitosa', `IMPORTADAS:${nuevas}`, {
    tipo,
    total_filas: validacion.filas.length,
    nuevas,
    existentes,
  });
  return { codigo: SALIDA_OK };
}

/** Lee la entrada del contrato (`ORGANIZACION_ID`, `EJECUCION_ID`) y delega; `crear` arma los puertos reales. */
export async function ejecutarDesdeEntorno(
  env: Record<string, string | undefined>,
  crear: () => { puertos: Puertos; cerrar: () => Promise<void> },
  opciones: Opciones = {},
): Promise<Salida> {
  const ejecucionId = env.EJECUCION_ID;
  const identificador = env.CONEXION_ID || ejecucionId || 'desconocida';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!env.ORGANIZACION_ID || !ejecucionId || !uuid.test(ejecucionId) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${identificador}` };
  }
  const { puertos, cerrar } = crear();
  try {
    return await importarHistorial(ejecucionId, puertos, opciones);
  } finally {
    await cerrar();
  }
}
