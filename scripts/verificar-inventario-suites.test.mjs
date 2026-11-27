import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHIVOS_EXCLUIDOS, EXCLUIDAS, alcanzables, correArchivo, globACoincide, inventario, sinComentarios, scriptsInvocados } from './verificar-inventario-suites.mjs';

const base = () => ({
  scripts: { 'test:a': 'node --test scripts/a.test.mjs', 'test:ci:scripts': 'node scripts/correr-suites.mjs "pnpm -s test:a" "pnpm -s test:b"', 'test:b': 'node --test scripts/*.b.test.mjs' },
  textoWorkflows: 'run: pnpm test:ci:scripts',
  excluidas: {},
  archivosExcluidos: {},
  archivosTest: ['scripts/a.test.mjs', 'scripts/x.b.test.mjs'],
});

test('un inventario completo no da errores', () => {
  assert.deepEqual(inventario(base()), []);
});

test('scriptsInvocados reconoce pnpm, pnpm -s y pnpm run', () => {
  assert.deepEqual(scriptsInvocados('pnpm a && pnpm -s b; pnpm run c "pnpm -s d"'), ['a', 'b', 'c', 'd']);
});

test('alcanzables sigue las invocaciones y no se cuelga con ciclos', () => {
  const r = alcanzables({ x: 'pnpm y', y: 'pnpm x' }, 'pnpm x');
  assert.deepEqual([...r].sort(), ['x', 'y']);
});

test('una suite test:* que ningún workflow alcanza es error', () => {
  const e = inventario({ ...base(), scripts: { ...base().scripts, 'test:suelta': 'node --test scripts/s.test.mjs' } });
  assert.equal(e.length, 1);
  assert.match(e[0], /suite «test:suelta»: ningún workflow la corre/);
});

test('un archivo de test que ningún script corre es error', () => {
  const e = inventario({ ...base(), archivosTest: [...base().archivosTest, 'scripts/huerfano.test.mjs'] });
  assert.equal(e.length, 1);
  assert.match(e[0], /archivo de test «scripts\/huerfano.test.mjs»: ningún script/);
});

test('una exclusión que ya corre, que ya no existe o que la doc no nombra es error', () => {
  const excluidas = { 'test:x': 'motivo' };
  const ok = inventario({ ...base(), excluidas, scripts: { ...base().scripts, 'test:x': 'node x' }, textoDocs: 'test:x' });
  assert.deepEqual(ok, []);
  const corre = inventario({ ...base(), excluidas, scripts: { ...base().scripts, 'test:x': 'node x' }, textoWorkflows: `${base().textoWorkflows} pnpm test:x`, textoDocs: 'test:x' });
  assert.deepEqual(corre, ['exclusión «test:x»: el CI ya la corre; quitarla de EXCLUIDAS y de docs/control-ci.md.']);
  const vieja = inventario({ ...base(), excluidas, textoDocs: 'test:x' });
  assert.deepEqual(vieja, ['exclusión «test:x»: ya no existe en package.json; quitarla de EXCLUIDAS.']);
  const sinDoc = inventario({ ...base(), excluidas, scripts: { ...base().scripts, 'test:x': 'node x' }, textoDocs: 'nada' });
  assert.deepEqual(sinDoc, ['exclusión «test:x»: docs/control-ci.md no la nombra («Qué tests corre el CI y cuáles deja fuera»).']);
});

test('las exclusiones reales tienen motivo no vacío', () => {
  for (const [k, v] of [...Object.entries(EXCLUIDAS), ...Object.entries(ARCHIVOS_EXCLUIDOS)]) assert.ok(v.length > 10, k);
});

test('el agregado test no cuenta como suite suelta', () => {
  assert.deepEqual(inventario({ ...base(), scripts: { ...base().scripts, test: 'pnpm test:a' } }), []);
});

test('un archivo excluido con motivo no es error', () => {
  const archivosExcluidos = { 'infra/x.test.mjs': 'usa docker' };
  assert.deepEqual(inventario({ ...base(), archivosExcluidos, archivosTest: [...base().archivosTest, 'infra/x.test.mjs'] }), []);
});

// Fronteras del glob de un segmento (`*` no cruza `/`).
test('globACoincide', () => {
  const casos = [
    ['scripts/*.test.mjs', 'scripts/a.test.mjs', true],
    ['scripts/*.test.mjs', 'scripts/sub/a.test.mjs', false],
    ['scripts/*.test.mjs', 'scripts/a.test.mjs.bak', false],
    ['a/*/b/*.mjs', 'a/x/b/c.mjs', true],
    ['a/*/b/*.mjs', 'a/x/y/b/c.mjs', false],
    ['scripts/a.test.mjs', 'scripts/a.test.mjs', true],
    ['scripts/a.test.mjs', 'scripts/b.test.mjs', false],
  ];
  for (const [glob, ruta, esperado] of casos) assert.equal(globACoincide(glob, ruta), esperado, `${glob} vs ${ruta}`);
});

test('correArchivo: workspaces por nombre o por carpeta, y solo ahí', () => {
  const t = 'pnpm --filter @workers/w --filter ./packages/p test';
  assert.equal(correArchivo('workers/w/test/a.test.ts', t, '@workers/w'), true);
  assert.equal(correArchivo('packages/p/src/a.test.ts', t, '@platform/p'), true);
  assert.equal(correArchivo('workers/otro/test/a.test.ts', t, '@workers/otro'), false);
  assert.equal(correArchivo('workers/otro/test/a.test.ts', 'pnpm --filter "./workers/*" test', '@workers/otro'), true);
  assert.equal(correArchivo('scripts/a.test.mjs', 'pnpm --filter ./scripts test', undefined), false);
});

test('un comentario de workflow con `pnpm test:x` no cuenta como que corre', () => {
  const e = inventario({ ...base(), scripts: { ...base().scripts, 'test:c': 'node x' }, textoWorkflows: `${base().textoWorkflows}\n      # pnpm test:c\n      - run: echo hola # pnpm test:c` });
  assert.equal(e.length, 1);
  assert.match(e[0], /suite «test:c»/);
  const vivo = inventario({ ...base(), scripts: { ...base().scripts, 'test:c': 'node x' }, textoWorkflows: `${base().textoWorkflows}\n      - run: pnpm test:c` });
  assert.deepEqual(vivo.filter((x) => x.includes('test:c')), []);
});

test('sinComentarios: línea completa, comentario tras espacio y # sin espacio previo se respetan', () => {
  assert.equal(sinComentarios('  # a\nrun: x # b\nrun: y#z'), '\nrun: x\nrun: y#z');
  assert.equal(sinComentarios('run: x\t# b'), 'run: x');
  assert.equal(sinComentarios('run: x;# b'), 'run: x;');
  assert.equal(sinComentarios('run: x;#b pnpm test:z'), 'run: x;');
  assert.equal(sinComentarios('run: echo "a #b" && pnpm test:z'), 'run: echo "a');  // límite conservador documentado
  assert.equal(sinComentarios('# \n#x'), '\n');
});
