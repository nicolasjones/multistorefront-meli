import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { anotacion, archivosSinDocCorrespondiente, escaparDato, escaparPropiedad, leerMapaDocs, lineaLista, motivosSinDoc } from './docs-correspondencia.mjs';

let dir;
before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'docs-corr-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

const doc = (nombre, sources) => ({ doc: nombre, sources });
const sinAviso = (cambiados, docs) => assert.deepEqual(archivosSinDocCorrespondiente(cambiados, docs), []);

describe('leerMapaDocs: formatos de sources:', () => {
  it('acepta lista en bloque, array en línea, escalar, CRLF, comentarios y comillas', async () => {
    const d = path.join(dir, 'formatos');
    await mkdir(path.join(d, 'docs/sub'), { recursive: true });
    const w = (n, t) => writeFile(path.join(d, 'docs', n), t);
    await w('bloque.md', '---\nowner: x\nsources:\n  - scripts/a.mjs\n  - "apps/web/"\n---\n# T\n');
    await w('linea.md', "---\nsources: [scripts/b.mjs, 'workers/c']\n---\n");
    await w('escalar.md', '---\nsources: scripts/d.mjs\n---\n');
    await w('crlf.md', '---\r\nowner: x\r\nsources:\r\n  - scripts/e.mjs\r\n---\r\n');
    await w('comentario.md', '---\nsources:\n  - scripts/f.mjs # nota\n  - scripts/g.mjs   # otra\n---\n');
    await w('vacio.md', '---\nsources: []\n---\n');
    await w('sin-front.md', '# nada\n');
    await w('sub/otro.md', '---\nsources:\n  - infra/runner\n---\n');
    const mapa = Object.fromEntries(leerMapaDocs(d).map((x) => [x.doc, x.sources]));
    assert.deepEqual(mapa, {
      'docs/bloque.md': ['scripts/a.mjs', 'apps/web'],
      'docs/linea.md': ['scripts/b.mjs', 'workers/c'],
      'docs/escalar.md': ['scripts/d.mjs'],
      'docs/crlf.md': ['scripts/e.mjs'],
      'docs/comentario.md': ['scripts/f.mjs', 'scripts/g.mjs'],
      'docs/sub/otro.md': ['infra/runner'],
    });
  });

  it('no se cae con symlink roto, carpeta llamada .md, archivo ilegible o sin docs/', async () => {
    const d = path.join(dir, 'roto');
    await mkdir(path.join(d, 'docs/carpeta.md'), { recursive: true });
    await writeFile(path.join(d, 'docs/ok.md'), '---\nsources:\n  - scripts/a.mjs\n---\n');
    await symlink(path.join(d, 'no-existe'), path.join(d, 'docs/dangling.md'));
    await writeFile(path.join(d, 'docs/cerrado.md'), '---\nsources:\n  - scripts/z.mjs\n---\n');
    await chmod(path.join(d, 'docs/cerrado.md'), 0o000);
    const docs = leerMapaDocs(d).map((x) => x.doc);
    // root puede leer un archivo 000; en usuario normal se omite. En ambos casos no debe lanzar.
    assert.ok(docs.includes('docs/ok.md'));
    assert.ok(!docs.includes('docs/dangling.md') && !docs.includes('docs/carpeta.md'));
    assert.deepEqual(leerMapaDocs(path.join(dir, 'no-hay-docs')), []);
  });
});

