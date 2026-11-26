// Barrido automático anti-ReDoS (MSF-869). Enumera con readdirSync todos los `scripts/docs-*.mjs` (sin tests) más
// `verificar-documentacion-cambios.mjs` (no hay lista fija: un script nuevo entra solo), extrae TODAS sus regex literales
// (salvo la línea `#!`) y las ejecuta con entradas hostiles de 100 000 caracteres (prefijo + repetición + terminador en el
// medio + cola). También llama a cada función exportada de los scripts importables con las mismas entradas. Cada regex o
// función corre en un worker_thread con vigilancia: si no hay progreso en STUCK_MS (regex catastrófica) el
// worker se termina y el test falla en segundos NOMBRANDO archivo:línea; si termina pero tarda más de 1 s, también falla.
// Los terminadores van EN EL MEDIO: al final de una línea `trim()` los elimina y el caso lento no se ejercita.
// Defensa contra scripts con efectos: CLASIFICACIÓN EXPLÍCITA. Todo `scripts/docs-*.mjs` que no sea test (más
// `verificar-documentacion-cambios.mjs`) debe estar en IMPORTABLES o en NO_IMPORTAR; si no está en ninguna, el test falla con un
// mensaje accionable y ese archivo NO se importa. El test solo importa los de IMPORTABLES, y por lo tanto los EJECUTA al
// importarse, como cualquier otro código del PR que corre en la CI (job en `pull_request`, sin secretos). No hay detección
// automática de efectos ni de `export`: un script nuevo, con cualquier sintaxis de export o ninguna, exige una decisión humana en un
// cambio revisado, y añadirle un efecto a uno de IMPORTABLES es un cambio de código que se revisa como cualquier otro.
// Convención: un `docs-*.mjs` en IMPORTABLES no debe tener efectos al importarse (protegé su main con un guard `import.meta.url`).
// Los de NO_IMPORTAR (corren al importarse o no exportan nada) nunca se importan; sus regex literales se miden igual por texto.
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
// IMPORTABLES: exportan funciones puras y el test los importa (y ejecuta) para barrerlas. No deben tener efectos al importarse.
const IMPORTABLES = ['docs-check.mjs', 'docs-correspondencia.mjs', 'docs-enlaces.mjs', 'docs-lineas.mjs', 'docs-yaml.mjs'];
// NO_IMPORTAR: corren al importarse (escriben archivos, llaman a process.exit) o no exportan nada; jamás se importan.
const NO_IMPORTAR = ['docs-drift.mjs', 'docs-inventario.mjs', 'docs-manifest.mjs', 'verificar-documentacion-cambios.mjs'];
// Decisión por archivo SIN leer ni importar nada: 'importar' | null (no se importa) | [problema] (sin clasificar).
function clasificar(archivo) {
  if (IMPORTABLES.includes(archivo)) return 'importar';
  if (NO_IMPORTAR.includes(archivo)) return null;
  return [`${archivo} no está clasificado: agregalo a IMPORTABLES si exporta funciones puras sin efectos al importarse, o a NO_IMPORTAR si corre al importarse o no exporta (no se importó)`];
}
// Una regex sin cuantificadores `*`, `+`, `{}` ni `?` ni alternancia `|` hace trabajo proporcional a la entrada. Los `?` repetidos
// (`x?x?…x?xx…x`) y la alternancia sí pueden explotar, así que cuentan. Es conservadora: un `+` dentro de una clase `[+]` también
// cuenta (la regex va a la batería completa, más lenta pero igual de segura). Los prefijos de grupo `(?:`, `(?=`, `(?!`, `(?<=`,
// `(?<!` y `(?<nombre>` no son cuantificadores y se quitan antes de mirar.
const esSimple = (fuente) => !/[*+{?|]/.test(fuente.replace(/\\./g, '').replace(/\(\?(?:[:=!]|<[=!]|<\w+>)/g, '('));

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
  // Batería reducida para las regex `esSimple` (sin `*`, `+`, `{}`, `?` ni `|`: trabajo proporcional a la entrada). Se miden igual,
  // sin gastar minutos en `/\r/g` o `/^<>$/`.
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
  const simple = workerData.simple === true;
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

// Importables: SOLO los de la lista blanca. Los no clasificados se informan como problemas, sin importarse.
const importables = [];
const problemas = [];
for (const archivo of ARCHIVOS) {
  const decision = clasificar(archivo);
  if (decision === 'importar') importables.push(archivo); else if (decision) problemas.push(...decision);
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

  it('hay funciones exportadas que ejercitar', () => {
    assert.ok(EXPORTADAS.length >= 8, `solo ${EXPORTADAS.length}`);
    for (const archivo of IMPORTABLES) assert.ok(importables.includes(archivo), `${archivo} (IMPORTABLES) no se importó: ¿no existe?`);
  });
});

describe('esSimple', () => {
  it('clasifica por cuantificadores y alternancia', () => {
    assert.equal(esSimple('\\r\\n'), true);
    assert.equal(esSimple('^<'), true);
    assert.equal(esSimple('(?:a)(?=b)'), true);
    for (const f of ['a*', 'a+', 'a{2,3}', 'a?', 'a|b', '[+]', `^${'x?'.repeat(28)}${'x'.repeat(28)}$`]) assert.equal(esSimple(f), false, f);
  });
});

// La clasificación se prueba sin importar ni ejecutar nada: `clasificar` ni siquiera lee el archivo.
describe('clasificación de scripts', () => {
  it('un archivo nuevo no listado falla pidiendo clasificarlo, cualquiera sea su contenido', () => {
    for (const nombre of ['docs-zzz-a.mjs', 'docs-zzz-b.mjs']) {
      assert.match(clasificar(nombre)[0], /no está clasificado: agregalo a IMPORTABLES si exporta funciones puras sin efectos al importarse, o a NO_IMPORTAR/);
    }
  });

  it('los de IMPORTABLES se importan y los de NO_IMPORTAR no', () => {
    assert.equal(clasificar('docs-lineas.mjs'), 'importar');
    assert.equal(clasificar('docs-manifest.mjs'), null);
  });

  it('las listas no se pisan y no tienen entradas viejas', () => {
    for (const archivo of IMPORTABLES) assert.ok(!NO_IMPORTAR.includes(archivo), `${archivo} está en las dos listas`);
    for (const archivo of [...IMPORTABLES, ...NO_IMPORTAR]) assert.ok(ARCHIVOS.includes(archivo), `${archivo} figura en una lista pero no existe`);
  });

  it('todo docs-*.mjs está clasificado (y no se importó nada fuera de IMPORTABLES)', () => {
    assert.deepEqual(problemas, []);
  });
});

describe(`barrido de regex (100 000 caracteres hostiles, tope 1 s, vigilancia ${STUCK_MS} ms)`, { concurrency: CONCURRENCIA }, () => {
  for (const r of regex) {
    const etiqueta = `${r.archivo}:${r.linea} /${r.fuente}/${r.banderas}`;
    it(etiqueta, async () => { await medir({ tipo: 'regex', fuente: r.fuente, banderas: r.banderas, simple: esSimple(r.fuente) }, etiqueta); });
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
