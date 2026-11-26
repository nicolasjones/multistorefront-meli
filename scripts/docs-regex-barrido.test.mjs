// Barrido automático anti-ReDoS (MSF-869). Enumera con readdirSync todos los `scripts/docs-*.mjs` (sin tests) más
// `verificar-documentacion-cambios.mjs` (no hay lista fija: un script nuevo entra solo), extrae TODAS sus regex literales
// (salvo la línea `#!`) y las ejecuta con entradas hostiles de 100 000 caracteres (prefijo + repetición + terminador en el
// medio + cola). También llama a cada función exportada de los scripts importables con las mismas entradas. Cada regex o
// función corre en un worker_thread con vigilancia: si no hay progreso en STUCK_MS (regex catastrófica) el
// worker se termina y el test falla en segundos NOMBRANDO archivo:línea; si termina pero tarda más de 1 s, también falla.
// Los terminadores van EN EL MEDIO: al final de una línea `trim()` los elimina y el caso lento no se ejercita.
// Convención: un `docs-*.mjs` con `export` no debe tener efectos al importarse (protegé su main con un guard
// `import.meta.url`); los que sí los tienen y no exportan nada (docs-drift, docs-inventario, docs-manifest y
// verificar-documentacion-cambios) NO se importan: de ellos se miden solo sus regex literales.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import { leerMapaDocs } from './docs-correspondencia.mjs';
import { paginasNav } from './docs-check.mjs';
import { erroresFrontMatter, erroresYaml } from './docs-yaml.mjs';

