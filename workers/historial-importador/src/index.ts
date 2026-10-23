// Entrada del worker (workers/CONTRATO.md). Variables: ORGANIZACION_ID y EJECUCION_ID (las manda el
// flow de Kestra), PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD (rol worker_<org>) y, para leer la
// planilla del bucket privado, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (solo del lado servidor,
// cargadas desde worker.env; nunca llegan al navegador ni a la línea de comandos).
// Salida: 0 éxito · 78 falla no reintentable (cierra la ejecución con el detalle) · otro: técnica.
import pg from 'pg';
import { validarEntrada } from './entrada.js';
import { importarArchivo, type InsertarLote } from './importar.js';
import { TIPOS, type TipoHistorial } from './mapeo.js';
import type { Empresa } from './validar.js';

const NO_REINTENTABLE = 78;
const BUCKET = 'historial-importaciones';
const MOTIVOS_DB = ['EJECUCION_NO_EN_CURSO', 'CONFIGURACION_INVALIDA', 'EMPRESA_INVALIDA', 'LOTE_INVALIDO', 'TIPO_INVALIDO'];

class FallaNoReintentable extends Error {
  constructor(
    readonly motivo: string,
    readonly id: string,
    readonly cerrar?: { motivo: string; detalle: Record<string, unknown> },
  ) {
    super(motivo);
  }
}

function evento(etapa: string, estado: 'iniciada' | 'completada' | 'fallida', mensaje: string, ejecucion: string): void {
  console.log(JSON.stringify({ etapa, estado, timestamp: new Date().toISOString(), ejecucion, mensaje }));
}

function motivoDeDb(error: unknown): string | undefined {
  const texto = error instanceof Error ? error.message : '';
  return MOTIVOS_DB.find((m) => texto.startsWith(m));
}

async function descargar(ruta: string): Promise<Uint8Array> {
  const base = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !clave) throw new FallaNoReintentable('CONFIGURACION_INVALIDA', 'storage');
  const url = `${base.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${clave}`, apikey: clave } });
  if (respuesta.status === 404) throw new FallaNoReintentable('ARCHIVO_NO_ENCONTRADO', ruta);
  if (!respuesta.ok) throw new Error(`Storage respondió ${respuesta.status}`); // técnica: se reintenta
  return new Uint8Array(await respuesta.arrayBuffer());
}

async function ejecutar(ejecucionId: string): Promise<void> {
  const cliente = new pg.Client();
  await cliente.connect();
  try {
    evento('inicio', 'iniciada', 'Importación del historial iniciada', ejecucionId);
    // Falla si la ejecución ya no está en curso (EJECUCION_NO_EN_CURSO) o no es de importación.
    const contexto = (
      await cliente.query<{ tipo: string; archivo: string; empresas: Empresa[] }>(
        'select tipo, archivo, empresas from private.historial_contexto_ejecucion($1::uuid)',
        [ejecucionId],
      )
    ).rows[0];
    if (!contexto || !TIPOS.includes(contexto.tipo as TipoHistorial)) {
      throw new FallaNoReintentable('CONFIGURACION_INVALIDA', ejecucionId);
    }
    const tipo = contexto.tipo as TipoHistorial;

    const bytes = await descargar(contexto.archivo);
    evento('lectura', 'completada', 'Archivo descargado', ejecucionId);

    const insertarLote: InsertarLote = async (filas) => {
      const { rows } = await cliente.query<{ nuevas: number; existentes: number }>(
        'select nuevas, existentes from private.importar_historial_lote($1::uuid, $2, $3::jsonb)',
        [ejecucionId, tipo, JSON.stringify(filas)],
      );
      return { nuevas: Number(rows[0]?.nuevas ?? 0), existentes: Number(rows[0]?.existentes ?? 0) };
    };

    const resultado = await importarArchivo(tipo, bytes, contexto.empresas, insertarLote);
    if (resultado.estado === 'fallida') {
      evento('validacion', 'fallida', `${resultado.totalRechazos} rechazo(s); no se importó nada`, ejecucionId);
      throw new FallaNoReintentable(resultado.motivo, ejecucionId, {
        motivo: resultado.motivo,
        detalle: { tipo, total_rechazos: resultado.totalRechazos, rechazos: resultado.rechazos },
      });
    }
    evento('importacion', 'completada', `${resultado.nuevas} nuevas, ${resultado.existentes} ya existentes`, ejecucionId);
    await cliente.query("select public.cerrar_ejecucion_worker($1::uuid, 'exitosa', null, $2::jsonb)", [
      ejecucionId,
      JSON.stringify({ tipo, nuevas: resultado.nuevas, existentes: resultado.existentes, total: resultado.total }),
    ]);
  } catch (error) {
    const motivo = error instanceof FallaNoReintentable ? undefined : motivoDeDb(error);
    if (motivo) throw new FallaNoReintentable(motivo, ejecucionId);
    throw error;
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

async function cerrarFallida(ejecucionId: string, motivo: string, detalle: Record<string, unknown>): Promise<void> {
  const cliente = new pg.Client();
  await cliente.connect();
  try {
    await cliente.query("select public.cerrar_ejecucion_worker($1::uuid, 'fallida', $2, $3::jsonb)", [
      ejecucionId,
      motivo,
      JSON.stringify(detalle),
    ]);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const entrada = validarEntrada(process.env);
  if (!entrada.ok) {
    process.stderr.write(`${entrada.stderr}\n`);
    return NO_REINTENTABLE;
  }
  const { ejecucionId } = entrada;
  try {
    await ejecutar(ejecucionId);
    return 0;
  } catch (error) {
    if (error instanceof FallaNoReintentable) {
      evento('inicio', 'fallida', error.motivo, ejecucionId);
      if (error.cerrar) {
        // Una falla ya cerrada (YA_CERRADA) no cambia el resultado de negocio.
        await cerrarFallida(ejecucionId, error.cerrar.motivo, error.cerrar.detalle).catch(() => undefined);
      }
      process.stderr.write(`${error.motivo}:${error.id}\n`);
      return NO_REINTENTABLE;
    }
    // Técnica y potencialmente transitoria: stderr sin mensaje (puede traer datos); el flow reintenta.
    process.stderr.write('FALLA_TECNICA_SANITIZADA\n');
    return 1;
  }
}

process.exitCode = await main();
