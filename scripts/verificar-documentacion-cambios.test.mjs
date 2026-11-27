import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const script = path.resolve('scripts/verificar-documentacion-cambios.mjs');
let dir;

const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

// Repo temporal con un commit base y un segundo commit que escribe `archivos`.
const comprobar = async (nombre, archivos, { env: extra = {}, args = [], base: baseFiles = {}, antes, nodeArgs = [] } = {}) => {
  const cwd = path.join(dir, nombre);
  await mkdir(cwd, { recursive: true });
  git(cwd, 'init', '-q');
  await writeFile(path.join(cwd, 'base.txt'), 'base');
  for (const [archivo, texto] of Object.entries(baseFiles)) {
    await mkdir(path.dirname(path.join(cwd, archivo)), { recursive: true });
    await writeFile(path.join(cwd, archivo), texto);
  }
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'base');
  const cambios = Array.isArray(archivos) ? Object.fromEntries(archivos.map((a) => [a, 'x'])) : archivos;
  for (const [archivo, texto] of Object.entries(cambios)) {
    await mkdir(path.dirname(path.join(cwd, archivo)), { recursive: true });
    await writeFile(path.join(cwd, archivo), texto);
  }
  if (antes) await antes(cwd);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'cambio');
  const env = { ...process.env, DOCUMENTATION_CHECK_BASE: 'HEAD~1', ...extra };
  delete env.GITHUB_BASE_REF;
  return spawnSync('node', [...nodeArgs, script, ...args], { cwd, env, encoding: 'utf8' });
};

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'docs-check-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('verificar-documentacion-cambios', () => {
  it('acepta .specify/bugs/<slug>/ como documentación de un bug-fix', async () => {
    const r = await comprobar('bugs', ['scripts/a.mjs', '.specify/bugs/msf-1/fix.md']);
    assert.equal(r.status, 0, r.stderr);
  });

  it('acepta la constitución en .specify/memory/', async () => {
    const r = await comprobar('memory', ['scripts/a.mjs', '.specify/memory/constitution.md']);
    assert.equal(r.status, 0, r.stderr);
  });

  it('rechaza plantillas o scripts de .specify/ como documentación', async () => {
    const r = await comprobar('plantilla', ['scripts/a.mjs', '.specify/templates/spec-template.md', '.specify/scripts/x.sh']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Fallo de documentación/);
  });

  it('rechaza código de tooling sin documentación', async () => {
    const r = await comprobar('sin-docs', ['scripts/a.mjs']);
    assert.equal(r.status, 1);
  });

  describe('correspondencia código-doc (MSF-869)', () => {
    const doc = '---\nowner: x\nsources:\n  - scripts/a.mjs\n  - apps/web/src/lib\n---\n# Doc\n';
    const base = { 'docs/a.md': doc, 'scripts/a.mjs': 'v0' };

    it('sin aviso si se toca el doc que corresponde al código', async () => {
      const r = await comprobar('corr-ok', { 'scripts/a.mjs': 'v1', 'docs/a.md': `${doc}\nCuerpo actualizado.\n` }, { base });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /::warning/);
    });

    it('avisa (exit 0) si el doc cambiado no es el que corresponde', async () => {
      const r = await comprobar('corr-aviso', ['scripts/a.mjs', 'docs/otro.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning file=docs\/a\.md::/);
      assert.match(r.stderr, /scripts\/a\.mjs/);
    });

    it('avisa también para archivos dentro de un directorio de sources', async () => {
      const r = await comprobar('corr-dir', ['apps/web/src/lib/x.ts', 'specs/s/spec.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning file=docs\/a\.md::/);
    });

    it('modo estricto (variable o --estricto) falla con exit 1', async () => {
      const a = await comprobar('corr-estricto-env', ['scripts/a.mjs', 'docs/otro.md'], { base, env: { DOCUMENTACION_CORRESPONDENCIA_ESTRICTA: '1' } });
      assert.equal(a.status, 1);
      assert.match(a.stderr, /::error file=docs\/a\.md::/);
      const b = await comprobar('corr-estricto-flag', ['scripts/a.mjs', 'docs/otro.md'], { base, args: ['--estricto'] });
      assert.equal(b.status, 1);
    });

    it('sin aviso si el archivo no figura en ningún sources:, o es un test', async () => {
      const r = await comprobar('corr-sin-asignar', ['scripts/b.mjs', 'scripts/a.test.mjs', 'docs/otro.md'], { base });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /::warning/);
    });

    it('el comportamiento heredado se mantiene: sin ningún doc falla aun en modo aviso', async () => {
      const r = await comprobar('corr-heredado', ['scripts/a.mjs'], { base });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Fallo de documentación/);
    });

    // Líneas que el runner de Actions interpretaría como comando: empiezan con `::` (tras sangría opcional).
    const comandos = (stderr) => stderr.split('\n').filter((l) => /^\s*::/.test(l));

    it('nombres maliciosos de archivo y de doc no inyectan comandos de Actions', async () => {
      const malos = ['q%0A::add-mask::secret.mjs', 'a::b.mjs', 'c,d:e.mjs', 'x\n::error::pwned.mjs'];
      const docMalo = 'docs/q%0A::add-mask::z,w:v.md';
      const baseMala = {
        [docMalo]: '---\nsources:\n  - scripts/sub\n---\n',
        'docs/b.md': '---\nsources:\n  - scripts/sub\n---\n',
      };
      for (const estricto of [false, true]) {
        const r = await comprobar(`corr-inyeccion-${estricto}`, [...malos.map((m) => `scripts/sub/${m}`), 'docs/otro.md'], { base: baseMala, args: estricto ? ['--estricto'] : [] });
        assert.equal(r.status, estricto ? 1 : 0, r.stderr);
        const lineas = comandos(r.stderr);
        assert.equal(lineas.length, 2, r.stderr); // solo las 2 anotaciones del script (una por doc)
        for (const l of lineas) assert.match(l, new RegExp(`^::${estricto ? 'error' : 'warning'} file=[^:,\\n]*::[^\\n]*$`), l);
        // Ninguna línea de salida (sangrada o no) que no sea una de esas 2 empieza con `::`.
        assert.equal(r.stderr.split('\n').filter((l) => /^\s*::/.test(l) && !/^::(warning|error) file=/.test(l)).length, 0, r.stderr);
        assert.ok(r.stderr.includes('%250A'), 'el % del nombre se escapa y no se decodifica');
      }
    });

    it('un symlink roto o una carpeta *.md en docs/ no rompen el modo aviso', async () => {
      const antes = async (cwd) => {
        await symlink(path.join(cwd, 'no-existe'), path.join(cwd, 'docs/dangling.md'));
        await mkdir(path.join(cwd, 'docs/dir.md'), { recursive: true });
      };
      const r = await comprobar('corr-roto', ['scripts/a.mjs', 'docs/otro.md'], { base, antes });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /ENOENT|at /);
      assert.match(r.stderr, /::warning file=docs\/a\.md::/);
    });

    it('una excepción interna en la correspondencia: aviso exit 0, estricto exit 1', async () => {
      // Precarga que rompe localeCompare (se usa al ordenar los docs avisados), solo en este proceso.
      const precarga = path.join(dir, 'rompe-sort.mjs');
      await writeFile(precarga, "String.prototype.localeCompare = () => { throw new Error('falla simulada'); };\n");
      const dosDocs = { ...base, 'docs/b.md': doc.replace('# Doc', '# B') };
      const opts = { base: dosDocs, nodeArgs: ['--import', precarga] };
      const a = await comprobar('corr-excepcion', ['scripts/a.mjs', 'docs/otro.md'], opts);
      assert.equal(a.status, 0, a.stderr);
      assert.match(a.stderr, /::warning ::no se pudo verificar la correspondencia: falla simulada/);
      const e = await comprobar('corr-excepcion-estricta', ['scripts/a.mjs', 'docs/otro.md'], { ...opts, args: ['--estricto'] });
      assert.equal(e.status, 1);
      assert.match(e.stderr, /::error ::no se pudo verificar/);
    });

    it('rutas con caracteres no ASCII, espacios, comillas y saltos de línea generan aviso y salen neutralizadas', async () => {
      const baseSub = { 'docs/a.md': '---\nsources:\n  - scripts/sub\n---\n# Doc\n' };
      const nombres = ['scripts/sub/ñ.mjs', 'scripts/sub/con espacio.mjs', 'scripts/sub/comi"lla.mjs', 'scripts/sub/salto\n::error::pwned.mjs'];
      const r = await comprobar('corr-no-ascii', [...nombres, 'docs/otro.md'], { base: baseSub });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning file=docs\/a\.md::4 archivo\(s\)/);
      assert.match(r.stderr, /- scripts\/sub\/ñ\.mjs/);
      assert.match(r.stderr, /- scripts\/sub\/con espacio\.mjs/);
      assert.match(r.stderr, /salto\\n:\u200b:error/);
      assert.equal(r.stderr.split('\n').filter((l) => /^\s*::/.test(l) && !/^::warning file=/.test(l)).length, 0, r.stderr);
    });

    it('el chequeo heredado falla también con nombres no ASCII y acepta docs/specs con ellos', async () => {
      const a = await comprobar('heredado-ascii-no', ['scripts/ñ.mjs']);
      assert.equal(a.status, 1);
      assert.match(a.stderr, /Fallo de documentación/);
      assert.match(a.stderr, /- scripts\/ñ\.mjs/);
      const b = await comprobar('heredado-ok-no-ascii', ['scripts/ñ.mjs', 'docs/guía ñ.md']);
      assert.equal(b.status, 0, b.stderr);
    });
  });
  describe('capturas del manual (MSF-644)', () => {
    const pantalla = 'apps/web/src/pages/ventas/lista.tsx';

    it('avisa (exit 0) si una pantalla cambia sin rehacer capturas', async () => {
      const r = await comprobar('cap-aviso', [pantalla, 'docs/a.md']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /::warning ::1 pantalla\(s\) del panel cambiaron/);
      assert.match(r.stderr, /- apps\/web\/src\/pages\/ventas\/lista\.tsx/);
    });

    it('sin aviso si cambia una captura de docs/producto/img/', async () => {
      const r = await comprobar('cap-ok', [pantalla, 'docs/producto/img/ventas/01.png']);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /pantalla\(s\)/);
    });

    it('sin aviso para tests, estilos o archivos que no son pantallas', async () => {
      const r = await comprobar('cap-no-pantalla', ['apps/web/src/pages/ventas/lista.test.tsx', 'apps/web/src/lib/x.ts', 'apps/web/src/pages/ventas/x.css', 'apps/web/src/pages/e2e/y.tsx', 'docs/a.md']);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /pantalla\(s\)/);
    });

    it('una imagen que no es captura (otra carpeta o extensión) no cuenta', async () => {
      const r = await comprobar('cap-falsa', [pantalla, 'docs/otra/01.png', 'docs/producto/img/ventas/notas.md']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /pantalla\(s\)/);
    });

    it('modo estricto (variable o --capturas-estricto) falla con exit 1', async () => {
      const a = await comprobar('cap-estricto-env', [pantalla, 'docs/a.md'], { env: { CAPTURAS_MANUAL_ESTRICTO: '1' } });
      assert.equal(a.status, 1);
      assert.match(a.stderr, /::error ::1 pantalla/);
      const b = await comprobar('cap-estricto-flag', [pantalla, 'docs/a.md'], { args: ['--capturas-estricto'] });
      assert.equal(b.status, 1);
    });
  });
});
