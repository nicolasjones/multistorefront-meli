// Puertos reales: Postgres con el rol `worker_<org>` (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD del
// entorno del contenedor) y Storage con la clave de servicio del servidor (nunca del navegador).
import pg from 'pg';
import type { DatosDocumento } from './tipos.js';
import type { Puertos } from './generar.js';

const BUCKET = 'comprobantes-documentos';
const BUCKET_LOGO = 'tienda-identidad';
const MAX_LOGO = 1_048_576;

function evento(ejecucion: string, etapa: string, estado: string, mensaje?: string): void {
  const linea: Record<string, string> = { etapa, estado, timestamp: new Date().toISOString(), ejecucion };
  if (mensaje) linea.mensaje = mensaje.slice(0, 500);
  console.log(JSON.stringify(linea));
}

const codificar = (ruta: string): string => ruta.split('/').map(encodeURIComponent).join('/');

export function crearPuertos(env: Record<string, string | undefined>): { puertos: Puertos; cerrar: () => Promise<void> } {
  const pool = new pg.Pool({ max: 1 });
  const baseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const clave = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}` };
  const ejecucionLog = env.EJECUCION_ID ?? env.KESTRA_EJECUCION_ID ?? 'desconocida';

  const puertos: Puertos = {
    async enCurso(id) {
      const r = await pool.query<{ en_curso: boolean }>('select private.ejecucion_worker_en_curso($1::uuid) as en_curso', [id]);
      return r.rows[0]?.en_curso === true;
    },
    async datos(id) {
      const r = await pool.query<{ datos: DatosDocumento }>('select private.datos_documento_comprobante($1::uuid) as datos', [id]);
      if (!r.rows[0]?.datos) throw new Error('El documento no trae datos');
      return r.rows[0].datos;
    },
    async logo(ruta) {
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET_LOGO}/${codificar(ruta)}`, { headers: cabeceras });
      if (!respuesta.ok) return null;
      const bytes = Buffer.from(await respuesta.arrayBuffer());
      // pdfkit solo dibuja PNG y JPEG: un SVG o un archivo enorme se omite.
      const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const jpeg = bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]));
      return bytes.length <= MAX_LOGO && (png || jpeg) ? bytes : null;
    },
    async subir(ruta, pdf) {
      const respuesta = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${codificar(ruta)}`, {
        method: 'POST',
        headers: { ...cabeceras, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: new Uint8Array(pdf),
      });
      // Falla técnica: el mensaje no incluye URL ni encabezados.
      if (!respuesta.ok) throw new Error(`SUBIDA_FALLIDA:${respuesta.status}`);
    },
    async cerrar(id, ruta, error) {
      await pool.query('select private.cerrar_documento_comprobante($1::uuid, $2::text, $3::text)', [id, ruta, error]);
    },
    evento: (etapa, estado, mensaje) => evento(ejecucionLog, etapa, estado, mensaje),
  };

  return { puertos, cerrar: () => pool.end() };
}