describe('archivosSinDocCorrespondiente', () => {
  it('avisa con el doc que corresponde y no avisa si ese doc cambió', () => {
    const docs = [doc('docs/a.md', ['scripts/a.mjs'])];
    assert.deepEqual(archivosSinDocCorrespondiente(['scripts/a.mjs'], docs), [{ archivo: 'scripts/a.mjs', docs: ['docs/a.md'] }]);
    sinAviso(['scripts/a.mjs', 'docs/a.md'], docs);
    assert.equal(archivosSinDocCorrespondiente(['scripts/a.mjs', 'docs/otro.md'], docs).length, 1);
  });

  it('con varios docs correspondientes basta con que cambie uno', () => {
    const docs = [doc('docs/a.md', ['scripts/a.mjs']), doc('docs/b.md', ['scripts/a.mjs'])];
    sinAviso(['scripts/a.mjs', 'docs/b.md'], docs);
  });

  it('excluye tests aunque estén bajo una carpeta de sources:', () => {
    const docs = [doc('docs/a.md', ['scripts/sub'])];
    sinAviso(['scripts/sub/a.test.mjs', 'scripts/sub/tests/x.mjs', 'scripts/sub/b.spec.ts', 'scripts/sub/__snapshots__/s.snap', 'scripts/sub/pnpm-lock.yaml'], docs);
    assert.equal(archivosSinDocCorrespondiente(['scripts/sub/real.mjs'], docs).length, 1);
  });

  it('una carpeta de sources: no cubre carpetas con el mismo prefijo', () => {
    const docs = [doc('docs/a.md', ['infra/superset'])];
    sinAviso(['infra/superset-otro/x.yml'], docs);
    assert.equal(archivosSinDocCorrespondiente(['infra/superset/x.yml'], docs).length, 1);
  });

  it('ignora fuentes que abarcan un área entera', () => {
    sinAviso(['infra/x/y.mjs', '.github/workflows/v.yml', 'scripts/q.mjs'], [doc('docs/a.md', ['infra', '.github/workflows', 'scripts'])]);
  });

  it('infra/kestra entera es una fuente amplia, pero un flow concreto sí exige su doc', () => {
    sinAviso(['infra/kestra/flows/a.yml'], [doc('docs/a.md', ['infra/kestra'])]);
    const docs = [doc('docs/a.md', ['infra/kestra']), doc('docs/b.md', ['infra/kestra/flows/a.yml'])];
    assert.deepEqual(archivosSinDocCorrespondiente(['infra/kestra/flows/a.yml'], docs), [{ archivo: 'infra/kestra/flows/a.yml', docs: ['docs/b.md'] }]);
  });

  it('excluye .md y .env.example del código relevante, pero no otros archivos de la misma carpeta', () => {
    const docs = [doc('docs/a.md', ['packages/mcp-server', 'supabase/functions/f'])];
    sinAviso(['packages/mcp-server/CONTRATO.md', 'supabase/functions/f/.env.example'], docs);
    assert.equal(archivosSinDocCorrespondiente(['packages/mcp-server/src/x.ts'], docs).length, 1);
    assert.equal(archivosSinDocCorrespondiente(['supabase/functions/f/handler.ts'], docs).length, 1);
    assert.equal(archivosSinDocCorrespondiente(['supabase/functions/f/env.example.ts'], docs).length, 1);
  });

  it('ignora docs con más de 40 fuentes y respeta el borde de 40', () => {
    const fuentes = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 'scripts/a.mjs' : `scripts/f${i}.mjs`));
    sinAviso(['scripts/a.mjs'], [doc('docs/a.md', fuentes(41))]);
    assert.equal(archivosSinDocCorrespondiente(['scripts/a.mjs'], [doc('docs/a.md', fuentes(40))]).length, 1);
  });

  it('excluye supabase/migrations/ y archivos fuera de las rutas de código', () => {
    sinAviso(['supabase/migrations/20270101000000_x.sql', 'README.md', 'docs/x.md'], [doc('docs/a.md', ['supabase/migrations', 'README.md', 'docs/x.md'])]);
  });
});

describe('escape de anotaciones', () => {
  it('escapa dato y propiedad como @actions/core', () => {
    assert.equal(escaparDato('a%b\r\nc'), 'a%25b%0D%0Ac');
    assert.equal(escaparPropiedad('c,d:e'), 'c%2Cd%3Ae');
  });

  it('una anotación con nombres maliciosos queda en una sola línea', () => {
    for (const mal of ['q%0A::add-mask::secret.mjs', 'x\n::error::pwned', 'a::b', 'c,d:e']) {
      const a = anotacion('warning', { file: mal }, `cambiaron: ${mal}`);
      assert.ok(!/[\r\n]/.test(a), a);
      assert.match(a, /^::warning file=[^:,]*::[^:]*(:[^:]*)*$/s);
      assert.ok(!a.slice(2).includes('\n'));
      const l = lineaLista(mal, '  ');
      assert.ok(!/[\r\n]/.test(l) && !l.includes('::') && /^ {2}- /.test(l), l);
    }
  });
});

