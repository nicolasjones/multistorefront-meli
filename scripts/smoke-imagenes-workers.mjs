import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

const discoveredWorkers = execFileSync('node', ['scripts/descubrir-workers.mjs'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const prefix = process.argv[2] ?? 'local/worker-';
const requestedWorker = process.argv[3];
const workers = requestedWorker ? [requestedWorker] : discoveredWorkers;
if (requestedWorker && !discoveredWorkers.includes(requestedWorker)) {
  throw new Error(`Worker no descubierto: ${requestedWorker}`);
}
const failures = [];
const sentinel = 'SMOKE_SECRET_NO_LEAK';

// El nombre de carpeta del worker (kebab-case) no siempre coincide con el
// valor de SISTEMA_EXTERNO que espera su código (por ejemplo un nombre con
// guión bajo). Si un worker real lo necesita, agregar su mapeo acá.
const SISTEMA_EXTERNO_POR_WORKER = {};

function smokeEnvironment(worker) {
  const system = SISTEMA_EXTERNO_POR_WORKER[worker] ?? worker;
  return [
    'ORGANIZACION_ID=00000000-0000-4000-8000-000000000001',
    'CONEXION_ID=00000000-0000-4000-8000-000000000002',
    `SISTEMA_EXTERNO=${system}`,
    `DATABASE_URL=postgresql://worker:${sentinel}@127.0.0.1:1/postgres`,
    'SUPABASE_URL=http://127.0.0.1:1',
    `SUPABASE_SERVICE_ROLE_KEY=${sentinel}`,
    'PLAYWRIGHT_WS_ENDPOINT=ws://127.0.0.1:1',
    'PERIODO_DESDE=2026-01-01',
    'PERIODO_HASTA=2026-01-31',
    'EJECUCION_ID=smoke-worker-runtime'
  ];
}

function runWorkerSmoke(worker, image) {
  const name = `worker-smoke-${worker}-${process.pid}`;
  const args = ['run', '--name', name, '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--network', 'none'];
  for (const value of smokeEnvironment(worker)) args.push('--env', value);
  args.push(image);
  try {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 20_000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (output.includes(sentinel)) throw new Error('el proceso expuso una credencial de fixture');
    if (result.error) throw result.error;
    if (result.status === null) throw new Error('el worker no terminó dentro del límite de smoke');
    return result.status;
  } finally {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  }
}

for (const worker of workers) {
  const image = `${prefix}${worker}:test`;
  try {
    const raw = execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
    const [metadata] = JSON.parse(raw);
    const user = metadata.Config?.User ?? '';
    const architecture = metadata.Architecture;
    const command = metadata.Config?.Cmd ?? metadata.Config?.Entrypoint ?? [];
    if (!user || user === '0' || user === 'root') {
      throw new Error(`usuario inseguro: ${user || 'vacío'}`);
    }
    if (architecture && architecture !== 'amd64') {
      throw new Error(`arquitectura inesperada: ${architecture}`);
    }
    if (!command.length) {
      throw new Error('sin entrypoint o comando');
    }
    const status = runWorkerSmoke(worker, image);
    process.stdout.write(`OK ${worker}: user=${user} arch=${architecture ?? 'unknown'} exit=${status}\n`);
  } catch (error) {
    failures.push(`${worker}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  process.stderr.write(`Smoke test falló:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
}
