// Resumen de las imágenes de workers publicadas (MSF-712): valida que cada línea sea una referencia INMUTABLE (`imagen@sha256:<64 hex>`,
// la misma regla que el preflight del deploy) y arma el Markdown para el resumen del job de `worker-images.yml`. Estar en un script permite
// probar el formato en cada PR (el workflow solo corre en main). Uso: node scripts/resumen-imagenes-workers.mjs <archivo-con-una-referencia-por-linea>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGEN_INMUTABLE } from './preflight-deploy-vps.mjs';

export function resumen(contenido) {
  const lineas = String(contenido).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lineas.length === 0) throw new Error('No hay ninguna imagen publicada que resumir.');
  const malas = lineas.filter((l) => !IMAGEN_INMUTABLE.test(l) || !l.includes('@sha256:'));
  if (malas.length > 0) throw new Error(`Referencias que no son inmutables (imagen@sha256:<64 hex>): ${malas.join(', ')}`);
  return [
    '### Imágenes de workers publicadas (referencia inmutable, MSF-712)',
    '',
    'Copiá cada línea a la variable `*_IMAGEN` del `.env` del ambiente (secret VPS_DEPLOY_ENV); el despliegue rechaza `:latest`.',
    '',
    '```',
    ...lineas,
    '```',
    '',
  ].join('\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(resumen(readFileSync(process.argv[2], 'utf8')));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
