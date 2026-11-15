#!/usr/bin/env node
// Trampas conocidas del repo: errores que costaron horas de CI y que se detectan leyendo el diff.
// Cada regla replica un fallo real del CI (2026-11-15) para que falle en segundos, antes de la corrida pesada.
//
//   T1  Tabla nueva de `dominio` sin `grant ... to service_role`        (service_role_privilegios.test.sql)
//   T2  Variable de psql `:'x'` dentro de un bloque `$$ ... $$` de pgTAP (psql no interpola ahí)
//   T4  Tabla nueva con `organizacion_id` que no está en la exportación total   (exportacion_total.test.sql)
//   T6  Redefinición de `conjuntos_exportacion_total()` que pierde filas de la versión vigente (pisa lo que agregó otra rama)
//   T5  E2E que escribe con la service-role key en una tabla de `dominio` sin grant para service_role
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
  return new Set([...cuerpo.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*\)/gi)].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`));
}

// Pérdidas declaradas con `-- exportacion-total: se quita <esquema>.<tabla> (motivo)`.
export function perdidasDeclaradas(sqlOriginal) {
  return new Set([...sqlOriginal.matchAll(/--\s*exportacion-total:\s*se\s+quita\s+([a-z0-9_]+)\.([a-z0-9_]+)/gi)].map((m) => `${m[1].toLowerCase()}.${m[2].toLowerCase()}`));
}

// T6: una migración nueva que redefine la función debe partir de la versión vigente (la anterior de mayor versión que la
// defina, en la base o en el propio diff) y conservar todas sus filas, salvo las quitadas a propósito y declaradas.
export function revisarSupersetExportacion({ migracionesDiff, todasMigraciones }) {
  const problemas = [];
  const definen = todasMigraciones
    .map((m) => ({ ...m, version: versionDe(m.ruta), filas: filasConjuntosExportacion(m.sql) }))
    .filter((m) => m.filas)
    .sort((a, b) => a.version.localeCompare(b.version));
  const enDiff = new Set(migracionesDiff.map((m) => m.ruta));
  for (const [i, m] of definen.entries()) {
    if (!enDiff.has(m.ruta) || i === 0) continue;
    const previa = definen[i - 1];
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
    ...revisarExportacionTotal({ migracionesDiff }),
    ...revisarSupersetExportacion({ migracionesDiff, todasMigraciones }),
    ...revisarE2E({ e2e, tablasConGrant, versionCreacion, inalterables }),
  ];
}

function main() {
  const args = process.argv.slice(2);
  const valorDe = (flag, def) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const base = valorDe('--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dokploy');
  const todo = args.includes('--todo');
  const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const leer = (r) => { try { return readFileSync(r, 'utf8'); } catch { return null; } };

  const tracked = (git(['ls-files']).stdout || '').split('\n').filter(Boolean);
  let cambiados;
  if (todo) {
    cambiados = new Set(tracked);
  } else {
    if (git(['rev-parse', '--verify', '--quiet', base]).status !== 0) {
      console.warn(`aviso: no existe la base ${base}: se omiten las trampas conocidas`);
      return 0;
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
