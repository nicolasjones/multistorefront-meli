#!/usr/bin/env node
// Trampas conocidas del repo: errores que costaron horas de CI y que se detectan leyendo el diff.
// Cada regla replica un fallo real del CI (2026-11-15) para que falle en segundos, antes de la corrida pesada.
//
//   T1  Tabla nueva de `dominio` sin `grant ... to service_role`        (service_role_privilegios.test.sql)
//   T2  Variable de psql `:'x'` dentro de un bloque `$$ ... $$` de pgTAP (psql no interpola ahí)
//   T4  Tabla nueva con `organizacion_id` que no está en la exportación total   (exportacion_total.test.sql)
//   T5  E2E que escribe con la service-role key en una tabla de `dominio` sin grant para service_role
//   T6  Redefinición de `conjuntos_exportacion_total()` que pierde filas de la versión vigente (pisa lo que agregó otra rama)
//   T7  `current_date` (UTC del CI) como fecha de ingreso de una reparación (insert, update ... set ingreso_en, crear_reparacion):
//       la app valida «hoy» con la fecha de Buenos Aires
//
// No cubre (ya lo hacen otros guards): versiones de migración <= la máxima de la base (`verificar-migraciones.mjs
// --estricto`) y nombres de test con códigos MSF (guardián `apps/web/src/higieneReferenciasInternas.test.ts`).
//
// Uso: node scripts/verificar-trampas-conocidas.mjs [--base origin/dokploy] [--todo]
//   --todo  revisa TODOS los archivos del árbol como si fueran nuevos (para comprobar que no hay falsos positivos).
// Sin red y sin leer secretos: solo lee archivos del repo con git.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Migración que otorgó, por catálogo, privilegios a service_role sobre TODAS las tablas de `dominio` existentes entonces.
export const VERSION_GRANT_MASIVO = '20270302105000';
const RUTA_TEST_PRIVILEGIOS = 'supabase/tests/database/service_role_privilegios.test.sql';

const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const versionDe = (ruta) => path.basename(ruta).split('_')[0].replace(/\.sql$/, '');
const lineaDe = (texto, indice) => texto.slice(0, indice).split('\n').length;

// Cuerpo entre paréntesis que abre en `desde` (índice de `(`), respetando anidamiento y literales simples.
function cuerpoParentesis(sql, desde) {
  let nivel = 0;
  for (let i = desde; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i = sql.indexOf("'", i + 1); if (i < 0) break; continue; }
    if (c === '(') nivel++;
    else if (c === ')' && --nivel === 0) return sql.slice(desde + 1, i);
  }
  return sql.slice(desde + 1);
}

