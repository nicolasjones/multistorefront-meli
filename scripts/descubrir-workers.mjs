import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArgs(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : 'workers';
  if (!root || root.startsWith('--')) {
    throw new Error('--root requiere una ruta');
  }
  return { root: path.resolve(root), json: argv.includes('--json') };
}

export function discoverWorkers(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    throw new Error(`No existe el directorio de workers: ${rootDirectory}`);
  }

  const workers = [];
  for (const entry of fs.readdirSync(rootDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === 'fixtures') {
      continue;
    }
    if (!NAME_PATTERN.test(entry.name)) {
      throw new Error(`Nombre de worker inválido: ${entry.name}`);
    }

    const directory = path.join(rootDirectory, entry.name);
    const packagePath = path.join(directory, 'package.json');
    if (!fs.existsSync(packagePath)) {
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const expectedPackage = `@workers/${entry.name}`;
    if (packageJson.name !== expectedPackage) {
      throw new Error(`${packagePath} debe declarar name=${expectedPackage}`);
    }
    const scripts = packageJson.scripts ?? {};
    for (const script of ['build', 'lint', 'test', 'start']) {
      if (typeof scripts[script] !== 'string' || scripts[script].length === 0) {
        throw new Error(`${packagePath} debe declarar el script ${script}`);
      }
    }
    if (!fs.existsSync(path.join(directory, 'src', 'index.ts'))) {
      throw new Error(`${directory} debe contener src/index.ts`);
    }

    workers.push({
      id: entry.name,
      directory: path.relative(process.cwd(), directory).replaceAll(path.sep, '/'),
      packageName: packageJson.name,
    });
  }

  return workers.sort((left, right) => left.id.localeCompare(right.id));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { root, json } = parseArgs(process.argv.slice(2));
    const workers = discoverWorkers(root);
    if (workers.length === 0) {
      throw new Error(`No se encontraron workers válidos en ${root}`);
    }
    process.stdout.write(json ? `${JSON.stringify(workers, null, 2)}\n` : `${workers.map((worker) => worker.id).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
