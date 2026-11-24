// Control de la subida del reporte de la medición: lista blanca (formato esperado de los tres resúmenes) como
// barrera primaria y lista negra de patrones de credencial como segunda; falla cerrado. Los archivos «reales»
// de abajo son los del run 45480028805 del job `medir`.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ARCHIVOS_DEL_ARTEFACTO, MAX_BYTES, motivos, revisar } from './verificar-reporte-sin-credenciales.mjs';

const raiz = path.resolve(import.meta.dirname, '..');
const script = path.join(import.meta.dirname, 'verificar-reporte-sin-credenciales.mjs');
const JWT = 'eyJhbGciOiJIUzI1NiJ9.AAAAAAAAAAAA.BBBBBBBBBBBB';

const REAL_MD = "| Pantalla | URL | Corridas | LCP | FCP | CLS | TBT | Perf. | A11y |\n|---|---|---|---|---|---|---|---|---|\n| Mundo JC · catálogo | http://mundojc.localhost:4312/catalogo | 3 | 10829 ms | 9201 ms | 0.215 | 67 ms | 45 | 100 |\n| Mundo JC · ficha | http://mundojc.localhost:4312/producto/ba900000-0000-4000-8000-000000000001 | 3 | 10428 ms | 9300 ms | 0.098 | 6 ms | 54 | 100 |\n| San Javucho · catálogo | http://sanjavucho.localhost:4312/catalogo | 3 | 10788 ms | 9159 ms | 0.215 | 59 ms | 46 | 100 |\n| San Javucho · ficha | http://sanjavucho.localhost:4312/producto/bb900000-0000-4000-8000-000000000001 | 3 | 10435 ms | 9302 ms | 0.098 | 6 ms | 54 | 100 |\n\nObjetivo: LCP ≤ 3000 ms (celular 390×844, CPU ×4, «4G lento»). LCP máximo medido: 10829 ms. Veredicto: NO cumple.\nLínea base del job `medir`: 14000 ms (si el máximo la supera, es una regresión y el job falla). Estado: sin regresión.\nEl job `medir` falla si alguna ruta no se midió, si el LCP no llega al objetivo (3000 ms) o si supera la línea base (14000 ms).\n";
const REAL_JSON = "{\n  \"objetivoLcpMs\": 3000,\n  \"lineaBaseLcpMs\": 14000,\n  \"filas\": [\n    {\n      \"etiqueta\": \"Mundo JC · catálogo\",\n      \"url\": \"http://mundojc.localhost:4312/catalogo\",\n      \"corridas\": 3,\n      \"lcp\": 10828.846,\n      \"fcp\": 9201.129,\n      \"cls\": 0.21486736632208717,\n      \"tbt\": 67.38900000000103,\n      \"performance\": 0.45,\n      \"accessibility\": 1\n    },\n    {\n      \"etiqueta\": \"Mundo JC · ficha\",\n      \"url\": \"http://mundojc.localhost:4312/producto/ba900000-0000-4000-8000-000000000001\",\n      \"corridas\": 3,\n      \"lcp\": 10428.332,\n      \"fcp\": 9300.351,\n      \"cls\": 0.09769161261553898,\n      \"tbt\": 5.786000000000058,\n      \"performance\": 0.54,\n      \"accessibility\": 1\n    },\n    {\n      \"etiqueta\": \"San Javucho · catálogo\",\n      \"url\": \"http://sanjavucho.localhost:4312/catalogo\",\n      \"corridas\": 3,\n      \"lcp\": 10787.626,\n      \"fcp\": 9159.442,\n      \"cls\": 0.21513456682642998,\n      \"tbt\": 59.33600000000115,\n      \"performance\": 0.46,\n      \"accessibility\": 1\n    },\n    {\n      \"etiqueta\": \"San Javucho · ficha\",\n      \"url\": \"http://sanjavucho.localhost:4312/producto/bb900000-0000-4000-8000-000000000001\",\n      \"corridas\": 3,\n      \"lcp\": 10435.113,\n      \"fcp\": 9302.443,\n      \"cls\": 0.09795881311988178,\n      \"tbt\": 5.5090000000000146,\n      \"performance\": 0.54,\n      \"accessibility\": 1\n    }\n  ],\n  \"lcpMaximo\": 10828.846,\n  \"sinMedir\": [],\n  \"cumple\": false,\n  \"regresion\": false\n}\n";
const REAL_TXT = "BEGIN\nDO\n set_config \n------------\n 500\n(1 row)\n\nDO\nINSERT 0 1\nINSERT 0 1\nINSERT 0 1\nINSERT 0 500\nINSERT 0 500\nUPDATE 250\npsql:<stdin>:85: NOTICE:  catalogo relevancia -> mediana 12 ms · corridas {17,12,12,12,12} · productos en la pagina 24 · total 500\npsql:<stdin>:85: NOTICE:  catalogo precio_asc -> mediana 60 ms · corridas {60,59,61,59,60} · productos en la pagina 24 · total 500\npsql:<stdin>:85: NOTICE:  catalogo precio_desc -> mediana 60 ms · corridas {60,60,60,64,60} · productos en la pagina 24 · total 500\npsql:<stdin>:85: NOTICE:  catalogo precio_max -> mediana 57 ms · corridas {63,59,57,56,57} · productos en la pagina 24 · total 200\npsql:<stdin>:85: NOTICE:  catalogo solo_stock -> mediana 14 ms · corridas {14,14,14,14,14} · productos en la pagina 24 · total 250\nDO\nROLLBACK\n";

