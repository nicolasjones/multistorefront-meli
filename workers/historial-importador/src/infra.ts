// Puertos reales: Postgres con el rol `worker_<org>` (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD del
// entorno del contenedor) y Storage con la clave de servicio del servidor (nunca del navegador).
import pg from 'pg';
import { ArchivoInvalidoError } from './lector.js';
import type { Puertos } from './importar.js';

export class ArchivoNoEncontradoError extends ArchivoInvalidoError {
  constructor() {
    super('El archivo de la importación no existe en el almacenamiento');
  }
}

const BUCKET = 'historial-importaciones';

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
      const r = await pool.query<{ tipo: string; archivo: string }>(
        'select tipo, archivo from private.datos_importacion_historial($1::uuid)',
        [id],
      );
      if (!r.rows[0]) throw new Error('La ejecución no trae datos de importación');
      return r.rows[0];
    },
    async tiendas(id) {
      const r = await pool.query<{ nombre: string }>('select nombre from private.empresas_importacion_historial($1::uuid)', [id]);
      return r.rows.map((fila) => fila.nombre);
    },
    async descargar(archivo) {
      const ruta = archivo.split('/').map(encodeURIComponent).join('/');
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${ruta}`, {
        headers: { apikey: clave, Authorization: `Bearer ${clave}` },
      });
      if (respuesta.status === 404 || respuesta.status === 400) throw new ArchivoNoEncontradoError();
      // Falla técnica: el mensaje no incluye URL ni encabezados.
      if (!respuesta.ok) throw new Error(`DESCARGA_FALLIDA:${respuesta.status}`);
      return Buffer.from(await respuesta.arrayBuffer());
    },
    async insertarLote(id, tipo, filas) {
      const r = await pool.query<{ nuevas: number; existentes: number }>(
        'select nuevas, existentes from private.importar_historial_lote($1::uuid, $2::text, $3::jsonb)',
        [id, tipo, JSON.stringify(filas)],
      );
      return { nuevas: Number(r.rows[0].nuevas), existentes: Number(r.rows[0].existentes) };
    },
    async cerrar(id, estado, motivo, detalle) {
      await pool.query('select public.cerrar_ejecucion_worker($1::uuid, $2::text, $3::text, $4::jsonb)', [
        id,
        estado,
        motivo,
        JSON.stringify(detalle),
      ]);
    },
    evento: (etapa, estado, mensaje) => evento(ejecucionLog, etapa, estado, mensaje),
  };

  return { puertos, cerrar: () => pool.end() };
}
