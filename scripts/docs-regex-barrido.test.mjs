// Barrido automático anti-ReDoS (MSF-869). Enumera con readdirSync todos los `scripts/docs-*.mjs` (sin tests) más
// `verificar-documentacion-cambios.mjs` (no hay lista fija: un script nuevo entra solo), extrae TODAS sus regex literales y las
// ejecuta con entradas hostiles de 100 000 caracteres (prefijo + repetición + terminador en el medio + cola). Cualquier
// regex que tarde más de 1 s falla el test: se reemplaza por parseo lineal (docs-lineas.mjs). Los terminadores van EN EL
// MEDIO: al final de una línea `trim()` los elimina y el caso lento no se ejercita.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { leerMapaDocs } from './docs-correspondencia.mjs';
import { paginasNav } from './docs-check.mjs';
import { erroresFrontMatter, erroresYaml } from './docs-yaml.mjs';

const aqui = import.meta.dirname;
const ARCHIVOS = [...readdirSync(aqui).filter((f) => /^docs-.+\.mjs$/.test(f) && !f.includes('.test.')), 'verificar-documentacion-cambios.mjs'].sort();
const N = 100000;
const TOPE_MS = 1000;
const CARACTERES = [' ', '\t', ' ', '-', '#', ':', 'x', '\r', ' ', ' ', '\u0085', '"', "'", '[', ',', '/'];
const TERMINADORES = ['', '\r', ' ', ' ', '\u0085', '\n'];
const PREFIJOS = ['', 'sources:', '  - ', 'a', '---\n', '# ', 'x: ', '  - "'];
const COLAS = ['x', ' #', '\u2028x'];

// Regex literales: precedidas por un delimitador de expresión (no una división) y en una sola línea.
const LITERAL = /(?<=(?:^|[(,=:[!&|?{};]|\breturn|\bin|=>)\s*)\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/gm;
function extraer() {
  const regex = [];
  for (const archivo of ARCHIVOS) {
    const texto = readFileSync(path.join(aqui, archivo), 'utf8');
    texto.split('\n').forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return; // comentarios
      for (const m of linea.matchAll(LITERAL)) {
        try { regex.push({ archivo, linea: i + 1, fuente: m[1], banderas: m[2], re: new RegExp(m[1], m[2].replace('g', '')) }); } catch { /* no era una regex */ }
      }
    });
  }
  return regex;
}

const regex = extraer();
const tabla = [];

describe('barrido de regex (100 000 caracteres hostiles, tope 1 s)', () => {
  it('encuentra las regex de los scripts', () => {
    assert.ok(regex.length >= 40, `solo ${regex.length} regex extraídas`);
    // Un archivo sin regex es válido; estos sí las tienen y tienen que estar enumerados.
    for (const archivo of ['docs-check.mjs', 'docs-drift.mjs', 'docs-enlaces.mjs', 'docs-inventario.mjs', 'docs-manifest.mjs', 'docs-yaml.mjs', 'verificar-documentacion-cambios.mjs']) assert.ok(ARCHIVOS.includes(archivo), `${archivo} no enumerado`);
  });

  for (const r of regex) {
    it(`${r.archivo}:${r.linea} /${r.fuente}/${r.banderas}`, () => {
      let max = 0;
      let peor = '';
      for (const c of CARACTERES) {
        const bloque = c.repeat(N);
        for (const pre of PREFIJOS) for (const term of TERMINADORES) for (const cola of COLAS) {
          for (const entrada of [`${pre}${bloque}${term}${cola}`, `${pre}${bloque.slice(0, N / 2)}${term}${bloque.slice(0, N / 2)}${cola}`]) {
            const t0 = performance.now();
            r.re.exec(entrada);
            if (r.banderas.includes('g')) entrada.replace(new RegExp(r.fuente, r.banderas), '');
            const ms = performance.now() - t0;
            if (ms > max) { max = ms; peor = JSON.stringify(c) + '/' + JSON.stringify(term); }
            assert.ok(ms < TOPE_MS, `${ms | 0} ms con ${JSON.stringify(pre)} + ${N} ${JSON.stringify(c)} + ${JSON.stringify(term)} + ${JSON.stringify(cola)}`);
          }
        }
      }
      tabla.push(`${r.archivo}:${r.linea}\t${max | 0} ms\t${peor}`);
    });
  }

});

