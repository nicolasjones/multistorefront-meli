// Barrido automático anti-ReDoS (MSF-869). Enumera con readdirSync todos los `scripts/docs-*.mjs` (sin tests) más
// `verificar-documentacion-cambios.mjs` (no hay lista fija: un script nuevo entra solo), extrae TODAS sus regex literales
// (salvo la línea `#!`) y las ejecuta con entradas hostiles de 100 000 caracteres (prefijo + repetición + terminador en el
// medio + cola). También llama a cada función exportada de los scripts importables con las mismas entradas. Cada regex o
// función corre en un worker_thread con vigilancia: si no hay progreso en STUCK_MS (regex catastrófica) el
// worker se termina y el test falla en segundos NOMBRANDO archivo:línea; si termina pero tarda más de 1 s, también falla.
// Los terminadores van EN EL MEDIO: al final de una línea `trim()` los elimina y el caso lento no se ejercita.
// Convención: un `docs-*.mjs` con `export` no debe tener efectos al importarse (protegé su main con un guard `import.meta.url`).
// Solo se importan los de la lista blanca IMPORTABLES; uno nuevo con `export` hace fallar el test sin importarse (decisión humana).
// docs-drift, docs-inventario, docs-manifest y verificar-documentacion-cambios no exportan ni se importan: se miden por sus regex.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import { leerMapaDocs } from './docs-correspondencia.mjs';
import { paginasNav } from './docs-check.mjs';
import { erroresFrontMatter, erroresYaml } from './docs-yaml.mjs';

// DOCS_BARRIDO_DIR solo lo usan los tests de la guardia de importación (corren este mismo archivo contra una carpeta temporal).
const aqui = process.env.DOCS_BARRIDO_DIR ?? import.meta.dirname;
const ARCHIVOS = [...readdirSync(aqui).filter((f) => /^docs-.+\.mjs$/.test(f) && !f.includes('.test.')), 'verificar-documentacion-cambios.mjs'].filter((f) => existsSync(path.join(aqui, f))).sort();
// Lista BLANCA de scripts que el test importa y ejecuta: cada uno se revisó a mano y no tiene efectos al importarse. Un
// `docs-*.mjs` con `export` que no esté acá NO se importa: el test falla pidiendo esa decisión humana en un cambio revisado.
const IMPORTABLES = ['docs-check.mjs', 'docs-correspondencia.mjs', 'docs-enlaces.mjs', 'docs-lineas.mjs', 'docs-yaml.mjs'];
// Scripts con efectos al importarse (escriben archivos, llaman a process.exit): jamás se importan ni exportan.
const NO_IMPORTAR = ['docs-drift.mjs', 'docs-inventario.mjs', 'docs-manifest.mjs', 'verificar-documentacion-cambios.mjs'];