const RE_CREATE_TABLA = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(dominio|public)\.("?)([a-z_][a-z0-9_]*)\2\s*(?=\(|partition\s+of)/gi;

// Tablas que crea una migración: { esquema, tabla, cuerpo, indice }.
export function tablasCreadas(sqlOriginal) {
  const sql = sinComentarios(sqlOriginal);
  const salida = [];
  for (const m of sql.matchAll(RE_CREATE_TABLA)) {
    const abre = sql.indexOf('(', m.index + m[0].length - 1);
    const cuerpo = sql[m.index + m[0].length] === '(' ? cuerpoParentesis(sql, m.index + m[0].length) : cuerpoParentesis(sql, abre);
    salida.push({ esquema: m[1].toLowerCase(), tabla: m[3].toLowerCase(), cuerpo, indice: m.index });
  }
  return salida;
}

// Sentencias `grant ... to ... service_role` de un SQL (texto de cada sentencia, en minúsculas).
export function grantsServiceRole(sqlOriginal) {
  return sinComentarios(sqlOriginal).toLowerCase().split(';').filter((s) => /\bgrant\b/.test(s) && /\bto\b[^;]*\bservice_role\b/.test(s));
}

// Tablas inalterables declaradas en el pgTAP de privilegios (no llevan grant de escritura a propósito).
export function inalterablesDe(sqlTest) {
  const m = /insert\s+into\s+inalterables\s+values([\s\S]*?);/i.exec(sinComentarios(sqlTest));
  return new Set(m ? [...m[1].matchAll(/\('([a-z0-9_]+)'\)/gi)].map((x) => x[1].toLowerCase()) : []);
}

function mencionaTabla(texto, tabla) {
  return new RegExp(`(?<![a-z0-9_])${tabla}(?![a-z0-9_])`).test(texto);
}

// T1: toda tabla nueva de `dominio` debe aparecer en un `grant ... to service_role` del diff (o ser inalterable declarada).
export function revisarGrants({ migracionesDiff, inalterables = new Set() }) {
  const problemas = [];
  const grants = migracionesDiff.flatMap((m) => grantsServiceRole(m.sql));
  const grantGlobal = grants.some((g) => /all\s+tables\s+in\s+schema\s+dominio/.test(g));
  for (const m of migracionesDiff) {
    if (versionDe(m.ruta) <= VERSION_GRANT_MASIVO) continue; // las cubre el grant por catálogo de esa migración
    for (const t of tablasCreadas(m.sql)) {
      if (t.esquema !== 'dominio' || inalterables.has(t.tabla) || grantGlobal) continue;
      if (grants.some((g) => mencionaTabla(g, t.tabla))) continue;
      problemas.push(
        `${m.ruta}:${lineaDe(m.sql, t.indice)} crea dominio.${t.tabla} sin \`grant ... to service_role\`. `
        + 'service_role nace sin privilegios en las tablas nuevas y service_role_privilegios.test.sql falla. '
        + `Agregá en la migración: grant select, insert, update, delete on dominio.${t.tabla} to service_role; `
        + `(o, si es historial de solo agregar, sumala a \`inalterables\` de ${RUTA_TEST_PRIVILEGIOS} y de la migración ${VERSION_GRANT_MASIVO}).`,
      );
    }
  }
  return problemas;
}

// T2: `:'nombre'` / `:"nombre"` dentro de un bloque con dólares (`$$ ... $$` o `$etiqueta$ ... $etiqueta$`).
export function revisarVariablesPsql({ pruebas }) {
  const problemas = [];
  for (const p of pruebas) {
    const sql = sinComentarios(p.sql);
    for (const bloque of sql.matchAll(/(\$[a-z_]*\$)([\s\S]*?)\1/gi)) {
      const interior = bloque[2];
      const inicio = bloque.index + bloque[1].length;
      for (const v of interior.matchAll(/(?<![:\w]):(')([a-z_][a-z0-9_]*)\1/gi)) {
        problemas.push(
          `${p.ruta}:${lineaDe(sql, inicio + v.index)} usa la variable de psql :${v[1]}${v[2]}${v[1]} dentro de un bloque ${bloque[1]} ... ${bloque[1]}: `
          + 'psql NO interpola variables dentro de comillas de dólar y el SQL llega con el texto literal. '
          + `Armá el bloque con format('... %L ...', :'${v[2]}') o sacá la variable del bloque.`,
        );
      }
    }
  }
  return problemas;
}

// T4: tabla nueva con `organizacion_id` => debe estar en `conjuntos_exportacion_total()` o en `exclusiones_exportacion_total()`.
export function revisarExportacionTotal({ migracionesDiff }) {
  const problemas = [];
  const redefinen = migracionesDiff.filter((m) => /(conjuntos|exclusiones)_exportacion_total/i.test(m.sql));
  for (const m of migracionesDiff) {
    for (const t of tablasCreadas(m.sql)) {
      if (!/(?<![a-z0-9_])organizacion_id(?![a-z0-9_])/i.test(t.cuerpo)) continue;
      if (redefinen.some((r) => new RegExp(`'${t.tabla}'`, 'i').test(sinComentarios(r.sql)))) continue;
      problemas.push(
        `${m.ruta}:${lineaDe(m.sql, t.indice)} crea ${t.esquema}.${t.tabla} con organizacion_id y no figura en la exportación total: `
        + 'exportacion_total.test.sql exige que toda tabla con organizacion_id esté permitida o excluida. '
        + `Si es dato de negocio, redefiní private.conjuntos_exportacion_total() sumando ('${t.esquema}', '${t.tabla}') `
        + '(partí de la definición vigente: la última migración que la redefinió); si es operativa o secreta, agregala con su motivo a private.exclusiones_exportacion_total().',
      );
    }
  }
  return problemas;
}

// T6: filas ('esquema', 'tabla') de la lista `values (...)` con que una migración redefine `conjuntos_exportacion_total()`.
// Devuelve null si la migración no la define.
export function filasConjuntosExportacion(sqlOriginal) {
  const sql = sinComentarios(sqlOriginal);
  const def = /create\s+(?:or\s+replace\s+)?function\s+private\.conjuntos_exportacion_total\s*\(/i.exec(sql);
  if (!def) return null;
  const resto = sql.slice(def.index);
  const v = /\(\s*values\b/i.exec(resto);
  if (!v) return new Set();
  const cuerpo = cuerpoParentesis(resto, v.index);
  // Acepta ('esquema', 'tabla') y también con casts: ('esquema'::text, 'tabla'::text).
  const cast = String.raw`(?:\s*::\s*[a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)?)?`;
  const fila = new RegExp(String.raw`\(\s*'([a-z0-9_]+)'${cast}\s*,\s*'([a-z0-9_]+)'${cast}\s*\)`, 'gi');
  return new Set([...cuerpo.matchAll(fila)].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`));
}

// Pérdidas declaradas con `-- exportacion-total: se quita <esquema>.<tabla> (motivo)`; el motivo no puede ir vacío.
export function perdidasDeclaradas(sqlOriginal) {
  return new Set([...sqlOriginal.matchAll(/--\s*exportacion-total:\s*se\s+quita\s+([a-z0-9_]+)\.([a-z0-9_]+)\s*\([^)\n]*\S[^)\n]*\)/gi)].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`));
}

// T6: una migración nueva que redefine la función debe partir de la versión vigente (la anterior de mayor versión que la
// defina, en la base o en el propio diff) y conservar todas sus filas, salvo las quitadas a propósito y declaradas.
export function revisarSupersetExportacion({ migracionesDiff, todasMigraciones }) {
  const problemas = [];
  const definen = todasMigraciones
    .map((m) => ({ ...m, version: versionDe(m.ruta), filas: filasConjuntosExportacion(m.sql) }))
    .filter((m) => m.filas)
    // Orden determinista aunque `todasMigraciones` llegue desordenada o haya dos migraciones con la misma versión.
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : path.basename(a.ruta) < path.basename(b.ruta) ? -1 : path.basename(a.ruta) > path.basename(b.ruta) ? 1 : 0));
  const enDiff = new Set(migracionesDiff.map((m) => m.ruta));
  for (const [i, m] of definen.entries()) {
    if (!enDiff.has(m.ruta)) continue;
    const previa = i > 0 ? definen[i - 1] : null;
    // Si la función existe pero no se extrajo ninguna fila, el parseo no entendió la forma del `values`: fallar, no pasar.
    const sinFilas = [m, previa].filter((x) => x && x.filas.size === 0);
    if (sinFilas.length) {
      for (const x of sinFilas) {
        problemas.push(
          `${x.ruta} define private.conjuntos_exportacion_total() pero el check no pudo leer ninguna fila ('esquema', 'tabla') de su \`values\`: `
          + 'no se puede comprobar que conserve la lista vigente. Escribí las filas como `(\'esquema\', \'tabla\')` (se aceptan casts `\'x\'::text`) '
          + 'o ajustá verificar-trampas-conocidas.mjs si la forma es válida.',
        );
      }
      continue;
    }
    if (!previa) continue;
    const declaradas = perdidasDeclaradas(m.sql);
    const perdidas = [...previa.filas].filter((f) => !m.filas.has(f) && !declaradas.has(f)).sort();
    if (!perdidas.length) continue;
    const lista = perdidas.map((f) => `\`${f}\``).join(', ');
    problemas.push(
      `${m.ruta} redefine private.conjuntos_exportacion_total() y pierde ${perdidas.length} fila(s) de la versión vigente: ${lista}. `
      + `Partió de una versión vieja y pisaría lo que agregó otra rama (exportacion_total.test.sql fallaría). Rebasá la migración sobre ${path.basename(previa.ruta)} `
      + '(la última que la define: copiá su lista completa y sumá solo tus filas). '
      + 'Si quitar la fila es intencional, declaralo en la migración con un comentario `-- exportacion-total: se quita <esquema>.<tabla> (motivo)`.',
    );
  }
  return problemas;
}

// Recorre un SQL respetando comentarios (`--`, `/* */`), literales de comilla simple (con `''` escapado) y bloques de
// dólares (`$$ ... $$`, `$etiqueta$ ... $etiqueta$`, anidables con etiquetas distintas). Devuelve:
//   · `enmascarado`: mismo largo y mismas líneas que el original, con los comentarios y el CONTENIDO de los literales de comilla
//     simple reemplazados por espacios (el código dentro de un bloque de dólares se conserva, también sus literales enmascarados);
//   · `sinCerrar`: índice del primer comentario, literal o bloque de dólares sin cerrar (-1 si todo cierra);
//   · `sentencias`: cortes en `;` de primer nivel (los `;` de literales, comentarios y bloques de dólares no cortan), cada una
//     con su texto enmascarado y su índice de inicio.
export function recorrerSql(sql) {
  const salida = sql.split('');
  const sentencias = [];
  const pila = [];
  let inicio = 0;
  let sinCerrar = -1; // posición del primer comentario, literal o bloque de dólares que no cierra (SQL roto)
  const abierto = (i) => { if (sinCerrar < 0) sinCerrar = i; };
  const blanquear = (desde, hasta) => { for (let k = desde; k < hasta; k++) if (salida[k] !== '\n') salida[k] = ' '; };
  // Próxima aparición de `tok` desde `desde`, memoizada: un recorrido de izquierda a derecha no repite búsquedas (lineal).
  const memo = new Map();
  const sig = (tok, desde) => {
    const m = memo.get(tok);
    if (m && desde >= m.desde && (m.idx === -1 || m.idx >= desde)) return m.idx;
    const idx = sql.indexOf(tok, desde);
    memo.set(tok, { desde, idx });
    return idx;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    // Dentro de un bloque de dólares el texto puede ser un dato (`$$o'brien"; --$$`): nada de lo que abra adentro puede pasar del cierre del bloque.
    const tope = pila.length ? pila[pila.length - 1].cierre : -1; // calculado una sola vez al abrir el bloque
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sig('\n', i);
      let hasta = fin < 0 ? sql.length : fin;
      if (tope >= 0 && tope < hasta) hasta = tope;
      blanquear(i, hasta); i = hasta; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sig('*/', i + 2);
      if (tope >= 0 && (fin < 0 || tope < fin)) { i++; continue; }
      if (fin < 0) abierto(i);
      const hasta = fin < 0 ? sql.length : fin + 2;
      blanquear(i, hasta); i = hasta; continue;
    }
    if (c === "'") {
      // E'...' admite \' y \\ como escapes (además de ''); un literal común no.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[a-z0-9_$]/i.test(sql[i - 2] ?? ' ');
      let j = i + 1;
      const limite = tope >= 0 ? tope : sql.length; // dentro de un bloque la búsqueda del cierre no pasa del cierre del bloque
      while (j < limite) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      if (tope >= 0 && j >= tope) { i++; continue; } // la comilla no cierra antes del bloque: es texto del dato
      if (j >= sql.length) abierto(i);
      blanquear(i + 1, Math.min(j, sql.length)); i = j + 1; continue;
    }
    if (c === '"') {
      const fin = sig('"', i + 1);
      if (tope >= 0 && (fin < 0 || tope < fin)) { i++; continue; }
      if (fin < 0) abierto(i);
      i = fin < 0 ? sql.length : fin + 1; continue;
    }
    if (c === '$') {
      const m = /^\$[a-z_][a-z0-9_]*\$|^\$\$/i.exec(sql.slice(i, i + 80));
      if (m) {
        if (pila.length && pila[pila.length - 1].tag === m[0]) pila.pop();
        else pila.push({ tag: m[0], cierre: sig(m[0], i + m[0].length) });
        i += m[0].length; continue;
      }
    }
    if (c === ';' && pila.length === 0) {
      sentencias.push({ texto: salida.slice(inicio, i).join(''), desde: inicio });
      inicio = i + 1;
    }
    i++;
  }
  sentencias.push({ texto: salida.slice(inicio).join(''), desde: inicio });
  if (pila.length) abierto(sql.length - 1);
  return { enmascarado: salida.join(''), sentencias, sinCerrar };
}

// Expresión que sigue a `=`/`=>` (desde `desde`) hasta la coma o el cierre de primer nivel (o `where`/`from`/`returning`).
function expresionDesde(texto, desde) {
  let nivel = 0;
  const hasta = Math.min(texto.length, desde + MAX_EXPRESION);
  for (let i = desde; i < hasta; i++) {
    const c = texto[i];
    if (c === '(') nivel++;
    else if (c === ')') { if (nivel === 0) return texto.slice(desde, i); nivel--; }
    else if (nivel === 0 && c === ',') return texto.slice(desde, i);
    else if (nivel === 0 && /\s|\)/.test(texto[i - 1] ?? ' ') && /^(where|from|returning)\b/i.test(texto.slice(i, i + 10))) return texto.slice(desde, i);
  }
  // Cortada por el tope sin terminar: no se puede saber si hay un current_date más adelante.
  return hasta < texto.length ? CONSERVADOR : texto.slice(desde, hasta);
}

