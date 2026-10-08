import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const artifactIndex = args.indexOf('--artifact-directory');
const artifactDirectory = artifactIndex === -1 ? undefined : args[artifactIndex + 1];
if (artifactIndex !== -1 && !artifactDirectory) throw new Error('Falta el valor de --artifact-directory.');
const flows = args.filter((value, index) => args[index - 1] === '--flow');
const flowPaths = flows.length > 0 ? flows : ['infra/kestra/flows/plantilla-generico.yml', 'infra/kestra/flows/plantilla-dedicado.yml'];
const violations = [];

for (const flowPath of flowPaths) {
  const content = await readFile(flowPath, 'utf8');
  const add = (condition, message) => { if (condition) violations.push(`${flowPath}: ${message}`); };
  add(/^\s*- id: obtener_credencial_/m.test(content), 'Kestra todavía tiene una tarea de obtención de credencial');
  add(/^\s*-e\s+CREDENCIAL=/m.test(content), 'el comando Docker recibe CREDENCIAL');
  add(!/^\s*set -a\s*$/m.test(content) || !/^\s*\. \/opt\/automation-platform\/worker\.env\s*$/m.test(content), 'el host SSH no carga la configuración local del worker');
  for (const variable of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    add(!(new RegExp(`--env\\s+${variable}(?:\\s|\\\\)`).test(content)), `el worker no hereda ${variable} desde el entorno local del host`);
  }
  add(/--env-file\s+\/opt\/automation-platform\/worker\.env/.test(content), '--env-file no es seguro para un daemon Docker remoto');
  add(/\{\{\s*outputs\.obtener_credencial_/.test(content), 'una expresión referencia un output de credencial');
  add(/^\s*password:\s*\{\{\s*outputs\./m.test(content), 'SSH recibe una contraseña desde un output');
  add(!/privateKey:\s*"\{\{\s*secret\('ORQUESTACION_SSH_PRIVATE_KEY'\)\s*\}\}"/.test(content), 'SSH no usa el secreto estático de orquestación');
  add(/^\s*motivo:\s*"?\{\{\s*errorLogs\(\)\s*\}\}"?/m.test(content), 'errorLogs() todavía se envía como motivo persistible');
  add(!/^\s*motivo_sanitizado:\s*(?:"CREDENCIAL_INVALIDA:|FALLA_TECNICA_SANITIZADA)/m.test(content), 'el handler no recibe un motivo sanitizado explícito');
}

if (artifactDirectory) {
  const sentinel = process.env.CREDENCIAL_CENTINELA;
  if (!sentinel) throw new Error('Definí CREDENCIAL_CENTINELA sólo al inspeccionar artefactos.');
  const variants = [...new Set([sentinel, encodeURIComponent(sentinel), Buffer.from(sentinel).toString('base64')])];
  const entries = await readdir(artifactDirectory, { recursive: true, withFileTypes: true });
  const leaks = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const content = await readFile(file, 'utf8');
    if (variants.some((variant) => content.includes(variant))) leaks.push(file);
  }
  if (leaks.length) violations.push(`Hay variantes de la credencial centinela en ${leaks.length} artefacto(s) de Kestra.`);
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK: no se detectaron canales persistibles ni variantes de la credencial centinela.');
}
