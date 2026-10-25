// Orquestación del worker (FR-004) sobre el contrato de workers/CONTRATO.md: 0 = éxito; 78 = falla no
// reintentable; cualquier excepción es técnica y la reintenta el flow (subida y cierre son idempotentes).
import { renderizarPdf } from './pdf.js';
import { armarFactura } from './plantillas/factura.js';
import { armarRemito } from './plantillas/remito.js';
import type { DatosDocumento, ModeloDocumento } from './tipos.js';

export const SALIDA_OK = 0;
export const SALIDA_NO_REINTENTABLE = 78;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOTIVO_FALLIDO = 'No se pudo generar el documento';

/** Todo lo que el worker necesita del exterior: permite probarlo sin base ni Storage. */
export interface Puertos {
  enCurso(ejecucionId: string): Promise<boolean>;
  datos(documentoId: string): Promise<DatosDocumento>;
  logo(ruta: string): Promise<Buffer | null>;
  subir(ruta: string, pdf: Buffer): Promise<void>;
  cerrar(documentoId: string, ruta: string | null, error: string | null): Promise<void>;
  evento(etapa: string, estado: 'iniciada' | 'completada' | 'fallida', mensaje?: string): void;
}

export interface Salida {
  codigo: number;
  /** Línea para stderr, ya sanitizada (`<MOTIVO>:<id>`). */
  stderr?: string;
}

export const PLANTILLAS: Record<string, (d: DatosDocumento) => ModeloDocumento> = {
  factura: armarFactura,
  remito: armarRemito,
};

/** Errores contractuales de la base (`P0001`): el mensaje empieza con el motivo en mayúsculas. */
function motivoBase(error: unknown): string | null {
  const mensaje = error instanceof Error ? error.message : '';
  const m = /^([A-Z_]+):/.exec(mensaje);
  return m ? m[1] : null;
}

export async function generarDocumento(documentoId: string, ejecucionId: string, puertos: Puertos): Promise<Salida> {
  if (!UUID.test(documentoId) || !UUID.test(ejecucionId)) {
    puertos.evento('inicio', 'fallida', 'Entrada inválida');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${ejecucionId || 'desconocida'}` };
  }
  // Contrato: antes de actuar, confirmar que la ejecución sigue en curso.
  if (!(await puertos.enCurso(ejecucionId))) {
    puertos.evento('inicio', 'fallida', 'La ejecución ya no está en curso');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
  }
  puertos.evento('inicio', 'completada');

  let datos: DatosDocumento;
  try {
    datos = await puertos.datos(documentoId);
  } catch (error) {
    const motivo = motivoBase(error);
    // Ya cerrado por un intento anterior: nada que repetir.
    if (motivo === 'DOCUMENTO_NO_PENDIENTE') {
      puertos.evento('datos', 'completada', 'El documento ya estaba cerrado');
      return { codigo: SALIDA_OK };
    }
    if (motivo === 'EJECUCION_NO_EN_CURSO') {
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `EJECUCION_NO_EN_CURSO:${ejecucionId}` };
    }
    if (motivo === 'DOCUMENTO_DESCONOCIDO' || motivo === 'CONFIGURACION_INVALIDA' || motivo === 'NO_AUTORIZADO') {
      puertos.evento('datos', 'fallida', motivo);
      return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${documentoId}` };
    }
    throw error;
  }

  const plantilla = PLANTILLAS[datos.documento.tipo];
  if (!plantilla) {
    await puertos.cerrar(documentoId, null, MOTIVO_FALLIDO);
    puertos.evento('plantilla', 'fallida', 'Tipo de documento sin plantilla');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${documentoId}` };
  }

  puertos.evento('generacion', 'iniciada');
  let pdf: Buffer;
  try {
    // El logo es opcional: sin él (o si no se puede leer) el documento sale igual.
    const logo = datos.empresa.logo_ruta ? await puertos.logo(datos.empresa.logo_ruta).catch(() => null) : null;
    pdf = await renderizarPdf(plantilla(datos), logo ?? undefined);
  } catch {
    // Falla determinista del armado: reintentar no la arregla. El detalle no se guarda ni se muestra.
    await puertos.cerrar(documentoId, null, MOTIVO_FALLIDO);
    puertos.evento('generacion', 'fallida', 'No se pudo armar el PDF');
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `GENERACION_FALLIDA:${documentoId}` };
  }
  puertos.evento('generacion', 'completada', `${pdf.length} bytes`);

  await puertos.subir(datos.documento.ruta, pdf);
  await puertos.cerrar(documentoId, datos.documento.ruta, null);
  puertos.evento('cierre', 'completada');
  return { codigo: SALIDA_OK };
}

export async function ejecutarDesdeEntorno(
  env: Record<string, string | undefined>,
  crear: () => { puertos: Puertos; cerrar: () => Promise<void> },
): Promise<Salida> {
  const documentoId = env.DOCUMENTO_ID ?? '';
  const ejecucionId = env.EJECUCION_ID ?? '';
  if (!UUID.test(documentoId) || !UUID.test(ejecucionId)) {
    return { codigo: SALIDA_NO_REINTENTABLE, stderr: `CONFIGURACION_INVALIDA:${env.CONEXION_ID ?? 'desconocida'}` };
  }
  const { puertos, cerrar } = crear();
  try {
    return await generarDocumento(documentoId, ejecucionId, puertos);
  } finally {
    await cerrar();
  }
}
