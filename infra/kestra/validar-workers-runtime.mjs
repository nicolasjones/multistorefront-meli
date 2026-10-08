import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run } from '../../scripts/operaciones.mjs';

const execute = process.argv.includes('--execute');
const flows = (await readdir('infra/kestra/flows', { recursive: true })).filter((file) => file.endsWith('.yml'));
for (const relative of flows) {
  const file = path.join('infra/kestra/flows', relative);
  const content = await readFile(file, 'utf8');
  if (!content.includes('docker run')) continue;
  for (const required of ['. /opt/automation-platform/worker.env', '--read-only', '--tmpfs /tmp', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--cpus', '--memory', '--network', 'timeout: PT30M', 'Red de egress no autorizada']) {
    if (!content.includes(required)) throw new Error(`${file} no contiene ${required}.`);
  }
}

if (!execute) {
  console.log(`Contrato estático OK para ${flows.length} flows.`);
  process.exit();
}

const dockerExit = async (args) => await new Promise((resolve, reject) => {
  const child = spawn('docker', args, { stdio: 'ignore', windowsHide: true });
  child.on('error', reject);
  child.on('close', (code) => resolve(code ?? 1));
});
const fixture = path.resolve('infra/kestra/fixtures/worker-runtime/worker.sh');
const image = 'node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81';
for (const scenario of [{ result: 'success', runs: 34, expected: 0 }, { result: 'technical-failure', runs: 33, expected: 42 }, { result: 'invalid-credential', runs: 33, expected: 78 }]) {
  const shell = `i=1; while [ $i -le ${scenario.runs} ]; do sh /fixture/worker.sh >/dev/null 2>/dev/null; actual=$?; [ $actual -eq ${scenario.expected} ] || exit $actual; i=$((i + 1)); done`;
  const code = await dockerExit(['run', '--rm', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--network', 'none', '-e', `FIXTURE_RESULT=${scenario.result}`, '-v', `${fixture}:/fixture/worker.sh:ro`, image, 'sh', '-c', shell]);
  if (code !== 0) throw new Error(`Fixture ${scenario.result} falló: se esperaba ${scenario.expected}, recibido ${code}.`);
}
const timeoutCode = await dockerExit(['run', '--rm', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--network', 'none', image, 'node', '-e', 'setTimeout(() => process.exit(124), 2000)']);
if (timeoutCode !== 124) throw new Error(`El fixture de timeout debía devolver 124 y devolvió ${timeoutCode}.`);
const egressCode = await dockerExit(['run', '--rm', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--network', 'none', image, 'node', '-e', "fetch('https://example.com', { signal: AbortSignal.timeout(3000) }).then(() => process.exit(1)).catch(() => process.exit(0))"]);
if (egressCode !== 0) throw new Error('El fixture de egress pudo alcanzar una red externa con --network none.');
console.log('Fixture Docker ejecutado 100 veces, con timeout y sin red externa.');
