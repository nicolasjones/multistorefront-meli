// Orquestación de la exportación (FR-008) sobre el contrato de workers (workers/CONTRATO.md):
// 0 = éxito; 78 = falla no reintentable (ejecución cerrada, configuración, tope); cualquier otra
// excepción es técnica y la reintenta el flow (la subida es idempotente: misma ruta con upsert).
import { cuerpoCsv, encabezadoCsv, type FilaComprobante } from './csv.js';

export const SALIDA_OK = 0;
export const SALIDA_NO_REINTENTABLE = 78;
export const TAMANO_LOTE = 5000;
export const TOPE_FILAS = 500_000;

export interface DatosExportacion {
  organizacion_id: string;
  tipo: string;
  filtros: Record<string, unknown>;
  empresas: string[];
  actor: string;
  archivo: string;
}

export type FilaPagina = FilaComprobante & { filas: string | number };

/** Todo lo que el worker necesita del exterior: facilita probarlo sin base ni Storage. */
export interface Puertos {
  enCurso(ejecucionId: string): Promise<boolean>;
  datos(ejecucionId: string): Promise<DatosExportacion>;
  pagina(ejecucionId: string, desde: number, limite: number): Promise<FilaPagina[]>;
  subir(ruta: string, contenido: Buffer): Promise<void>;
  /** Borra los CSV anteriores del mismo usuario (misma carpeta), conservando `conservar`. */
  limpiarAnteriores(carpeta: string, conservar: string): Promise<void>;
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
  topeFilas?: number;
}

export async function exportarComprobantes(ejecucionId: string, organizacionId: string, puertos: Puertos, opciones: Opciones = {}): Promise<Salida> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;
  const topeFilas = opciones.topeFilas ?? TOPE_FILAS;

  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso (un reintento tardío no repite nada).
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  const datos = await puertos.datos(ejecucionId);
  // Defensa en profundidad: la ejecución debe ser de la organización que el flow dice servir.
  if (datos.organizacion_id !== organizacionId || !datos.archivo.startsWith(`${organizacionId}/`)) {
    puertos.evento('inicio', 'fallida', 'La ejecución no pertenece a la organización');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${ejecucionId}` };
  }

  puertos.evento('lectura', 'iniciada');
  const partes: string[] = [encabezadoCsv()];
  let total = 0;
  for (let desde = 0; ; desde += tamanoLote) {
    const pagina = await puertos.pagina(ejecucionId, desde, tamanoLote);
    if (pagina.length === 0) break;
    total += pagina.length;
    if (Number(pagina[0].filas) > topeFilas || total > topeFilas) {
      await puertos.cerrar(ejecucionId, 'fallida', `TOPE_EXCEDIDO: más de ${topeFilas} filas`, { tope: topeFilas });
      puertos.evento('lectura', 'fallida', 'Tope de filas excedido');
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `TOPE_EXCEDIDO:${ejecucionId}` };
    }
    partes.push(cuerpoCsv(pagina));
    if (total >= Number(pagina[0].filas) || pagina.length < tamanoLote) break;
  }
  puertos.evento('lectura', 'completada', `${total} filas`);

  puertos.evento('subida', 'iniciada');
  await puertos.subir(datos.archivo, Buffer.from(partes.join(''), 'utf8'));
  puertos.evento('subida', 'completada');

  // Retención: el CSV lleva nombres de clientes, así que solo queda el último de cada usuario. Es mejor esfuerzo:
  // si la limpieza falla, la exportación igual terminó bien y los archivos viejos se reintentan en la próxima.
  try {
    await puertos.limpiarAnteriores(datos.archivo.slice(0, datos.archivo.lastIndexOf('/') + 1), datos.archivo);
  } catch {
    puertos.evento('limpieza', 'fallida', 'No se pudieron borrar los CSV anteriores');
  }

  await puertos.cerrar(ejecucionId, 'exitosa', `EXPORTADAS:${total}`, { filas: total, archivo: datos.archivo });
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
  if (!env.ORGANIZACION_ID || !uuid.test(env.ORGANIZACION_ID) || !ejecucionId || !uuid.test(ejecucionId) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${identificador}` };
  }
  const { puertos, cerrar } = crear();
  try {
    return await exportarComprobantes(ejecucionId, env.ORGANIZACION_ID, puertos, opciones);
  } finally {
    await cerrar();
  }
}
