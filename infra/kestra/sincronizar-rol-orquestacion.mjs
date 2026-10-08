import { spawn } from 'node:child_process';
import { requireEnvironment } from '../../scripts/operaciones.mjs';

const password = requireEnvironment('KESTRA_ORQUESTACION_DB_PASSWORD');

function invoke(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} terminó con código ${code}.`)));
    child.stdin.end(options.input);
  });
}

const containers = (await invoke('docker', ['ps', '--format', '{{.Names}}'])).split(/\r?\n/);
const database = containers.find((name) => name.startsWith('supabase_db_multistorefront-meli-supabase-'));
if (!database) throw new Error('No hay una base local en ejecución.');

const literal = password.replaceAll("'", "''");
await invoke('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: `alter role kestra_orquestacion password '${literal}';\n`,
});
console.log('Rol local de Kestra sincronizado.');