// Red adicional (la decisión la toma la lista blanca): análisis estático sobre el texto SIN comentarios ni cadenas, para que
// mencionar `import.meta.url` o `writeFileSync` en un comentario o un string no cuente como guard ni como efecto.
const regexPermitida = (salida, previo) => previo === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previo) || /\b(?:return|typeof|case|in|of|void|delete)\s*$/.test(salida);
function limpiar(texto, conservarCadenas) {
  let salida = '';
  let previo = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '/' && d === '/') { while (i < n && texto[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') { const j = texto.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; salida += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && texto[j] !== c) { if (texto[j] === '\\') j += 1; j += 1; }
      salida += conservarCadenas ? texto.slice(i, j + 1) : `${c}${c}`;
      i = j + 1; previo = c; continue;
    }
    if (c === '`') {
      let j = i + 1;
      salida += conservarCadenas ? '' : '``';
      while (j < n && texto[j] !== '`') {
        if (texto[j] === '\\') { j += 2; continue; }
        if (texto[j] === '$' && texto[j + 1] === '{') { // el código de la interpolación SÍ se analiza
          let k = j + 2; let prof = 1;
          while (k < n && prof > 0) { if (texto[k] === '{') prof += 1; else if (texto[k] === '}') prof -= 1; k += 1; }
          salida += ` ${texto.slice(j + 2, k - 1)} `; j = k; continue;
        }
        if (conservarCadenas) salida += texto[j];
        j += 1;
      }
      i = j + 1; previo = '`'; continue;
    }
    if (c === '/' && regexPermitida(salida, previo)) {
      let j = i + 1; let clase = false;
      while (j < n && texto[j] !== '\n') {
        const x = texto[j];
        if (x === '\\') { j += 2; continue; }
        if (x === '[') clase = true; else if (x === ']') clase = false; else if (x === '/' && !clase) break;
        j += 1;
      }
      salida += '/R/'; i = j + 1;
      while (/[a-z]/.test(texto[i] ?? '')) i += 1;
      previo = ')'; continue;
    }
    salida += c;
    if (!/\s/.test(c)) previo = c;
    i += 1;
  }
  return salida;
}
const MODULOS_PELIGROSOS = /^(?:node:)?(?:child_process|net|http|https|http2|dgram|cluster|worker_threads|vm|tls|dns|inspector|repl)(?:\/.*)?$/;
const FS_ESCRITURA = /\b(?:writeFile|appendFile|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|truncate|ftruncate|symlink|link|chmod|chown|lchown|lchmod|utimes|futimes|lutimes|open|write|writev|createWriteStream|fsync|fdatasync|exec|execFile|spawn|fork)(?:Sync)?\b/;
const OTROS_EFECTOS = /\b(?:fetch|eval|setInterval|setTimeout|XMLHttpRequest|WebSocket|createRequire|require)\s*\(|\bnew\s+Function\b|\bimport\s*\(|\bprocess\s*\.\s*(?:chdir|kill|abort|dlopen|binding|umask|on|once)\b/;
// Devuelve los motivos por los que un script con `export` NO es seguro de importar (vacío = pasa la red estática).
function motivosDeEfectos(texto) {
  const motivos = [];
  const sinComentarios = limpiar(texto, true);
  for (const m of sinComentarios.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) if (MODULOS_PELIGROSOS.test(m[1])) motivos.push(`importa ${m[1]}`);
  const codigo = limpiar(texto, false);
  const fs = codigo.match(FS_ESCRITURA); if (fs) motivos.push(`usa ${fs[0]} (escritura o proceso)`);
  const otros = codigo.match(OTROS_EFECTOS); if (otros) motivos.push(`usa ${otros[0].trim()}`);
  if (/\bprocess\s*\.\s*(?:exit|argv)\b/.test(codigo) && !/\bimport\s*\.\s*meta\s*\.\s*url\b/.test(codigo)) motivos.push('usa process.exit/argv sin un guard import.meta.url real');
  return motivos;
}
// Decisión por archivo: null = no se importa; 'importar' = se importa; string[] = problemas (el test falla sin importarlo).
function clasificar(archivo, texto) {
  const exporta = /^\s*export\s/m.test(limpiar(texto, false));
  if (NO_IMPORTAR.includes(archivo)) return exporta ? [`${archivo} está en NO_IMPORTAR pero ahora exporta: protegé su main con un guard import.meta.url y sacalo de NO_IMPORTAR`] : null;
  if (!exporta) return null;
  if (!IMPORTABLES.includes(archivo)) return [`${archivo} exporta pero no está en IMPORTABLES: agregalo a IMPORTABLES tras revisar que no tiene efectos al importarse, o quitá el export`];
  const motivos = motivosDeEfectos(texto);
  return motivos.length ? [`${archivo} está en IMPORTABLES pero ${motivos.join('; ')}: no debe tener efectos al importarse (protegé su main con un guard import.meta.url)`] : 'importar';
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

// Importables: SOLO los de la lista blanca que además pasan la red estática. Los demás se informan como problemas, sin importarse.
const importables = [];
const problemas = [];
for (const archivo of ARCHIVOS) {
  const decision = clasificar(archivo, readFileSync(path.join(aqui, archivo), 'utf8'));
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

  it('ningún script con efectos al importarse intenta importarse', () => {
    assert.deepEqual(problemas, []);
  });

  it('hay funciones exportadas que ejercitar', () => {
    assert.ok(EXPORTADAS.length >= 8, `solo ${EXPORTADAS.length}`);
    for (const archivo of IMPORTABLES) assert.ok(importables.includes(archivo), `${archivo} (IMPORTABLES) no se importó: ¿no existe o no exporta?`);
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

// Los tests de la guardia corren ESTE archivo contra una carpeta temporal con scripts hostiles y comprueban que fallan SIN
// ejecutarlos: el centinela (un archivo que el script hostil escribiría al importarse) no debe existir.
describe('guardia de importación', () => {
  const dirs = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const hijo = (archivos) => {
    const d = mkdtempSync(path.join(tmpdir(), 'guardia-'));
    dirs.push(d);
    const centinela = path.join(d, 'centinela.txt');
    for (const [nombre, texto] of Object.entries(archivos)) writeFileSync(path.join(d, nombre), texto.replaceAll('CENTINELA', centinela));
    const env = { ...process.env, DOCS_BARRIDO_DIR: d };
    delete env.NODE_TEST_CONTEXT; // sin esto el hijo se comporta como subproceso del runner y no informa fallos
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern=ningún script con efectos', import.meta.filename], { env, encoding: 'utf8' });
    return { status: r.status, salida: `${r.stdout}${r.stderr}`, ejecutado: existsSync(centinela) };
  };

  it('un comentario con import.meta.url no cuenta como guard: falla sin ejecutar', () => {
    const r = hijo({ 'docs-zzz-a.mjs': "// import.meta.url\n/* import.meta.url */\nconst s = 'import.meta.url';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('CENTINELA', 'x');\nexport const a = 1;\n" });
    assert.notEqual(r.status, 0);
    assert.match(r.salida, /docs-zzz-a\.mjs exporta pero no está en IMPORTABLES/);
    assert.equal(r.ejecutado, false);
  });

  it('appendFileSync sin guard en un script con export falla sin ejecutar', () => {
    const r = hijo({ 'docs-zzz-b.mjs': "import { appendFileSync } from 'node:fs';\nappendFileSync('CENTINELA', 'x');\nexport const b = 1;\n" });
    assert.notEqual(r.status, 0);
    assert.match(r.salida, /docs-zzz-b\.mjs exporta pero no está en IMPORTABLES/);
    assert.equal(r.ejecutado, false);
  });

  it('un script nuevo con export que no está en IMPORTABLES falla pidiendo revisarlo', () => {
    const r = hijo({ 'docs-zzz-c.mjs': 'export const c = 1;\n' });
    assert.notEqual(r.status, 0);
    assert.match(r.salida, /agregalo a IMPORTABLES tras revisar que no tiene efectos al importarse, o quitá el export/);
  });

  it('un script de la lista blanca que gana un efecto falla sin ejecutar', () => {
    for (const efecto of ["import { appendFileSync } from 'node:fs';\nappendFileSync('CENTINELA', 'x');", "import { spawnSync } from 'node:child_process';\nspawnSync('touch', ['CENTINELA']);", "await fetch('http://127.0.0.1:9/CENTINELA');", "process.exit(0);"]) {
      const r = hijo({ 'docs-lineas.mjs': `${efecto}\nexport const l = 1;\n` });
      assert.notEqual(r.status, 0, efecto);
      assert.match(r.salida, /docs-lineas\.mjs está en IMPORTABLES pero/, efecto);
      assert.equal(r.ejecutado, false, efecto);
    }
  });

  it('un script de la lista blanca sin efectos pasa, incluso con un guard real de main', () => {
    const r = hijo({ 'docs-lineas.mjs': "import { writeFileSync } from 'node:fs';\nexport const l = 1;\nfunction main() { writeFileSync('CENTINELA', 'y'); }\nif (process.argv[1] && import.meta.url) main();\n" });
    assert.notEqual(r.status, 0, 'writeFileSync está prohibido aun dentro de main: los importables no escriben');
    const limpio = hijo({ 'docs-lineas.mjs': 'export const l = 1;\nconst main = () => process.exit(1);\nif (process.argv[1] === import.meta.url) main();\n' });
    assert.equal(limpio.status, 0, limpio.salida);
  });

  it('los scripts actuales pasan la guardia', () => {
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
