// Puertos reales: Postgres con el rol `worker_<org>` (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD del
// entorno del contenedor) y Storage con la clave de servicio del servidor (nunca del navegador).
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import pg from 'pg';
import { crearEscritorZip } from './zip.js';
import type { Conjunto, DatosExportacion, Puertos } from './exportar.js';

const BUCKET = 'exportaciones-organizacion';

function evento(ejecucion: string, etapa: string, estado: string, mensaje?: string): void {
  const linea: Record<string, string> = { etapa, estado, timestamp: new Date().toISOString(), ejecucion };
  if (mensaje) linea.mensaje = mensaje.slice(0, 500);
  console.log(JSON.stringify(linea));
}

export function crearPuertos(env: Record<string, string | undefined>): { puertos: Puertos; cerrar: () => Promise<void> } {
  const pool = new pg.Pool({ max: 1 });
  const baseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const clave = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const ejecucionLog = env.EJECUCION_ID ?? env.KESTRA_EJECUCION_ID ?? 'desconocida';

  const puertos: Puertos = {
    async enCurso(id) {
      const r = await pool.query<{ en_curso: boolean }>('select private.ejecucion_worker_en_curso($1::uuid) as en_curso', [id]);
      return r.rows[0]?.en_curso === true;
    },
    async datos(id) {
      const r = await pool.query<DatosExportacion>(
        'select organizacion_id, proceso_id, conjuntos from private.datos_exportacion_total($1::uuid)',
        [id],
      );
      if (!r.rows[0]) throw new Error('La ejecución no trae datos de exportación');
      return r.rows[0];
    },
    async conjuntos() {
      const r = await pool.query<Conjunto>('select esquema, tabla, columnas from private.conjuntos_exportacion_total()');
      return r.rows;
    },
    async filas(id, esquema, tabla, desde, limite) {
      const r = await pool.query<{ filas: Record<string, unknown>[] }>(
        'select private.filas_exportacion_total($1::uuid, $2::text, $3::text, $4::int, $5::int) as filas',
        [id, esquema, tabla, desde, limite],
      );
      return r.rows[0]?.filas ?? [];
    },
    async progreso(proceso, procesados, total) {
      await pool.query('select public.actualizar_progreso_proceso_masivo($1::uuid, $2::int, $3::int)', [proceso, procesados, total]);
    },
    async errorConjunto(proceso, indice, referencia, motivo) {
      await pool.query('select public.registrar_error_proceso_masivo($1::uuid, $2::int, $3::text, $4::text)', [proceso, indice, referencia, motivo]);
    },
    async cancelado(proceso) {
      const r = await pool.query<{ cancelado: boolean }>('select public.proceso_masivo_cancelado($1::uuid) as cancelado', [proceso]);
      return r.rows[0]?.cancelado === true;
    },
    async cerrarProceso(proceso, estado, motivo) {
      const cerrar = (final: string) =>
        pool.query('select public.cerrar_proceso_masivo($1::uuid, $2::text, $3::text)', [proceso, final, motivo || null]);
      try {
        await cerrar(estado);
      } catch (error) {
        // Un reintento puede heredar errores de conjunto registrados por el intento anterior: la base los cuenta
        // y no deja cerrar `completado`. El archivo ya está publicado, así que se cierra `con_errores`.
        if (estado === 'completado' && String((error as Error).message).includes('ESTADO_INVALIDO')) await cerrar('con_errores');
        else throw error;
      }
    },
    abrirZip: () => crearEscritorZip(),
    async subir(archivo, destino) {
      const rutaUrl = destino.split('/').map(encodeURIComponent).join('/');
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${rutaUrl}`, {
        method: 'POST',
        headers: {
          apikey: clave,
          Authorization: `Bearer ${clave}`,
          'Content-Type': 'application/zip',
          'Content-Length': String(statSync(archivo.ruta).size),
          'x-upsert': 'true',
        },
        // El ZIP se sube desde disco, sin cargarlo en memoria.
        body: Readable.toWeb(createReadStream(archivo.ruta)) as ReadableStream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      // Falla técnica: el mensaje no incluye URL ni encabezados.
      if (!respuesta.ok) throw new Error(`SUBIDA_FALLIDA:${respuesta.status}`);
    },
    async limpiarAnteriores(carpeta, conservar) {
      const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' };
      const lista = await fetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: cabeceras,
        body: JSON.stringify({ prefix: carpeta.replace(/\/$/, ''), limit: 1000 }),
      });
      if (!lista.ok) throw new Error(`LISTADO_FALLIDO:${lista.status}`);
      const objetos = (await lista.json()) as { name: string }[];
      const viejos = objetos.map((o) => `${carpeta}${o.name}`).filter((ruta) => ruta !== conservar && ruta.endsWith('.zip'));
      if (viejos.length === 0) return;
      const borrado = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: cabeceras,
        body: JSON.stringify({ prefixes: viejos }),
      });
      if (!borrado.ok) throw new Error(`BORRADO_FALLIDO:${borrado.status}`);
    },
    async cerrarEjecucion(id, estado, motivo, detalle) {
      await pool.query('select public.cerrar_ejecucion_worker($1::uuid, $2::text, $3::text, $4::jsonb)', [id, estado, motivo, JSON.stringify(detalle)]);
    },
    evento: (etapa, estado, mensaje) => evento(ejecucionLog, etapa, estado, mensaje),
  };

  return { puertos, cerrar: () => pool.end() };
}