function carpeta(archivos = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
  const rutas = {};
  for (const [nombre, contenido] of Object.entries(archivos)) {
    rutas[nombre] = path.join(dir, nombre);
    writeFileSync(rutas[nombre], contenido);
  }
  return { dir, rutas };
}
const reales = () => carpeta({ 'resumen.md': REAL_MD, 'resumen.json': REAL_JSON, 'rpc-catalogo.txt': REAL_TXT });
const revisarUno = (nombre, contenido) => revisar(Object.values(carpeta({ [nombre]: contenido }).rutas));
const nightly = () => readFileSync(path.join(raiz, '.github', 'workflows', 'nightly.yml'), 'utf8');

describe('lista blanca: los tres archivos reales', () => {
  it('pasan', () => {
    assert.deepEqual(revisar(Object.values(reales().rutas)), []);
  });

  it('el artefacto del workflow sube exactamente la lista del script', () => {
    const bloque = nightly().split('- name: Subir el reporte de la medición')[1].split('path: |')[1].split('if-no-files-found')[0];
    const subidos = bloque.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(subidos, ARCHIVOS_DEL_ARTEFACTO);
  });

  it('el workflow corre el control antes del resumen y condiciona resumen y subida a que pase', () => {
    const yml = nightly();
    assert.ok(yml.indexOf('id: credenciales') < yml.indexOf('- name: Resumen en $GITHUB_STEP_SUMMARY'));
    assert.equal((yml.match(/steps\.credenciales\.conclusion == 'success'/g) ?? []).length, 2);
  });
});

