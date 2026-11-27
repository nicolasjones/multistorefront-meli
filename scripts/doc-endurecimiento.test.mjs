// Pruebas de docs/endurecimiento-infra.md: los comandos que Nicolás copia y pega tienen que ser shell válida (revisión C+S del #1238, M-4: una `\\` al final
// de línea partía el comando) y los flags del firewall que la doc usa tienen que existir en el script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(path.join(raiz, 'docs', 'endurecimiento-infra.md'), 'utf8');
const script = readFileSync(path.join(raiz, 'infra', 'vps', 'firewall-docker-user.sh'), 'utf8');

function bloques(texto, lenguaje) {
  const salida = [];
  const re = new RegExp(`\`\`\`${lenguaje}\\n([\\s\\S]*?)\`\`\``, 'g');
  for (const m of texto.matchAll(re)) salida.push(m[1]);
  return salida;
}

test('hay bloques bash y ninguno termina una línea con dos barras invertidas', () => {
  const bash = bloques(doc, 'bash');
  assert.ok(bash.length >= 8, `solo ${bash.length} bloques bash`);
  for (const b of bash) for (const linea of b.split('\n')) assert.ok(!linea.endsWith('\\\\'), `línea con \\\\ al final: ${linea.slice(0, 80)}`);
});

test('cada bloque bash es sintácticamente válido (`bash -n`, con los <marcadores> reemplazados)', () => {
  for (const b of bloques(doc, 'bash')) {
    const literal = b.replace(/<[^>\n]+>/g, 'X');
    const r = spawnSync('bash', ['-n'], { input: literal, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stderr}\n--- bloque ---\n${b.slice(0, 300)}`);
  }
});

test('la mutación de la revisión (una barra de más) SÍ se detecta como línea partida', () => {
  const malo = 'bash /root/x.sh --aplicar \\\\\n  --chequeo true\n';
  const r = spawnSync('bash', ['-c', `set -e; bash -n <<'FIN'\n${malo}FIN\n`], { encoding: 'utf8' });
  // `bash -n` acepta el texto (es válido: la 2.ª línea es otro comando): por eso el test de arriba mira las dos barras, no solo la sintaxis.
  assert.equal(r.status, 0);
  assert.ok(malo.split('\n')[0].endsWith('\\\\'));
});

test('todos los flags de firewall-docker-user.sh que usa la doc existen en el script', () => {
  const usados = new Set();
  for (const b of bloques(doc, 'bash')) {
    const unido = b.replace(/\\\n\s*/g, ' ');
    for (const linea of unido.split('\n')) {
      if (!linea.includes('firewall-docker-user.sh')) continue;
      for (const m of linea.matchAll(/(?:^|\s)(--[a-z0-9-]+)/g)) usados.add(m[1]);
    }
  }
  assert.ok(usados.size >= 3);
  for (const flag of usados) assert.ok(script.includes(`${flag})`), `el script no acepta ${flag}`);
});

test('el orden de las acciones: rotar secretos y firewall ANTES de los runners; la base por Tailscale antes del firewall', () => {
  const acciones = doc.slice(doc.indexOf('## ACCIONES DE NICOLÁS'));
  const pos = (titulo) => acciones.search(new RegExp(`^\\d+\\. \\*\\*${titulo}`, 'm'));
  assert.ok(pos('Rotar los secretos') !== -1 && pos('Runners') !== -1 && pos('Firewall') !== -1 && pos('`SUPABASE_DB_URL`') !== -1);
  assert.ok(pos('Rotar los secretos') < pos('Runners'), 'la rotación va antes de instalar los runners');
  assert.ok(pos('Firewall') < pos('Runners'), 'el firewall con las redes de jobs va antes de los runners');
  assert.ok(pos('`SUPABASE_DB_URL`') < pos('Firewall'), 'la base por Tailscale va antes de cerrar el firewall');
  assert.ok(pos('Política de aprobación de forks') < pos('Runners') && pos('Environments de deploy') < pos('Runners'));
  assert.match(acciones, /Los de \*\*producción\*\* aceptan SOLO `main`/);
  assert.match(acciones, /leé primero lo que hay y reenviálo/);
  assert.match(acciones, /gh secret set RELEASE_PLEASE_TOKEN --env release/);
  assert.match(acciones, /<valor-actual>/);
});

test('la doc no afirma que los jobs llegan al host o a la tailnet', () => {
  assert.doesNotMatch(doc, /no llegan a `172\.17\.0\.1`/);
  assert.match(doc, /un job \*\*no\*\* llega al host del VPS ni a la tailnet por defecto/);
});
