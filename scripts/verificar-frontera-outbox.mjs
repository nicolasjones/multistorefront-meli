import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ninguna migración puede hacer HTTP saliente desde SQL: el envío va por un flow de Kestra o una Edge Function.
const prohibited = /\b(pg_net|net\.http|http_(get|post)|webhook)\b/i;
// Recorrido de una pasada (no regex sobre texto crudo): reconoce literales '...' (con '' escapado y E'...' con
// barra), identificadores "...", dollar-quoting $tag$...$tag$, comentarios `--` y `/* */` anidables. Los comentarios
// se descartan; todo lo demás se evalúa tal cual (un literal puede esconder SQL dinámico). ÚNICA excepción: el
// literal de una sentencia que EMPIEZA con `comment on ... is '<literal>'` (texto descriptivo, puede nombrar un
// webhook). Literal o comentario sin cerrar: falla cerrado (devuelve null).
export function sqlEjecutable(sql) {
  let salida = ''
  let i = 0
  let cabeza = [] // palabras de la sentencia en curso, hasta el primer literal
  let ultimaSignificativa = ''
  const n = sql.length
  const significativo = (texto, palabra) => {
    salida += texto
    ultimaSignificativa = palabra
    if (cabeza.length < 64 && palabra) cabeza.push(palabra)
  }
  while (i < n) {
    const c = sql[i]
    if (/\s/.test(c)) { salida += c; i++; continue }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
      salida += ' '
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let nivel = 1
      i += 2
      while (i < n && nivel > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { nivel++; i += 2 } else if (sql[i] === '*' && sql[i + 1] === '/') { nivel--; i += 2 } else i++
      }
      if (nivel > 0) return null
      salida += ' '
      continue
    }
    if (c === "'") {
      const previo = salida.slice(-1) === 'E' || salida.slice(-1) === 'e'
      const esEscape = previo && !/[\w$]/.test(salida.slice(-2, -1) || ' ')
      let j = i + 1
      let cerrado = false
      while (j < n) {
        if (esEscape && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          cerrado = true
          break
        }
        j++
      }
      if (!cerrado) return null
      const esDescripcion = cabeza[0] === 'comment' && cabeza[1] === 'on' && ultimaSignificativa === 'is' && !esEscape
      salida += esDescripcion ? "''" : sql.slice(i, j + 1)
      ultimaSignificativa = "'"
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1
      if (j >= n) return null
      significativo(sql.slice(i, j + 1), '"')
      i = j + 1
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 80))
      if (m) {
        const cierre = sql.indexOf(m[0], i + m[0].length)
        if (cierre === -1) return null
        significativo(sql.slice(i, cierre + m[0].length), '$')
        i = cierre + m[0].length
        continue
      }
    }
    if (c === ';') {
      salida += c
      cabeza = []
      ultimaSignificativa = ';'
      i++
      continue
    }
    const palabra = /^[A-Za-z_][\w$]*/.exec(sql.slice(i, i + 200))
    if (palabra) {
      significativo(palabra[0], palabra[0].toLowerCase())
      i += palabra[0].length
      continue
    }
    significativo(c, c)
    i++
  }
  return salida
}

export function violaFrontera(contents) {
  const ejecutable = sqlEjecutable(contents)
  return ejecutable === null || prohibited.test(ejecutable);
}

async function main() {
  const migrationsDir = path.resolve('supabase/migrations');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql'));
  const offenders = [];
  for (const file of files) {
    if (violaFrontera(await readFile(path.join(migrationsDir, file), 'utf8'))) offenders.push(file);
  }
  if (offenders.length > 0) {
    console.error(`Frontera outbox inválida: SQL saliente en ${offenders.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Frontera outbox válida: no hay HTTP, pg_net ni webhooks en migraciones SQL.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