describe('falla cerrado', () => {
  it('falla si no hay ninguno de los archivos esperados (sin argumentos)', () => {
    const vacio = mkdtempSync(path.join(tmpdir(), 'vacio-'));
    const r = spawnSync('node', [script], { cwd: vacio, encoding: 'utf8' });
    assert.equal(r.status, 1);
    for (const f of ARCHIVOS_DEL_ARTEFACTO) assert.ok(r.stderr.includes(f), f);
    assert.match(r.stderr, /falta/);
  });

  it('falla si falta uno solo de los tres', () => {
    const { dir } = carpeta({ 'resumen.md': REAL_MD, 'resumen.json': REAL_JSON });
    const h = revisar(['resumen.md', 'resumen.json', 'rpc-catalogo.txt'].map((n) => path.join(dir, n)));
    assert.equal(h.length, 1);
    assert.match(h[0], /rpc-catalogo\.txt: falta/);
  });

  it('un archivo de 30 MB falla cerrado y rápido, sin RangeError', () => {
    const grande = Buffer.concat([Buffer.from('eyJ'), Buffer.alloc(30 * 1024 * 1024, 'A')]);
    assert.ok(grande.length > MAX_BYTES);
    const { rutas } = carpeta({ 'resumen.md': grande });
    const t = Date.now();
    const r = spawnSync('node', [script, rutas['resumen.md']], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /demasiado grande/);
    assert.ok(!/RangeError/.test(r.stderr));
    assert.ok(Date.now() - t < 5000);
  });

  it('una línea desconocida en resumen.md falla y no se imprime', () => {
    const { rutas } = carpeta({ 'resumen.md': `${REAL_MD}${JWT}\n` });
    const r = spawnSync('node', [script, rutas['resumen.md']], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.ok(!(r.stdout + r.stderr).includes(JWT));
  });

  it('un texto sin forma de credencial pero fuera de formato también falla', () => {
    const raro = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';
    assert.equal(revisarUno('resumen.md', `${REAL_MD}${raro}\n`).length, 1);
    assert.equal(revisarUno('rpc-catalogo.txt', `${REAL_TXT}${raro}\n`).length, 1);
  });

  it('resumen.json: clave desconocida, string largo, URL rara o JSON roto fallan', () => {
    const j = JSON.parse(REAL_JSON);
    assert.equal(revisarUno('resumen.json', JSON.stringify({ ...j, extra: 'x' })).length, 1);
    assert.equal(revisarUno('resumen.json', JSON.stringify({ ...j, sinMedir: ['A'.repeat(300)] })).length, 1);
    const f = structuredClone(j);
    f.filas[0].url = `http://mundojc.localhost:4312/producto/${'a'.repeat(80)}`;
    assert.equal(revisarUno('resumen.json', JSON.stringify(f)).length, 1);
    assert.equal(revisarUno('resumen.json', 'no es json').length, 1);
  });

  it('la prosa legítima no marca la lista negra, pero la lista blanca la rechaza: no es un formato que genere el script', () => {
    const prosa = 'Sin secrets ni tokens; password policy: none';
    assert.deepEqual(motivos(prosa), []);
    assert.equal(revisarUno('resumen.md', `${REAL_MD}${prosa}\n`).length, 1);
  });
});

describe('lista negra (segunda barrera)', () => {
  for (const [caso, texto] of [
    ['un JWT', JWT],
    ['un JWT partido por un espacio', 'eyJhbGciOi JIUzI1NiJ9.AAAA'],
    ['un JWT con la e codificada', '%65yJhbGciOiJIUzI1NiJ9.AAAA'],
    ['token%3D en una URL', 'https://x/a?token%3Dabcdefghijklmnopqrstu'],
    ['signature%3D en una URL', 'https://x/a?signature%3Dabcdefghijklmnopqrstu'],
    ['Bearer con tabulación', 'Bearer\tabcdefghijkl'],
    ['Bearer con salto de línea', 'Bearer\nabcdefghijkl'],
    ['authorization con espacio antes de los dos puntos', 'authorization :x'],
    ['Authorization en mayúsculas', 'Authorization: x'],
    ['apiKey con valor', 'apiKey=abcdefghijklmnop'],
    ['access_token con valor', 'access_token: abcdefghijklmnop'],
    ['sb_secret_', 'sb_secret_abc'],
    ['una clave de Stripe', 'sk_live_abc'],
    ['x-amz-signature', 'X-Amz-Signature=abc'],
  ]) {
    it(`detecta ${caso}`, () => {
      assert.ok(motivos(texto).length > 0, caso);
    });
  }

  it('un `%` suelto no rompe la decodificación', () => {
    assert.deepEqual(motivos('100% de cobertura'), []);
  });

  it('una credencial en un archivo con formato válido igual marca la lista negra', () => {
    const h = revisarUno('rpc-catalogo.txt', `${REAL_TXT}${JWT}\n`);
    assert.equal(h.length, 1);
    assert.match(h[0], /JWT/);
  });
});
