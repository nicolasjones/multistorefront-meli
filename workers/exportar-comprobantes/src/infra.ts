// Puertos reales: Postgres con el rol `worker_<org>` (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD del
// entorno del contenedor) y Storage con la clave de servicio del servidor (nunca del navegador).
import pg from 'pg';
import type { DatosExportacion, FilaPagina, Puertos } from './exportar.js';

const BUCKET = 'exportaciones-ventas';

// `date` llega como texto `aaaa-mm-dd`: sin conversión de huso horario del proceso.
pg.types.setTypeParser(1082, (valor: string) => valor);

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
        'select organizacion_id, tipo, filtros, empresas, actor, archivo from private.datos_exportacion_comprobantes($1::uuid)',
        [id],
      );
      if (!r.rows[0]) throw new Error('La ejecución no trae datos de exportación');
      return r.rows[0];
    },
    async pagina(id, desde, limite) {
      const r = await pool.query<FilaPagina>(
        'select numero, tipo, empresa, fecha, cliente, operador, estado_etiqueta, forma_pago, envio, total, filas from private.filas_exportacion_comprobantes($1::uuid, $2::int, $3::int)',
        [id, desde, limite],
      );
      return r.rows;
    },
    async subir(ruta, contenido) {
      const rutaUrl = ruta.split('/').map(encodeURIComponent).join('/');
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${rutaUrl}`, {
        method: 'POST',
        headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'text/csv', 'x-upsert': 'true' },
        body: new Uint8Array(contenido),
      });
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
      const viejos = objetos.map((o) => `${carpeta}${o.name}`).filter((ruta) => ruta !== conservar);
      if (viejos.length === 0) return;
      const borrado = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: cabeceras,
        body: JSON.stringify({ prefixes: viejos }),
      });
      if (!borrado.ok) throw new Error(`BORRADO_FALLIDO:${borrado.status}`);
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