const RE_CURRENT_DATE = /(?<![a-z0-9_])current_date(?![a-z0-9_])/i;

// Parte `texto` en las comas de primer nivel (fuera de paréntesis): [{ txt, off }].
function partesTop(texto) {
  const salida = [];
  let nivel = 0;
  let ini = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '(') nivel++;
    else if (c === ')') nivel--;
    else if (c === ',' && nivel === 0) { salida.push({ txt: texto.slice(ini, i), off: ini }); ini = i + 1; }
  }
  salida.push({ txt: texto.slice(ini), off: ini });
  return salida;
}

// Límites que mantienen el análisis lineal ante SQL adversarial (paréntesis sin cerrar, miles de updates en una sentencia sin `;`).
// Pasados los topes la sentencia se trata como incumplimiento conservador: ningún pgTAP real se les acerca.
export const TOPE_SENTENCIA = 100_000;
const MAX_ALTAS_POR_SENTENCIA = 500;
const MAX_EXPRESION = 300;
const CONSERVADOR = Symbol('conservador');

// Para cada `(` el índice de su `)` (o -1 si no cierra), en un solo pasaje con una pila.
function paresParentesis(texto) {
  const cierre = new Int32Array(texto.length).fill(-1);
  const pila = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '(') pila.push(i);
    else if (texto[i] === ')' && pila.length) cierre[pila.pop()] = i;
  }
  return cierre;
}