describe('barrido de funciones (terminadores en el medio)', () => {
  const dirs = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const mapa = (texto) => {
    const d = mkdtempSync(path.join(tmpdir(), 'barrido-'));
    dirs.push(d);
    mkdirSync(path.join(d, 'docs'));
    writeFileSync(path.join(d, 'docs/a.md'), texto);
    const t0 = performance.now();
    leerMapaDocs(d);
    return performance.now() - t0;
  };
  const casos = [];
  for (const c of [' ', '\t', ' ', '#', ':', '-', '"']) for (const term of ['\r', ' ', ' ', '\u0085']) casos.push([c, term]);

  for (const [c, term] of casos) {
    it(`front matter de sources: con ${JSON.stringify(c)} y ${JSON.stringify(term)} en el medio`, () => {
      const b = c.repeat(N);
      const comentario = ' #'.repeat(N / 2);
      for (const texto of [
        `---\nsources:${b}x${term}y\n---\n`,
        `---\nsources:\n  - ${b}x${term}y\n---\n`,
        `---\nsources:\n  -${b}${term}x\n---\n`,
        `---\nsources: [a,${b}${term}x]\n---\n`,
        `---\nsources:\n  - a${comentario}${term}x\n---\n`,
        `---\nsources: a${comentario}${term}x\n---\n`,
        `---\nso${b}urces:${term}x\n---\n`,
        `---\n${b}${term}x\n---\n`,
      ]) assert.ok(mapa(texto) < TOPE_MS);
    });
  }

  for (const [c, term] of casos) {
    it(`nav y YAML con ${JSON.stringify(c)} y ${JSON.stringify(term)} en el medio`, () => {
      const b = c.repeat(N);
      for (const yml of [`nav:\n  - ${b}x${term}y\n`, `nav:\n  -${b}${term}x: a.md\n`, `nav:\n  - Etiqueta${b}: ${b}${term}.md\n`, `exclude_docs:\n  ${b}${term}x\n`]) {
        const t0 = performance.now();
        paginasNav(yml);
        erroresYaml(yml);
        assert.ok(performance.now() - t0 < TOPE_MS);
      }
      const t0 = performance.now();
      erroresFrontMatter(`---\nowner: x\nsources:\n  - ${b}${term}y\n---\n`, 'docs/a.md');
      assert.ok(performance.now() - t0 < TOPE_MS);
    });
  }
});

const EXPORTADAS = [];
for (const archivo of ARCHIVOS) {
  if (!/^export /m.test(readFileSync(path.join(aqui, archivo), 'utf8'))) continue;
  const modulo = await import(path.join(aqui, archivo));
  for (const [nombre, valor] of Object.entries(modulo)) if (typeof valor === 'function') EXPORTADAS.push({ archivo, nombre, valor });
}

// Funciones exportadas de TODOS los docs-*.mjs enumerados (solo los que declaran `export`: los demás son scripts con
// efectos al importarse y no se importan). Cada una recibe cadenas hostiles; los errores de tipo se ignoran, el tiempo no.
describe('barrido de funciones exportadas (docs-*.mjs enumerados)', () => {
  const chars = [...CARACTERES, ']', '(', ')', '<', '>', '`', '!', '*', '|'];
  const prefijos = ['', '[a](', '```\n'];

  it('hay funciones exportadas que ejercitar', () => {
    assert.ok(EXPORTADAS.length >= 8, `solo ${EXPORTADAS.length}`);
  });

  for (const { archivo, nombre, valor } of EXPORTADAS) {
    it(`${archivo} ${nombre}()`, () => {
      let max = 0;
      for (const c of chars) {
        const b = c.repeat(N);
        for (const term of ['\r', '\u2028', '\u2029', '\u0085']) for (const pre of prefijos) {
          for (const entrada of [`${pre}${b}${term}x`, `${pre}a${b}${term}${b}y\n`]) {
            const t0 = performance.now();
            try { valor(entrada); } catch { /* firma distinta o ruta inexistente: solo importa el tiempo */ }
            const ms = performance.now() - t0;
            if (ms > max) max = ms;
            assert.ok(ms < TOPE_MS, `${archivo} ${nombre}: ${ms | 0} ms con ${JSON.stringify(pre)} + ${N} ${JSON.stringify(c)} + ${JSON.stringify(term)}`);
          }
        }
      }
      tabla.push(`${archivo} ${nombre}() [función]\t${max | 0} ms`);
    });
  }
});

after(() => { console.log(`# Tabla de regex y funciones medidas (máximo, entrada más lenta)\n${tabla.sort().join('\n')}`); });
