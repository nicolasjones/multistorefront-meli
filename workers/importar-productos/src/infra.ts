// Puertos reales: Postgres con el rol `worker_<org>` (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD del
// entorno del contenedor) y Storage con la clave de servicio del servidor (nunca del navegador).
import pg from 'pg';
import { TIPO_CONTENIDO, formatoDeNombre } from './imagen.js';
import type { EstadoRegistro, FilaPendiente, Inicio, Puertos, ResultadoFila } from './importar.js';

const BUCKET_TEMPORAL = 'productos-importaciones';
const BUCKET_FINAL = 'productos-imagenes';

function evento(ejecucion: string, etapa: string, estado: string, mensaje?: string): void {
  const linea: Record<string, string> = { etapa, estado, timestamp: new Date().toISOString(), ejecucion };
  if (mensaje) linea.mensaje = mensaje.slice(0, 500);
  console.log(JSON.stringify(linea));
}

const codificarRuta = (ruta: string) => ruta.split('/').map(encodeURIComponent).join('/');

export function crearPuertos(env: Record<string, string | undefined>): { puertos: Puertos; cerrar: () => Promise<void> } {
  const pool = new pg.Pool({ max: 1 });
  const baseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const clave = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const ejecucionLog = env.EJECUCION_ID ?? env.KESTRA_EJECUCION_ID ?? 'desconocida';
  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}` };

  const puertos: Puertos = {
    async enCurso(id) {
      const r = await pool.query<{ en_curso: boolean }>('select private.ejecucion_worker_en_curso($1::uuid) as en_curso', [id]);
      return r.rows[0]?.en_curso === true;
    },
    async iniciar(id) {
      const r = await pool.query<Inicio>(
        'select importacion_id, organizacion_id, clave, pendientes from private.iniciar_importacion_productos($1::uuid)',
        [id],
      );
      return r.rows[0];
    },
    async pendientes(id, limite) {
      const r = await pool.query<FilaPendiente>(
        'select fila_id, fila, sku from private.filas_pendientes_importacion_productos($1::uuid, $2::integer)',
        [id, limite],
      );
      return r.rows;
    },
    async aplicar(id, filaId) {
      const r = await pool.query<{ r: ResultadoFila }>('select private.aplicar_fila_importacion_productos($1::uuid, $2::uuid) as r', [id, filaId]);
      return r.rows[0].r;
    },
    async descargarTemporal(ruta) {
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET_TEMPORAL}/${codificarRuta(ruta)}`, { headers: cabeceras });
      if (respuesta.status === 404 || respuesta.status === 400) return null;
      // Falla técnica: el mensaje no incluye URL ni encabezados.
      if (!respuesta.ok) throw new Error(`DESCARGA_FALLIDA:${respuesta.status}`);
      return new Uint8Array(await respuesta.arrayBuffer());
    },
    async subirImagen(ruta, bytes, nombre) {
      const formato = formatoDeNombre(nombre) ?? 'jpg';
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET_FINAL}/${codificarRuta(ruta)}`, {
        method: 'POST',
        headers: { ...cabeceras, 'Content-Type': TIPO_CONTENIDO[formato], 'x-upsert': 'true' },
        body: Buffer.from(bytes),
      });
      if (!respuesta.ok) throw new Error(`SUBIDA_FALLIDA:${respuesta.status}`);
    },
    async registrarImagen(id, filaId, nombre, ruta) {
      const r = await pool.query<{ estado: EstadoRegistro }>(
        'select private.registrar_imagen_importacion_productos($1::uuid, $2::uuid, $3::text, $4::text) as estado',
        [id, filaId, nombre, ruta],
      );
      return r.rows[0].estado;
    },
    async cerrarImportacion(id, estado, mensaje) {
      const r = await pool.query<{ r: { procesadas: number; omitidas: number } }>(
        'select private.cerrar_importacion_productos($1::uuid, $2::text, $3::text) as r',
        [id, estado, mensaje],
      );
      return { procesadas: Number(r.rows[0].r.procesadas), omitidas: Number(r.rows[0].r.omitidas) };
    },
    async cerrarEjecucion(id, estado, motivo, detalle) {
      await pool.query('select public.cerrar_ejecucion_worker($1::uuid, $2::text, $3::text, $4::jsonb)', [id, estado, motivo, JSON.stringify(detalle)]);
    },
    async despacharSiguiente(organizacionId) {
      await pool.query('select private.despachar_importacion_siguiente($1::uuid)', [organizacionId]);
    },
    evento: (etapa, estado, mensaje) => evento(ejecucionLog, etapa, estado, mensaje),
  };

  return { puertos, cerrar: () => pool.end() };
}
