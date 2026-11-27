// Pruebas del guard de credenciales por defecto en los Compose (MSF-705). Cada mutante cambia UNA cosa del caso base.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analizarProducto, analizarRaiz, conDefectoPublico, interpolaciones, obligatorias } from './verificar-compose-credenciales.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'services:\n  a:\n    environment:\n      P: ${A_PASSWORD:-change-me-local}\n      Q: ${B_URL:-postgres://postgres:postgres@h:${PUERTO:-7634}/postgres}\n      R: ${C_ID:-}\n';
const ESTRICTO = 'x-variables-obligatorias:\n  a: ${A_PASSWORD:?falta}\n  b: ${B_URL:?falta}\n';

test('interpolaciones: anidadas, operadores y texto roto sin colgarse', () => {
  assert.deepEqual(interpolaciones('${A:-x${B:-1}y} ${C:?m} ${D} ${E-z}').map((x) => [x.nombre, x.operador]), [['A', ':-'], ['B', ':-'], ['C', ':?'], ['D', ''], ['E', '-']]);
  assert.deepEqual(interpolaciones('${A:-sin cierre'), []);
  assert.deepEqual(interpolaciones('sin nada'), []);
  assert.deepEqual(interpolaciones('${1mal:-x}'), []);
});

test('conDefectoPublico y obligatorias', () => {
  assert.deepEqual([...conDefectoPublico(BASE).keys()], ['A_PASSWORD', 'B_URL']);
  assert.deepEqual([...obligatorias(ESTRICTO)], ['A_PASSWORD', 'B_URL']);
  assert.deepEqual([...conDefectoPublico('X_PASSWORD: ${X_PASSWORD:-valorPropioLargo9}')].length, 0, 'un valor que no es público no se marca');
});

test('analizarProducto: caso base limpio y cada mutante falla por una sola razón', () => {
  assert.deepEqual(analizarProducto('p', BASE, ESTRICTO), []);
  const m1 = analizarProducto('p', BASE, 'x:\n  a: ${A_PASSWORD:?falta}\n');
  assert.equal(m1.length, 1);
  assert.match(m1[0], /B_URL no es obligatoria/);
  const m2 = analizarProducto('p', BASE, 'x:\n  a: ${A_PASSWORD:-change-me-local}\n  b: ${B_URL:?falta}\n');
  assert.ok(m2.some((h) => /A_PASSWORD/.test(h)), 'un `:-` en el overlay no cuenta como obligatoria');
  const m3 = analizarProducto('p', `${BASE}      S: \${NUEVA_SECRET_KEY:-change-me-algo}\n`, ESTRICTO);
  assert.deepEqual(m3.map((h) => /NUEVA_SECRET_KEY/.test(h)), [true], 'una credencial nueva con valor por defecto sin cubrir falla');
  const sinOverlay = analizarProducto('q', BASE, null);
  assert.equal(sinOverlay.length, 2);
  assert.match(sinOverlay[0], /no tiene compose\.estricto\.yaml/);
  assert.deepEqual(analizarProducto('q', 'x: ${C_ID:-}\n', null), []);
});

test('las claves anon públicas están exentas por nombre y una exenta con otro nombre NO', () => {
  assert.deepEqual(analizarProducto('p', 'x: ${AVISOS_FALTANTES_APIKEY:-change-me-local}\n', 'y: 1\n'), []);
  assert.equal(analizarProducto('p', 'x: ${OTRA_APIKEY:-change-me-local}\n', 'y: 1\n').length, 1);
});

test('el repositorio real cumple el guard', () => {
  assert.deepEqual(analizarRaiz(raiz), []);
});

test('mutante sobre el repo real: quitar una obligatoria del overlay de kestra hace fallar el guard (y el CLI sale 1)', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'compose-cred-'));
  await cp(path.join(raiz, 'infra'), path.join(tmp, 'infra'), { recursive: true });
  const ruta = path.join(tmp, 'infra', 'kestra', 'compose.estricto.yaml');
  const original = await readFile(ruta, 'utf8');
  assert.deepEqual(analizarRaiz(tmp), []);
  await writeFile(ruta, original.split('\n').filter((l) => !l.includes('kestra_backups_pgdump_url:')).join('\n'));
  assert.match(analizarRaiz(tmp).join('\n'), /KESTRA_BACKUPS_PGDUMP_URL no es obligatoria/);
  const r = spawnSync(process.execPath, [path.join(raiz, 'scripts', 'verificar-compose-credenciales.mjs'), tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  // Un producto sin overlay que gana un secreto por defecto también falla.
  await writeFile(ruta, original);
  const refine = path.join(tmp, 'infra', 'refine', 'compose.yaml');
  await writeFile(refine, `${await readFile(refine, 'utf8')}\n# x: \${NUEVA_PASSWORD:-change-me-local}\n`);
  assert.match(analizarRaiz(tmp).join('\n'), /infra\/refine\/compose\.yaml: NUEVA_PASSWORD/);
});
