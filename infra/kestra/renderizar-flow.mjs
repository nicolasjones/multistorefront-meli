import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { argumentValue } from '../../scripts/operaciones.mjs';

const args = process.argv.slice(2);
const source = argumentValue(args, '--source');
const output = argumentValue(args, '--output');
const rawConcurrency = argumentValue(args, '--concurrencia', process.env.KESTRA_ORQUESTACION_CONCURRENCIA);
const concurrency = Number(rawConcurrency);

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000) {
  throw new Error('KESTRA_ORQUESTACION_CONCURRENCIA o --concurrencia debe ser un entero entre 1 y 1000.');
}

const flow = await readFile(path.resolve(source), 'utf8');
const rendered = flow.replace(/^    concurrencyLimit: \d+$/m, `    concurrencyLimit: ${concurrency}`);
if (rendered === flow) throw new Error('No se encontró el campo concurrencyLimit esperado para renderizar.');
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(path.resolve(output), rendered, 'utf8');
