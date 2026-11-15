// Orquestación de la exportación total (FR-033, FR-034, FR-037) sobre el contrato de workers
// (workers/CONTRATO.md): 0 = éxito; 78 = falla no reintentable (ejecución cerrada, configuración, tope);
// cualquier otra excepción es técnica y la reintenta el flow (la subida es idempotente: misma ruta con upsert).
// Avance y cierre siguen el contrato de procesos masivos: total = cantidad de conjuntos, un error por conjunto
// fallido, cancelación revisada entre lotes y ningún ZIP parcial si se cancela o falla.
import { cuerpoCsv, encabezadoCsv } from './csv.js';
import { TopeExcedido, type ArchivoZip, type EscritorZip } from './zip.js';

export const SALIDA_OK = 0;
export const SALIDA_NO_REINTENTABLE = 78;
export const TAMANO_LOTE = 2000;

export interface Conjunto {
  esquema: string;
  tabla: string;
  columnas: string[];
}

export interface DatosExportacion {
  organizacion_id: string;
  proceso_id: string;
  conjuntos: number;
}

/** Todo lo que el worker necesita del exterior: facilita probarlo sin base, disco ni Storage. */
export interface Puertos {
  enCurso(ejecucionId: string): Promise<boolean>;
  datos(ejecucionId: string): Promise<DatosExportacion>;
  conjuntos(): Promise<Conjunto[]>;
  filas(ejecucionId: string, esquema: string, tabla: string, desde: number, limite: number): Promise<Record<string, unknown>[]>;
  progreso(procesoId: string, procesados: number, total: number): Promise<void>;
  errorConjunto(procesoId: string, indice: number, referencia: string, motivo: string): Promise<void>;
  cancelado(procesoId: string): Promise<boolean>;
  cerrarProceso(procesoId: string, estado: 'completado' | 'con_errores' | 'fallido' | 'cancelado', motivo: string): Promise<void>;
  abrirZip(): EscritorZip;
  /** Sube el ZIP al bucket privado (idempotente: misma ruta con upsert). */
  subir(archivo: ArchivoZip, destino: string): Promise<void>;
  /** Borra los ZIP anteriores de la organización (misma carpeta), conservando `conservar`. */
  limpiarAnteriores(carpeta: string, conservar: string): Promise<void>;
  cerrarEjecucion(ejecucionId: string, estado: 'exitosa' | 'fallida', motivo: string, detalle: Record<string, unknown>): Promise<void>;
  evento(etapa: string, estado: 'iniciada' | 'completada' | 'fallida', mensaje?: string): void;
}

export interface Salida {
  codigo: number;
  /** Línea para stderr, ya sanitizada (`<MOTIVO>:<id>`). */
  stderr?: string;
}

export interface Opciones {
  tamanoLote?: number;
}

function leeme(conjuntos: { nombre: string; filas: number; error: boolean }[], generado: Date): string {
  const lineas = [
    'Exportación total de datos de la organización',
    `Generada el ${generado.toISOString()}`,
    '',
    'Cada archivo .csv trae un conjunto de datos (carpeta = esquema). Separador «;», codificación UTF-8.',
    'No incluye credenciales, tokens ni datos de autenticación.',
    '',
    'Conjuntos y cantidad de filas:',
    ...conjuntos.map((c) => `- ${c.nombre}: ${c.filas}${c.error ? ' (INCOMPLETO: no se pudo leer completo)' : ''}`),
  ];
  return lineas.join('\r\n') + '\r\n';
}

