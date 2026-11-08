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
/** Días que un objeto del bucket temporal puede quedar huérfano antes de borrarse (subidas que nunca se solicitaron). */
export const DIAS_TEMPORALES_HUERFANOS = 7;
const LOTE_BORRADO = 100;
/** Tope de tandas de limpieza por corrida (cada tanda trae hasta 1000 rutas): vacía el backlog sin bucle infinito. */
const MAX_TANDAS_LIMPIEZA = 5;
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
  /** La fila ya tiene sus imágenes adjuntas (o descartadas con motivo): deja de ofrecerse al worker. */
  confirmarImagenes(ejecucionId: string, filaId: string): Promise<void>;
  /** Rutas del bucket temporal a borrar: las de esta importación y las huérfanas de más de `dias` días. */
  temporalesABorrar(ejecucionId: string, dias: number, incluirImportacion: boolean): Promise<string[]>;
  /** Registra un fallo transitorio de la fila (en su propia transacción); al tercero la base la omite. Devuelve los intentos. */
  registrarFallo(ejecucionId: string, filaId: string): Promise<number>;
  borrarTemporales(rutas: string[]): Promise<void>;
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

/**
 * Borra imágenes temporales: al empezar la corrida solo las huérfanas (las de la propia importación se necesitan) y al
 * cerrar también las de la importación. Vacía el backlog en una tanda acotada. Es limpieza de mejor esfuerzo: si falla
 * no se reintenta toda la importación; lo que quede se borra en la próxima corrida.
 */
async function limpiarTemporales(puertos: Puertos, ejecucionId: string, incluirImportacion: boolean): Promise<void> {
  let borradas = 0;
  try {
    for (let tanda = 0; tanda < MAX_TANDAS_LIMPIEZA; tanda += 1) {
      const rutas = await puertos.temporalesABorrar(ejecucionId, DIAS_TEMPORALES_HUERFANOS, incluirImportacion);
      if (rutas.length === 0) break;
      for (let i = 0; i < rutas.length; i += LOTE_BORRADO) {
        await puertos.borrarTemporales(rutas.slice(i, i + LOTE_BORRADO));
      }
      borradas += rutas.length;
    }
    puertos.evento('limpieza', 'completada', `${borradas} imágenes temporales borradas`);
  } catch {
    puertos.evento('limpieza', 'fallida', 'No se pudieron borrar las imágenes temporales: se reintenta en la próxima corrida');
  }
}

export async function importarProductos(ejecucionId: string, puertos: Puertos): Promise<Salida> {
  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso (un reintento tardío no repite nada).
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  const inicio = await puertos.iniciar(ejecucionId);
  // Huérfanos de corridas o importaciones anteriores (nunca las imágenes de esta importación).
  await limpiarTemporales(puertos, ejecucionId, false);
  puertos.evento('aplicacion', 'iniciada', `${inicio.pendientes} filas por aplicar`);

  let aplicadas = 0;
  let omitidas = 0;
  let imagenes = 0;
  // Filas con error transitorio en ESTA corrida: se siguen con las demás y no se vuelven a pedir hasta el reintento.
  const falladas = new Set<string>();
  for (let vuelta = 0; vuelta < MAX_LOTES; vuelta += 1) {
    const lote = (await puertos.pendientes(ejecucionId, TAMANO_LOTE)).filter((fila) => !falladas.has(fila.fila_id));
    if (lote.length === 0) break;
    for (const pendiente of lote) {
      let resultado: ResultadoFila;
      try {
        resultado = await puertos.aplicar(ejecucionId, pendiente.fila_id);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : '';
        // Fallas contractuales: no son de la fila, se propagan tal cual.
        if (mensaje.startsWith('EJECUCION_NO_EN_CURSO') || mensaje.startsWith('CONFIGURACION_INVALIDA')) throw error;
        // Error transitorio de la fila (deadlock, lock, cancelación): se cuenta el intento (al tercero la base la omite) y
        // las filas siguientes se procesan igual, en vez de abortar la corrida en cada reintento.
        await puertos.registrarFallo(ejecucionId, pendiente.fila_id);
        falladas.add(pendiente.fila_id);
        puertos.evento('aplicacion', 'fallida', `Fila ${pendiente.fila} falló con un error transitorio`);
        continue;
      }
      if (resultado.resultado === 'omitida') {
        omitidas += 1;
        continue;
      }
      aplicadas += 1;
      if (resultado.producto_id && resultado.imagenes.length > 0) {
        // Si Storage falla, la excepción sale ANTES de confirmar: la fila sigue con imágenes pendientes en la base y el
        // reintento la vuelve a ver (adjuntar es idempotente: ruta determinista y registro `existente`).
        imagenes += await adjuntarImagenes(puertos, ejecucionId, inicio, pendiente.fila_id, resultado);
        await puertos.confirmarImagenes(ejecucionId, pendiente.fila_id);
      }
    }
  }
  // Quedaron filas con error transitorio que todavía admiten intentos: la corrida falla (sale con 1) y el flow reintenta.
  // No se cierra `terminada`: marcaría esas filas como «no se procesó».
  if (falladas.size > 0) {
    const sigue = (await puertos.pendientes(ejecucionId, TAMANO_LOTE)).some((fila) => falladas.has(fila.fila_id));
    if (sigue) throw new Error(`FILAS_PENDIENTES:${falladas.size}`);
  }
  puertos.evento('aplicacion', 'completada', `${aplicadas} aplicadas, ${omitidas} omitidas, ${imagenes} imágenes`);

  const cierre = await puertos.cerrarImportacion(ejecucionId, 'terminada', null);
  await limpiarTemporales(puertos, ejecucionId, true);
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
