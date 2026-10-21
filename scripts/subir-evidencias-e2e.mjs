// Sube videos + manifiesto de cobertura E2E al bucket `evidencias-e2e` (spec 022).
//
// Se omite sin fallar si faltan las credenciales (corridas públicas sin secret):
//   EVIDENCIAS_E2E_URL (p. ej. https://<host>:9301) y EVIDENCIAS_E2E_SERVICE_ROLE_KEY.
//
// Uso:
//   node scripts/subir-evidencias-e2e.mjs --manifiesto <cobertura.json> --videos <test-results> --run-id <id>
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { argumentValue } from './operaciones.mjs';

const BUCKET = 'evidencias-e2e';

// Storage rechaza claves no ASCII (`InvalidKey`): el nombre que genera Playwright
// puede traer acentos («edición»). Se sanea la ruta y se reescribe el manifiesto
// para que el visor pida exactamente la clave que existe.
export function claveSegura(ruta) {
  return ruta
    .replace(/\\/g, '/')
    .split('/')
    // `..` no puede venir de `relative()`, pero nunca se sube fuera del run.
    .filter((parte) => parte !== '.' && parte !== '..')
    .map((parte) => {
      const limpio = parte
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!limpio) return 'x';
      return limpio.startsWith('.') ? `x${limpio}` : limpio;
    })
    .join('/');
}

export function sanearManifiesto(manifiesto) {
  for (const evidencia of manifiesto.evidencias ?? []) {
    if (evidencia.video) evidencia.video = claveSegura(evidencia.video);
  }
  return manifiesto;
}

async function subir(url, serviceKey, remoto, bytes, contentType) {
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${remoto}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!r.ok) throw new Error(`subida ${remoto}: ${r.status} ${await r.text()}`);
}

function listarWebm(dir, acc = []) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) listarWebm(ruta, acc);
    else if (entrada.name.endsWith('.webm')) acc.push(ruta);
  }
  return acc;
}

const esEjecucionDirecta = process.argv[1] != null && resolve(process.argv[1]).endsWith('subir-evidencias-e2e.mjs');
if (esEjecucionDirecta) {
  const args = process.argv.slice(2);
  const url = process.env.EVIDENCIAS_E2E_URL;
  const serviceKey = process.env.EVIDENCIAS_E2E_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.log('sin EVIDENCIAS_E2E_URL o EVIDENCIAS_E2E_SERVICE_ROLE_KEY: se omite la subida al bucket.');
    process.exit(0);
  }
  const manifiesto = argumentValue(args, '--manifiesto');
  const dirVideos = argumentValue(args, '--videos');
  const runId = argumentValue(args, '--run-id', `run-${Date.now()}`);
  if (!manifiesto || !dirVideos) throw new Error('Uso: node scripts/subir-evidencias-e2e.mjs --manifiesto <json> --videos <test-results> [--run-id <id>]');
  const manifiestoJson = sanearManifiesto(JSON.parse(readFileSync(manifiesto, 'utf8')));
  const manifiestoBytes = Buffer.from(JSON.stringify(manifiestoJson, null, 2));
  await subir(url, serviceKey, `${runId}/cobertura-e2e.json`, manifiestoBytes, 'application/json');
  // Puntero a la última corrida: el visor lee `latest/` sin conocer run-ids.
  await subir(url, serviceKey, 'latest/cobertura-e2e.json', manifiestoBytes, 'application/json');
  let n = 0;
  if (existsSync(dirVideos) && statSync(dirVideos).isDirectory()) {
    for (const video of listarWebm(dirVideos)) {
      // Misma ruta relativa que registra el manifiesto: el visor la une al prefijo del run.
      const remoto = `${runId}/${claveSegura(relative(dirVideos, video))}`;
      await subir(url, serviceKey, remoto, readFileSync(video), 'video/webm');
      n += 1;
    }
  }
  console.log(`manifiesto + ${n} videos subidos a ${BUCKET}/${runId}/`);
}