export async function exportarOrganizacion(ejecucionId: string, organizacionId: string, puertos: Puertos, opciones: Opciones = {}): Promise<Salida> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE;

  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso (un reintento tardío no repite nada).
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  const datos = await puertos.datos(ejecucionId);
  // Defensa en profundidad: la ejecución debe ser de la organización que el flow dice servir.
  if (datos.organizacion_id !== organizacionId) {
    puertos.evento('inicio', 'fallida', 'La ejecución no pertenece a la organización');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${ejecucionId}` };
  }
  const procesoId = datos.proceso_id;
  const destino = `${organizacionId}/${ejecucionId}.zip`;

  const lista = await puertos.conjuntos();
  const total = lista.length;
  await puertos.progreso(procesoId, 0, total);

  const zip = puertos.abrirZip();
  const resumen: { nombre: string; filas: number; error: boolean }[] = [];
  let errores = 0;

  const abortar = async (estado: 'fallido' | 'cancelado', motivo: string): Promise<void> => {
    zip.descartar();
    await puertos.cerrarProceso(procesoId, estado, motivo);
    await puertos.cerrarEjecucion(ejecucionId, estado === 'cancelado' ? 'exitosa' : 'fallida', motivo, { conjuntos: total, errores });
  };

  try {
    puertos.evento('lectura', 'iniciada', `${total} conjuntos`);
    for (let i = 0; i < total; i++) {
      const conjunto = lista[i];
      const nombre = `${conjunto.esquema}/${conjunto.tabla}.csv`;
      if (await puertos.cancelado(procesoId)) {
        puertos.evento('lectura', 'fallida', 'Cancelada por la persona que la pidió');
        await abortar('cancelado', 'CANCELADA');
        return { codigo: SALIDA_OK };
      }

      const entrada = zip.abrirEntrada(nombre);
      entrada.escribir(encabezadoCsv(conjunto.columnas));
      let filas = 0;
      let fallo = false;
      try {
        for (let desde = 0; ; desde += tamanoLote) {
          if (desde > 0 && (await puertos.cancelado(procesoId))) {
            entrada.terminar();
            puertos.evento('lectura', 'fallida', 'Cancelada por la persona que la pidió');
            await abortar('cancelado', 'CANCELADA');
            return { codigo: SALIDA_OK };
          }
          const pagina = await puertos.filas(ejecucionId, conjunto.esquema, conjunto.tabla, desde, tamanoLote);
          if (pagina.length === 0) break;
          filas += pagina.length;
          entrada.escribir(cuerpoCsv(conjunto.columnas, pagina));
          if (pagina.length < tamanoLote) break;
        }
      } catch (error) {
        // El tope del ZIP y las fallas de disco no son un problema del conjunto: cortan todo.
        if (error instanceof TopeExcedido) throw error;
        fallo = true;
        errores += 1;
        // El motivo es genérico: el error crudo de la base puede traer datos o nombres internos.
        await puertos.errorConjunto(procesoId, i, `${conjunto.esquema}.${conjunto.tabla}`, 'No se pudo leer el conjunto completo');
        puertos.evento('lectura', 'fallida', `Conjunto ${i + 1} de ${total}`);
      }
      entrada.terminar();
      resumen.push({ nombre, filas, error: fallo });
      await puertos.progreso(procesoId, i + 1, total);
    }
    // Si fallaron todos los conjuntos es casi seguro una falla técnica (conexión, permisos): que el flow reintente.
    if (total > 0 && errores === total) throw new Error('TODOS_LOS_CONJUNTOS_FALLARON');
    puertos.evento('lectura', 'completada', `${total - errores} de ${total} conjuntos`);

    const resumenEntrada = zip.abrirEntrada('LEEME.txt');
    resumenEntrada.escribir(leeme(resumen, new Date()));
    resumenEntrada.terminar();
  } catch (error) {
    if (error instanceof TopeExcedido) {
      puertos.evento('lectura', 'fallida', 'Tope de tamaño excedido');
      await abortar('fallido', 'TOPE_EXCEDIDO: el archivo supera el tamaño máximo permitido');
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `TOPE_EXCEDIDO:${ejecucionId}` };
    }
    // Falla técnica: no queda archivo temporal ni ZIP parcial, y el flow reintenta.
    zip.descartar();
    throw error;
  }

  let archivo: ArchivoZip;
  try {
    archivo = zip.cerrar();
  } catch (error) {
    if (error instanceof TopeExcedido) {
      await abortar('fallido', 'TOPE_EXCEDIDO: el archivo supera el tamaño máximo permitido');
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `TOPE_EXCEDIDO:${ejecucionId}` };
    }
    throw error;
  }

  try {
    puertos.evento('subida', 'iniciada');
    await puertos.subir(archivo, destino);
    puertos.evento('subida', 'completada');
  } finally {
    // El archivo temporal sale siempre del disco, suba bien o mal.
    zip.descartar();
  }

  // Retención (FR-037): solo queda el último ZIP de la organización. Mejor esfuerzo: si la limpieza falla, la
  // exportación igual terminó bien y el archivo viejo se borra en la próxima.
  try {
    await puertos.limpiarAnteriores(`${organizacionId}/`, destino);
  } catch {
    puertos.evento('limpieza', 'fallida', 'No se pudo borrar el ZIP anterior');
  }
  await puertos.cerrarProceso(procesoId, errores > 0 ? 'con_errores' : 'completado', '');
  await puertos.cerrarEjecucion(ejecucionId, 'exitosa', `EXPORTADOS:${total - errores}`, { conjuntos: total, errores, archivo: destino, bytes: archivo.bytes });
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
    return await exportarOrganizacion(ejecucionId, env.ORGANIZACION_ID, puertos, opciones);
  } finally {
    await cerrar();
  }
}