const aqui = import.meta.dirname;
const ARCHIVOS = [...readdirSync(aqui).filter((f) => /^docs-.+\.mjs$/.test(f) && !f.includes('.test.')), 'verificar-documentacion-cambios.mjs'].sort();
// Scripts con efectos al importarse (escriben archivos, llaman a process.exit): jamás se importan.
const NO_IMPORTAR = ['docs-drift.mjs', 'docs-inventario.mjs', 'docs-manifest.mjs', 'verificar-documentacion-cambios.mjs'];
const EFECTOS = /process\.exit\(|process\.argv|writeFileSync\(|spawnSync\(|execSync\(/;
const N = 100000;
const TOPE_MS = 1000;
const STUCK_MS = 4000;
const CONCURRENCIA = Math.max(2, Math.min(4, availableParallelism()));
const CARACTERES = [' ', '\t', '\u00a0', '-', '#', ':', 'x', '\r', '\u2028', '\u2029', '\u0085', '"', "'", '[', ',', '/'];
// Fuera del alfabeto de espacios y signos: dígitos y letras exponencian regex como /^(\d+)+$/ o /^(a|aa)+$/.
const ALFANUMERICOS = ['0', 'a', 'A', '.', '_', '=', '<', '>', 'a0Aa_.-', ' #', '- ', ': '];
const EXTRA_FUNCIONES = [']', '(', ')', '`', '!', '*', '|'];
// `.` no casa con \n, \r, U+2028 ni U+2029; \r y U+2029 se comportan igual que U+2028 (están en las chars y en las funciones).
const TERMINADORES = ['', '\u2028', '\n'];
const PREFIJOS = ['', 'sources:', '  - ', 'a', '---\n', '# ', 'x: ', '  - "'];
// La cola vacía importa: `^\s*-\s*(.+)$` solo es cuadrática si la línea TERMINA justo después del terminador.
const COLAS = ['', 'x', '\u2028x'];
const CFG = {
  N, tope: TOPE_MS, prefijos: PREFIJOS, terminadores: TERMINADORES, colas: COLAS,
  regex: [{ chars: CARACTERES, terminadores: TERMINADORES }, { chars: ALFANUMERICOS, terminadores: ['', '\u2028'] }],
  funcion: [{ chars: [...CARACTERES, ...ALFANUMERICOS, ...EXTRA_FUNCIONES], terminadores: ['\r', '\u2028'] }],
  // Una regex sin cuantificador no acotado (`*`, `+`, `{`) hace trabajo proporcional a la entrada: no puede ser catastrófica.
  // Se mide igual, con una batería reducida, para no gastar minutos en `/\r/g` o `/^<|>$/`.
  simple: { prefijos: ['', 'sources:'], grupos: [{ chars: [' ', 'x', 'a', '\u2028', '\n'], terminadores: ['', '\u2028'] }] },
};

// Código del worker (CommonJS): construye las entradas y mide cada ejecución. Avisa el grupo antes de correrlo para que el
// vigilante del hilo principal sepa dónde se colgó.
const CODIGO = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { tipo, fuente, banderas, archivo, nombre, cfg } = workerData;
  const N = cfg.N;
  let ejecutar;
  if (tipo === 'regex') {
    const re = new RegExp(fuente, banderas.replace('g', ''));
    const reG = banderas.includes('g') ? new RegExp(fuente, banderas) : null;
    ejecutar = (s) => { re.exec(s); if (reG) { reG.lastIndex = 0; s.replace(reG, ''); } };
  } else {
    const f = (await import(require('node:url').pathToFileURL(archivo).href))[nombre];
    ejecutar = (s) => { try { f(s); } catch (e) { /* firma distinta o ruta inexistente: solo importa el tiempo */ } };
  }
  const bloque = (c) => c.repeat(Math.ceil(N / c.length)).slice(0, N);
  const colas = tipo === 'regex' ? cfg.colas : ['', 'x'];
  let max = 0;
  let peor = '';
  const simple = tipo === 'regex' && !/[*+{]/.test(fuente.replace(/\\./g, ''));
  const prefijos = simple ? cfg.simple.prefijos : cfg.prefijos;
  for (const grupo of simple ? cfg.simple.grupos : cfg[tipo === 'regex' ? 'regex' : 'funcion']) {
    for (const c of grupo.chars) {
      const b = bloque(c);
      for (const pre of prefijos) {
        for (const term of grupo.terminadores) for (const cola of colas) {
          parentPort.postMessage({ p: JSON.stringify(pre) + ' + ' + N + ' x ' + JSON.stringify(c) + ' + ' + JSON.stringify(term) + ' + ' + JSON.stringify(cola) });
          // Tercera forma: bloque, un caracter de contenido y recien el terminador (sources: + blancos + x + U+2028 + y).
          const entradas = [pre + b + term + cola, pre + b.slice(0, N / 2) + term + b.slice(0, N / 2) + cola];
          if (term && !cola) entradas.push(pre + b + 'x' + term + 'y');
          for (const entrada of entradas) {
            // El host puede estar cargado (runners compartidos): ante un exceso se repite y vale el mínimo. Una regex
            // cuadrática sigue lenta en las tres corridas; el ruido de la máquina no.
            let ms = Infinity;
            for (let intento = 0; intento < 3 && ms > cfg.tope; intento += 1) {
              const t0 = performance.now();
              ejecutar(entrada);
              ms = Math.min(ms, performance.now() - t0);
            }
            if (ms > max) { max = ms; peor = JSON.stringify(c) + '/' + JSON.stringify(term); }
            if (ms > cfg.tope) { parentPort.postMessage({ fallo: Math.round(ms) + ' ms con ' + JSON.stringify(pre) + ' + ' + N + ' x ' + JSON.stringify(c) + ' + ' + JSON.stringify(term) + ' + ' + JSON.stringify(cola) }); return; }
          }
        }
      }
    }
  }
  parentPort.postMessage({ fin: true, max: Math.round(max), peor });
})();
`;

const tabla = [];
function medir(spec, etiqueta) {
  return new Promise((resolve, reject) => {
    const w = new Worker(CODIGO, { eval: true, workerData: { ...spec, cfg: CFG } });
    let ultima = 'arranque';
    let timer;
    const terminar = (error, valor) => { clearTimeout(timer); w.terminate(); if (error) reject(error); else resolve(valor); };
    const vigilar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => terminar(new Error(`${etiqueta}: sin terminar tras ${STUCK_MS} ms (regex catastrófica) en el grupo ${ultima}`)), STUCK_MS);
    };
    vigilar();
    w.on('message', (m) => {
      if (m.p) { ultima = m.p; vigilar(); } else if (m.fallo) terminar(new Error(`${etiqueta}: ${m.fallo}`));
      else if (m.fin) { tabla.push(`${etiqueta}\t${m.max} ms\t${m.peor}`); terminar(null, m); }
    });
    w.on('error', (e) => terminar(new Error(`${etiqueta}: ${e.message}`)));
  });
}

// Regex literales: precedidas por un delimitador de expresión (no una división) y en una sola línea.
const LITERAL = /(?<=(?:^|[(,=:[!&|?{};]|\breturn|\bin|=>)\s*)\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/([dgimsuvy]*)/gm;
function extraer() {
  const regex = [];
  for (const archivo of ARCHIVOS) {
    const texto = readFileSync(path.join(aqui, archivo), 'utf8');
    texto.split('\n').forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*|#!)/.test(linea)) return; // comentarios y shebang
      for (const m of linea.matchAll(LITERAL)) {
        try { new RegExp(m[1], m[2]); regex.push({ archivo, linea: i + 1, fuente: m[1], banderas: m[2] }); } catch { /* no era una regex */ }
      }
    });
  }
  return regex;
}
const regex = extraer();

// Importables: exportan algo y no tienen efectos sin guard. Los demás se registran para que el test lo diga con claridad.
const importables = [];
const problemas = [];
for (const archivo of ARCHIVOS) {
  const texto = readFileSync(path.join(aqui, archivo), 'utf8');
  const exporta = /^export /m.test(texto);
  if (NO_IMPORTAR.includes(archivo)) { if (exporta) problemas.push(`${archivo} está en NO_IMPORTAR pero ahora exporta: protegé su main con un guard import.meta.url y sacalo de NO_IMPORTAR`); continue; }
  if (!exporta) continue;
  if (EFECTOS.test(texto) && !/import\.meta\.url/.test(texto)) problemas.push(`${archivo} exporta y tiene efectos al importarse (process.exit/argv, writeFileSync, spawnSync): protegé su main con un guard import.meta.url o agregalo a NO_IMPORTAR`);
  else importables.push(archivo);
}
const EXPORTADAS = [];
for (const archivo of importables) {
  const modulo = await import(path.join(aqui, archivo));
  for (const [nombre, valor] of Object.entries(modulo)) if (typeof valor === 'function') EXPORTADAS.push({ archivo, nombre });
}

describe('enumeración', () => {
  it('encuentra las regex de los scripts y no ignora archivos', () => {
    assert.ok(regex.length >= 40, `solo ${regex.length} regex extraídas`);
    for (const archivo of ['docs-check.mjs', 'docs-drift.mjs', 'docs-enlaces.mjs', 'docs-inventario.mjs', 'docs-manifest.mjs', 'docs-yaml.mjs', 'verificar-documentacion-cambios.mjs']) assert.ok(ARCHIVOS.includes(archivo), `${archivo} no enumerado`);
    assert.ok(!regex.some((r) => r.fuente.startsWith('usr/')), 'el shebang no es una regex');
  });

  it('ningún script con efectos al importarse intenta importarse', () => {
    assert.deepEqual(problemas, []);
  });

  it('hay funciones exportadas que ejercitar', () => {
    assert.ok(EXPORTADAS.length >= 8, `solo ${EXPORTADAS.length}`);
  });
});

describe(`barrido de regex (100 000 caracteres hostiles, tope 1 s, vigilancia ${STUCK_MS} ms)`, { concurrency: CONCURRENCIA }, () => {
  for (const r of regex) {
    const etiqueta = `${r.archivo}:${r.linea} /${r.fuente}/${r.banderas}`;
    it(etiqueta, async () => { await medir({ tipo: 'regex', fuente: r.fuente, banderas: r.banderas }, etiqueta); });
  }
});

describe('barrido de funciones exportadas (docs-*.mjs importables)', { concurrency: CONCURRENCIA }, () => {
  for (const { archivo, nombre } of EXPORTADAS) {
    const etiqueta = `${archivo} ${nombre}()`;
    it(etiqueta, async () => { await medir({ tipo: 'funcion', archivo: path.join(aqui, archivo), nombre }, `${etiqueta} [función]`); });
  }
});

describe('barrido de funciones con archivos (terminadores en el medio)', () => {
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
  for (const c of [' ', '\t', '\u00a0', '#', ':', '-', '"']) for (const term of ['\r', '\u2028', '\u2029', '\u0085']) casos.push([c, term]);

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

after(() => { console.log(`# Tabla de regex y funciones medidas (máximo, entrada más lenta)\n${tabla.sort().join('\n')}`); });