// Tramos [desde, hasta) de las llamadas `throws_ok(...)`: lo que está dentro de sus argumentos es SQL que se espera que falle.
function tramosThrowsOk(sentencia, pares) {
  const tramos = [];
  for (const m of sentencia.matchAll(/(?<![a-z0-9_])throws_ok\s*\(/gi)) {
    const abre = m.index + m[0].length - 1;
    if (pares[abre] < 0) return CONSERVADOR; // sin cierre: no se sabe hasta dónde llega la exención
    tramos.push([abre, pares[abre] + 1]);
  }
  return tramos;
}

// `insert into reparaciones (cols) values (...)|select ...`: posiciones de `current_date` que caen en la columna `ingreso_en`.
// Sin lista de columnas no se puede saber a qué columna va cada valor: se marca cualquier `current_date` (conservador).
// Devuelve índices, o CONSERVADOR si el SQL no se puede analizar de forma acotada (paréntesis sin cerrar o demasiadas altas).
function usosInsertIngreso(sentencia, pares) {
  const altas = [...sentencia.matchAll(/insert\s+into\s+(?:dominio\.)?reparaciones\b\s*/gi)];
  if (altas.length > MAX_ALTAS_POR_SENTENCIA) return CONSERVADOR;
  const salida = [];
  for (const ins of altas) {
    const r = usosUnInsert(sentencia, ins, pares);
    if (r === CONSERVADOR) return CONSERVADOR;
    salida.push(...r);
  }
  return salida;
}

function usosUnInsert(sentencia, ins, pares) {
  const hallados = [];
  const resto = ins.index + ins[0].length;
  if (sentencia[resto] !== '(') {
    const m = RE_CURRENT_DATE.exec(sentencia.slice(resto, resto + MAX_EXPRESION));
    return m ? [resto + m.index] : [];
  }
  const cierre = pares[resto];
  if (cierre < 0) return CONSERVADOR;
  const columnas = partesTop(sentencia.slice(resto + 1, cierre)).map((x) => x.txt.trim().replace(/^"|"$/g, '').toLowerCase());
  const k = columnas.indexOf('ingreso_en');
  if (k < 0) return [];
  const base = cierre + 1;
  const cola = sentencia.slice(base);
  const listas = []; // [{ txt, off }] por cada fila de valores o lista del select
  const v = /^\s*(?:overriding\s+\w+\s+value\s+)?values\b/i.exec(cola);
  if (v) {
    let i = v[0].length;
    while (i < cola.length) {
      const abre = cola.indexOf('(', i);
      if (abre < 0) break;
      const fin = pares[base + abre];
      if (fin < 0) return CONSERVADOR;
      listas.push({ txt: sentencia.slice(base + abre + 1, fin), off: abre + 1 });
      i = fin - base + 1;
      if (!/^\s*,/.test(cola.slice(i, i + 20))) break;
    }
  } else {
    const sel = /^\s*select\b/i.exec(cola);
    if (!sel) return [];
    const ini = sel[0].length;
    const fin = cola.slice(ini).search(/(?<![a-z0-9_])(from|where|returning|on\s+conflict)(?![a-z0-9_])/i);
    listas.push({ txt: cola.slice(ini, fin < 0 ? cola.length : ini + fin), off: ini });
  }
  for (const l of listas) {
    const celda = partesTop(l.txt)[k];
    if (!celda) continue;
    const c = RE_CURRENT_DATE.exec(celda.txt);
    if (c) hallados.push(base + l.off + celda.off + c.index);
  }
  return hallados;
}

// Usos de `current_date` que alimentan `reparaciones.ingreso_en` dentro de una sentencia ya enmascarada. Devuelve índices
// (o CONSERVADOR). Lineal: cada `ingreso_en =` se asocia UNA vez con el último `update ... reparaciones` anterior.
function usosCurrentDateIngreso(sentencia, pares) {
  const altas = usosInsertIngreso(sentencia, pares);
  if (altas === CONSERVADOR) return CONSERVADOR;
  const hallados = [...altas];
  // (b) update ... reparaciones ... set ... ingreso_en = <expresión con current_date>.
  const updates = [...sentencia.matchAll(/update\s+(?:dominio\.)?reparaciones\b/gi)].map((m) => m.index);
  if (updates.length) {
    let u = 0;
    for (const m of sentencia.matchAll(/(?<![a-z0-9_])ingreso_en\s*=(?!=)\s*/gi)) {
      while (u + 1 < updates.length && updates[u + 1] < m.index) u++;
      if (updates[u] > m.index) continue; // todavía no hubo ningún update antes
      const ini = m.index + m[0].length;
      const expr = expresionDesde(sentencia, ini);
      if (expr === CONSERVADOR) return CONSERVADOR;
      const c = RE_CURRENT_DATE.exec(expr);
      if (c) hallados.push(ini + c.index);
    }
  }
  // (c) crear_reparacion(... p_ingreso => <expresión con current_date>) (o p_ingreso_en).
  if (/(?<![a-z0-9_])crear_reparacion\s*\(/i.test(sentencia)) {
    for (const m of sentencia.matchAll(/(?<![a-z0-9_])p_ingreso(?:_en)?\s*=>\s*/gi)) {
      const ini = m.index + m[0].length;
      const expr = expresionDesde(sentencia, ini);
      if (expr === CONSERVADOR) return CONSERVADOR;
      const c = RE_CURRENT_DATE.exec(expr);
      if (c) hallados.push(ini + c.index);
    }
  }
  return hallados;
}

// T7: entre 00:00 y 03:00 UTC `current_date` ya es «mañana» en Buenos Aires y `reparaciones.ingreso_en` rechaza fechas futuras.
// Cubre `insert into reparaciones`, `update reparaciones set ingreso_en = ...` y `crear_reparacion(... p_ingreso => ...)`.
// El SQL se recorre con `recorrerSql`: los `;` y el texto `current_date` dentro de literales o comentarios no cuentan, y un
// `throws_ok($$ ... ; ... $$, ...)` es una sola sentencia y solo lo que está dentro de los argumentos del `throws_ok` queda eximido.
export function revisarFechasBuenosAires({ pruebas }) {
  const problemas = [];
  for (const p of pruebas) {
    const { sentencias, sinCerrar } = recorrerSql(p.sql);
    if (sinCerrar >= 0) {
      problemas.push(`${p.ruta}:${lineaDe(p.sql, sinCerrar)} tiene una comilla, comentario o bloque de dólares sin cerrar: el resto del archivo queda sin revisar y no se puede comprobar que no use current_date (UTC) como ingreso. Cerralo.`);
    }
    for (const s of sentencias) {
      const aviso = (idx, texto) => `${p.ruta}:${lineaDe(p.sql, s.desde + idx)} ${texto}`;
      if (s.texto.length > TOPE_SENTENCIA) {
        if (/reparaciones|crear_reparacion/i.test(s.texto)) {
          problemas.push(aviso(0, `sentencia de más de ${TOPE_SENTENCIA} caracteres que toca reparaciones: no se puede comprobar que no use current_date (UTC) como ingreso. Partila con ';'.`));
        }
        continue;
      }
      const pares = paresParentesis(s.texto);
      const usos = usosCurrentDateIngreso(s.texto, pares);
      if (usos === CONSERVADOR) {
        problemas.push(aviso(0, 'alta de reparación con paréntesis sin cerrar, demasiadas altas o una expresión de ingreso de más de 300 caracteres en una sentencia: no se puede comprobar que no use current_date (UTC) como ingreso. Revisá la sintaxis.'));
        continue;
      }
      // La exención es solo para lo que está DENTRO de los argumentos de un `throws_ok(...)` (prueba que el alta se rechaza).
      const exentos = tramosThrowsOk(s.texto, pares);
      if (exentos === CONSERVADOR) {
        problemas.push(aviso(0, 'throws_ok( sin cerrar: no se sabe hasta dónde llega lo que se exime, no se puede comprobar que no use current_date (UTC) como ingreso. Revisá los paréntesis.'));
        continue;
      }
      let n = 0;
      for (const idx of usos) {
        if (exentos.some(([d, h]) => idx >= d && idx < h)) continue;
        if (++n > 20) { problemas.push(aviso(idx, 'más usos de current_date como ingreso en esta sentencia (se omiten el resto).')); break; }
        problemas.push(aviso(idx,
          'usa current_date (UTC) como fecha de ingreso de una reparación: '
          + "entre las 00:00 y las 03:00 UTC es «mañana» en Buenos Aires y la app rechaza «El ingreso no puede ser una fecha futura». "
          + "Usá (now() at time zone 'America/Argentina/Buenos_Aires')::date."));
      }
    }
  }
  return problemas;
}

const RE_ESCRITURA_E2E = /\b(rest|borrar)\(\s*(['"`])([a-z_][a-z0-9_]*)[^'"`]*\2([^()]*?)\)/gi;

// T5: escrituras E2E con la service-role key en `dominio` (rest/borrar con esquema 'dominio') sin grant para service_role.
export function revisarE2E({ e2e, tablasConGrant, versionCreacion, inalterables = new Set() }) {
  const problemas = [];
  for (const f of e2e) {
    for (const m of f.sql.matchAll(RE_ESCRITURA_E2E)) {
      const [, fn, , tabla, resto] = m;
      // rest(ruta, cuerpo, esquema, prefer) lleva el esquema como 3er argumento; borrar(ruta, esquema), como 2do.
      if (!/(['"`])dominio\1/.test(resto)) continue;
      const nombre = tabla.toLowerCase();
      const creada = versionCreacion.get(nombre);
      if (!creada || creada <= VERSION_GRANT_MASIVO || inalterables.has(nombre) || tablasConGrant.has(nombre)) continue;
      problemas.push(
        `${f.ruta}:${lineaDe(f.sql, m.index)} escribe con la service-role key en dominio.${nombre} (${fn}) pero ninguna migración da `
        + 'grant ... to service_role para esa tabla (service_role tiene permisos mínimos por tabla y la API devuelve 403/42501). '
        + `Sumá el grant a la migración que crea ${nombre} o sembrá el dato por una RPC.`,
      );
    }
  }
  return problemas;
}

// Revisión completa sobre contenido ya leído (pura: la usa la prueba).
export function revisar({ migracionesDiff, pruebas, e2e, todasMigraciones, sqlTestPrivilegios = '' }) {
  const inalterables = inalterablesDe(sqlTestPrivilegios);
  const tablasConGrant = new Set();
  const versionCreacion = new Map();
  for (const m of todasMigraciones) {
    for (const t of tablasCreadas(m.sql)) if (t.esquema === 'dominio' && !versionCreacion.has(t.tabla)) versionCreacion.set(t.tabla, versionDe(m.ruta));
    for (const g of grantsServiceRole(m.sql)) {
      for (const [, nombre] of g.matchAll(/(?:dominio\.)([a-z0-9_]+)/g)) tablasConGrant.add(nombre);
      if (/all\s+tables\s+in\s+schema\s+dominio/.test(g)) for (const t of versionCreacion.keys()) tablasConGrant.add(t);
    }
  }
  return [
    ...revisarGrants({ migracionesDiff, inalterables }),
    ...revisarVariablesPsql({ pruebas }),
    ...revisarFechasBuenosAires({ pruebas }),
    ...revisarExportacionTotal({ migracionesDiff }),
    ...revisarSupersetExportacion({ migracionesDiff, todasMigraciones }),
    ...revisarE2E({ e2e, tablasConGrant, versionCreacion, inalterables }),
  ];
}

// Qué hacer si falta la base de comparación: en CI falla cerrado (sin base no se revisa nada y pasaría en falso); en local avisa.
export function sinBase({ base, env = process.env }) {
  const ci = Boolean(env.CI || env.GITHUB_ACTIONS);
  return ci
    ? { codigo: 1, nivel: 'error', mensaje: `error: no existe la base ${base} y en CI no se puede omitir la revisión de trampas conocidas. Traé la base (git fetch origin) o usá fetch-depth: 0 en el checkout.` }
    : { codigo: 0, nivel: 'warn', mensaje: `aviso: no existe la base ${base}: se omiten las trampas conocidas (en CI esto fallaría)` };
}

function main() {
  const args = process.argv.slice(2);
  const valorDe = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const base = valorDe('--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dokploy');
  if (!/^[\w./-]+$/.test(base) || base.startsWith('-')) { console.error(`Valor de --base no válido: ${base}`); process.exit(2); }
  const todo = args.includes('--todo');
  const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const leer = (r) => { try { return readFileSync(r, 'utf8'); } catch { return null; } };

  const tracked = (git(['ls-files']).stdout || '').split('\n').filter(Boolean);
  let cambiados;
  if (todo) {
    cambiados = new Set(tracked);
  } else {
    if (git(['rev-parse', '--verify', '--quiet', base]).status !== 0) {
      const r = sinBase({ base });
      console[r.nivel === 'error' ? 'error' : 'warn'](r.mensaje);
      return r.codigo;
    }
    const mb = git(['merge-base', base, 'HEAD']).stdout.trim() || base;
    const diff = git(['diff', '--name-only', '--diff-filter=ACMR', mb]);
    if (diff.status !== 0) { console.error(diff.stderr.trim() || 'No se pudo calcular el diff.'); return 1; }
    cambiados = new Set(diff.stdout.split('\n').filter(Boolean));
  }

  const cargar = (rutas) => rutas.map((ruta) => ({ ruta, sql: leer(ruta) })).filter((x) => x.sql !== null);
  const esMigracion = (f) => /^supabase\/migrations\/\d+_[^/]+\.sql$/.test(f);
  const todasMigraciones = cargar(tracked.filter(esMigracion));
  const migracionesDiff = todasMigraciones.filter((m) => cambiados.has(m.ruta));
  const pruebas = cargar([...cambiados].filter((f) => /^supabase\/tests\/database\/.+\.sql$/.test(f)));
  const e2e = cargar([...cambiados].filter((f) => /^apps\/web\/e2e\/.+\.ts$/.test(f)));

  const problemas = revisar({ migracionesDiff, pruebas, e2e, todasMigraciones, sqlTestPrivilegios: leer(RUTA_TEST_PRIVILEGIOS) || '' });
  if (problemas.length) {
    console.error('Trampas conocidas: este cambio repite un fallo de CI ya visto');
    for (const p of problemas) console.error(` - ${p}`);
    return 1;
  }
  console.log(`Trampas conocidas: OK (${migracionesDiff.length} migración(es), ${pruebas.length} prueba(s) pgTAP y ${e2e.length} E2E revisados${todo ? ', árbol completo' : ` contra ${base}`}).`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
