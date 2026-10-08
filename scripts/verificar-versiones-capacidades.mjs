import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionTuple(version, id) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error(`Versión inválida en ${id}.`);
  return version.split('.').map(Number);
}

function compare(left, right, id) {
  const a = versionTuple(left, id);
  const b = versionTuple(right, id);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function sourceMatches(file, capability) {
  return capability.paths.some((pattern) => pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern);
}

export function verifyVersionBumps(previous, current, changedFiles) {
  if (previous?.schema_version !== 1 || current?.schema_version !== 1 || !Array.isArray(previous.capabilities) || !Array.isArray(current.capabilities)) {
    throw new Error('No se pudo validar el esquema versionado del catálogo.');
  }
  for (const capability of current.capabilities) {
    if (typeof capability.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability.id) ||
        !Array.isArray(capability.paths) || capability.paths.length === 0 ||
        capability.paths.some((item) => typeof item !== 'string' || !item)) {
      throw new Error('El catálogo contiene una capacidad sin rutas de implementación válidas.');
    }
    versionTuple(capability.version, capability.id);
  }
  const currentById = new Map(current.capabilities.map((item) => [item.id, item]));
  const removed = previous.capabilities.filter((item) => !currentById.has(item.id));
  if (removed.length) throw new Error(`Las capacidades publicadas son inmutables; no se pueden borrar: ${removed.map((item) => item.id).join(', ')}.`);

  const violations = [];
  for (const oldCapability of previous.capabilities) {
    const nextCapability = currentById.get(oldCapability.id);
    const touched = changedFiles.some((file) => sourceMatches(file, nextCapability) || sourceMatches(file, oldCapability));
    if (touched && compare(nextCapability.version, oldCapability.version, oldCapability.id) <= 0) {
      violations.push({ id: oldCapability.id, version: oldCapability.version, paths: changedFiles.filter((file) => sourceMatches(file, nextCapability) || sourceMatches(file, oldCapability)) });
    }
  }
  return violations;
}

function argumentValue(args, key, fallback) {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}.`);
  return value;
}

async function main(args) {
  const base = argumentValue(args, '--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  const files = git(['diff', '--name-only', `${base}...HEAD`]).split(/\r?\n/).filter(Boolean);
  const nextJson = await readFile(path.resolve('template-capabilities.json'), 'utf8');
  let previous;
  try {
    previous = JSON.parse(git(['show', `${base}:template-capabilities.json`]));
  } catch {
    previous = { schema_version: 1, capabilities: [] };
  }
  const violations = verifyVersionBumps(previous, JSON.parse(nextJson), files);
  if (violations.length) {
    console.error('Actualizá la versión SemVer de cada capacidad cuya implementación cambió:');
    for (const item of violations) console.error(`- ${item.id} (${item.version}): ${item.paths.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Versiones de capacidades: OK (${files.length} archivos comparados contra ${base}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Verificación de versiones: ${error.message}`);
    process.exitCode = 2;
  });
}