// Topes de 5 s (no 1 s): una sola muestra en un host cargado (CI compartido) puede superar 1 s sin que haya un problema, mientras que una regex
// cuadrática con 200 000 caracteres tarda decenas de segundos. El barrido (docs-regex-barrido.test.mjs) usa topes de 1 s con mínimo de 3 mediciones.
describe('entradas patológicas (ReDoS)', () => {
  const N = 200000;
  const lee = async (nombre, texto) => {
    const d = path.join(dir, nombre);
    await mkdir(path.join(d, 'docs'), { recursive: true });
    await writeFile(path.join(d, 'docs/a.md'), texto);
    const t0 = performance.now();
    const mapa = leerMapaDocs(d);
    return { ms: performance.now() - t0, mapa };
  };

  for (const [nombre, caracter] of [['espacios', ' '], ['tabs', '\t'], ['almohadillas', '#'], ['barras', '/'], ['comillas', '"'], ['guiones', '-'], ['comas', ','], ['corchetes', '[']]) {
    it(`el parser es lineal con 200k ${nombre} en ítem, escalar y array`, async () => {
      for (const [forma, texto] of [
        ['item', `---\nsources:\n  - ${caracter.repeat(N)}x\n---\n`],
        ['item-final', `---\nsources:\n  - x${caracter.repeat(N)}\n---\n`],
        ['escalar', `---\nsources: ${caracter.repeat(N)}x\n---\n`],
        ['array', `---\nsources: [${caracter.repeat(N)}]\n---\n`],
      ]) {
        const { ms } = await lee(`redos-${nombre}-${forma}`, texto);
        assert.ok(ms < 5000, `${nombre}/${forma}: ${ms} ms`);
      }
    });
  }

  it('el resultado con espacios y barras finales sigue siendo correcto', async () => {
    const { mapa } = await lee('redos-resultado', '---\nsources:\n  - scripts/x///   \n  - scripts/y   # nota\n---\n');
    assert.deepEqual(mapa[0].sources, ['scripts/x', 'scripts/y']);
  });

  it('las rutas larguísimas no cuelgan el cálculo de relevancia', () => {
    const t0 = performance.now();
    archivosSinDocCorrespondiente([`scripts/${'.test'.repeat(N / 5)}`, `scripts/${'/'.repeat(N)}`], [doc('docs/a.md', ['scripts/sub'])]);
    assert.ok(performance.now() - t0 < 5000);
  });

  // Hueco anterior: las colas vacías o `x` no ejercitaban el caso lento (U+2028/U+2029/U+0085 tras blancos).
  for (const relleno of [' ', '\t', '\u00a0']) {
    for (const cola of ['\u2028', '\u2029', '\u0085']) {
      it(`ítem con 200k ${JSON.stringify(relleno)} y cola ${JSON.stringify(cola)} es lineal`, async () => {
        for (const [forma, texto] of [
          ['despues-del-guion', `---\nsources:\n  - ${relleno.repeat(N)}${cola}\n---\n`],
          ['antes-del-guion', `---\nsources:\n${relleno.repeat(N)}-${cola}\n---\n`],
          ['dentro', `---\nsources:\n  - x${relleno.repeat(N)}${cola}y\n---\n`],
          ['escalar', `---\nsources:${relleno.repeat(N)}${cola}\n---\n`],
          ['clave', `---\nsources${relleno.repeat(N)}${cola}:\n---\n`],
        ]) {
          const { ms } = await lee(`redos-u-${forma}`, texto);
          assert.ok(ms < 5000, `${forma}: ${ms} ms`);
        }
      });
    }
  }
});

describe('motivosSinDoc (excepción «Docs-no-aplica»)', () => {
  it('toma el motivo de cada línea que empieza con la marca y tiene 15 caracteres o más', () => {
    const texto = 'fix: x\n\nDocs-no-aplica: renombre interno sin efecto\n\nfeat: y\nDocs-no-aplica: solo formato de codigo\n';
    assert.deepEqual(motivosSinDoc(texto), ['renombre interno sin efecto', 'solo formato de codigo']);
  });

  it('frontera del motivo: 14 caracteres no vale, 15 sí', () => {
    assert.deepEqual(motivosSinDoc(`Docs-no-aplica: ${'a'.repeat(14)}`), []);
    assert.deepEqual(motivosSinDoc(`Docs-no-aplica: ${'a'.repeat(15)}`), ['a'.repeat(15)]);
    assert.deepEqual(motivosSinDoc(`Docs-no-aplica:${' '.repeat(5)}${'a'.repeat(14)}${' '.repeat(5)}`), []);
  });

  it('exige la marca al inicio de la línea y con esa capitalización; acepta CRLF', () => {
    assert.deepEqual(motivosSinDoc('  Docs-no-aplica: motivo suficientemente largo'), []);
    assert.deepEqual(motivosSinDoc('docs-no-aplica: motivo suficientemente largo'), []);
    assert.deepEqual(motivosSinDoc('texto Docs-no-aplica: motivo suficientemente largo'), []);
    assert.deepEqual(motivosSinDoc('Docs-no-aplica: motivo suficientemente largo\r\n'), ['motivo suficientemente largo']);
  });

  it('sin commits o sin marca no hay excepción', () => {
    assert.deepEqual(motivosSinDoc(''), []);
    assert.deepEqual(motivosSinDoc('feat: algo\n\ncuerpo'), []);
  });
});
