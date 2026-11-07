// Orquestación de la importación (FR-108) sobre el contrato de workers (workers/CONTRATO.md):
// 0 = éxito; 78 = falla no reintentable (ejecución cerrada, configuración); cualquier otra excepción
// es técnica y la reintenta el flow. Cada fila se aplica una sola vez en la base
// (`private.aplicar_fila_importacion_productos`), así que reintentar no duplica productos ni imágenes.
import { rutaFinal, validarImagen } from './imagen.js';

export const SALIDA_OK = 0;
export const SALIDA_NO_REINTENTABLE = 78;
const TAMANO_LOTE = 200;
/** Tope de vueltas: cada fila pendiente pasa a aplicada u omitida, así que nunca debería agotarse. */
const MAX_LOTES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Inicio {
  importacion_id: string;
  organizacion_id: string;
  clave: string;
  pendientes: number;
}

export interface FilaPendiente {
  fila_id: string;
  fila: number;
  sku: string;
}

export interface ResultadoFila {
  resultado: 'aplicada' | 'omitida';
  producto_id: string | null;
  mensaje: string;
  imagenes: string[];
}

export type EstadoRegistro = 'registrada' | 'existente' | 'tope';

/** Todo lo que el importador necesita del exterior: facilita probarlo sin base ni Storage. */
export interface Puertos {
  enCurso(ejecucionId: string): Promise<boolean>;
  iniciar(ejecucionId: string): Promise<Inicio>;
  pendientes(ejecucionId: string, limite: number): Promise<FilaPendiente[]>;
  aplicar(ejecucionId: string, filaId: string): Promise<ResultadoFila>;
  /** Descarga del bucket temporal; `null` si el archivo no existe. */
  descargarTemporal(ruta: string): Promise<Uint8Array | null>;
  subirImagen(ruta: string, bytes: Uint8Array, nombre: string): Promise<void>;
  registrarImagen(ejecucionId: string, filaId: string, nombre: string, ruta: string): Promise<EstadoRegistro>;
  cerrarImportacion(ejecucionId: string, estado: 'terminada' | 'fallida', mensaje: string | null): Promise<{ procesadas: number; omitidas: number }>;
  cerrarEjecucion(ejecucionId: string, estado: 'exitosa' | 'fallida', motivo: string, detalle: Record<string, unknown>): Promise<void>;
  despacharSiguiente(organizacionId: string): Promise<void>;
  evento(etapa: string, estado: 'iniciada' | 'completada' | 'fallida', mensaje?: string): void;
}

export interface Salida {
  codigo: number;
  /** Línea para stderr, ya sanitizada (`<MOTIVO>:<id>`). */
  stderr?: string;
}

async function adjuntarImagenes(
  puertos: Puertos,
  ejecucionId: string,
  inicio: Inicio,
  filaId: string,
  resultado: ResultadoFila,
): Promise<number> {
  let adjuntas = 0;
  for (const nombre of resultado.imagenes) {
    const origen = `${inicio.organizacion_id}/${inicio.clave}/${nombre}`;
    const bytes = await puertos.descargarTemporal(origen);
    if (!bytes) {
      puertos.evento('imagenes', 'iniciada', `Imagen ${nombre} no subida: se omite`);
      continue;
    }
    const motivo = validarImagen(nombre, bytes);
    if (motivo) {
      puertos.evento('imagenes', 'iniciada', `Imagen ${nombre} omitida: ${motivo}`);
      continue;
    }
    const extension = nombre.split('.').pop()!.toLowerCase();
    const formato = extension === 'jpeg' ? 'jpg' : (extension as 'jpg' | 'png' | 'webp');
    const ruta = rutaFinal(inicio.organizacion_id, resultado.producto_id!, nombre, formato);
    await puertos.subirImagen(ruta, bytes, nombre);
    const estado = await puertos.registrarImagen(ejecucionId, filaId, nombre, ruta);
    if (estado === 'registrada') adjuntas += 1;
    if (estado === 'tope') break;
  }
  return adjuntas;
}

export async function importarProductos(ejecucionId: string, puertos: Puertos): Promise<Salida> {
  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso (un reintento tardío no repite nada).
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  const inicio = await puertos.iniciar(ejecucionId);
  puertos.evento('aplicacion', 'iniciada', `${inicio.pendientes} filas por aplicar`);

  let aplicadas = 0;
  let omitidas = 0;
  let imagenes = 0;
  for (let vuelta = 0; vuelta < MAX_LOTES; vuelta += 1) {
    const lote = await puertos.pendientes(ejecucionId, TAMANO_LOTE);
    if (lote.length === 0) break;
    for (const pendiente of lote) {
      const resultado = await puertos.aplicar(ejecucionId, pendiente.fila_id);
      if (resultado.resultado === 'omitida') {
        omitidas += 1;
        continue;
      }
      aplicadas += 1;
      if (resultado.producto_id && resultado.imagenes.length > 0) {
        imagenes += await adjuntarImagenes(puertos, ejecucionId, inicio, pendiente.fila_id, resultado);
      }
    }
  }
  puertos.evento('aplicacion', 'completada', `${aplicadas} aplicadas, ${omitidas} omitidas, ${imagenes} imágenes`);

  const cierre = await puertos.cerrarImportacion(ejecucionId, 'terminada', null);
  await puertos.cerrarEjecucion(ejecucionId, 'exitosa', `IMPORTADAS:${cierre.procesadas}`, {
    importacion_id: inicio.importacion_id,
    procesadas: cierre.procesadas,
    omitidas: cierre.omitidas,
  });
  // Serialización (FR-109): al cerrar esta ejecución, la siguiente de la organización pasa a la outbox.
  await puertos.despacharSiguiente(inicio.organizacion_id);
  return { codigo: SALIDA_OK };
}

/** Lee la entrada del contrato (`ORGANIZACION_ID`, `EJECUCION_ID`) y delega; `crear` arma los puertos reales. */
export async function ejecutarDesdeEntorno(
  env: Record<string, string | undefined>,
  crear: () => { puertos: Puertos; cerrar: () => Promise<void> },
): Promise<Salida> {
  const ejecucionId = env.EJECUCION_ID;
  const identificador = env.CONEXION_ID || ejecucionId || 'desconocida';
  if (!env.ORGANIZACION_ID || !ejecucionId || !UUID.test(ejecucionId) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${identificador}` };
  }
  const { puertos, cerrar } = crear();
  try {
    return await importarProductos(ejecucionId, puertos);
  } catch (error) {
    // La base rechaza con un motivo contractual cuando la ejecución ya no es válida: no se reintenta.
    const mensaje = error instanceof Error ? error.message : '';
    if (mensaje.startsWith('EJECUCION_NO_EN_CURSO')) {
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
    }
    if (mensaje.startsWith('CONFIGURACION_INVALIDA')) {
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${identificador}` };
    }
    throw error;
  } finally {
    await cerrar();
  }
}
