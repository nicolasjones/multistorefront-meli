import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const STATUSES = new Set(['adopted', 'deferred', 'not-applicable']);

function parseVersion(value, label) {
  if (typeof value !== 'string' || !VERSION.test(value)) {
    throw new Error(`${label} debe usar una versión semántica X.Y.Z.`);
  }
  return value.split('.').map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left, 'La versión adoptada');
  const b = parseVersion(right, 'La versión publicada');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function validateCatalog(catalog) {
  if (catalog?.schema_version !== 1 || typeof catalog.template_repository !== 'string' || !Array.isArray(catalog.capabilities)) {
    throw new Error('El catálogo no cumple el esquema de capacidades versión 1.');
  }
  const ids = new Set();
  for (const capability of catalog.capabilities) {
    if (!capability || typeof capability.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability.id)) {
      throw new Error('El catálogo contiene una capacidad sin identificador válido.');
    }
    if (ids.has(capability.id)) throw new Error(`El catálogo repite la capacidad ${capability.id}.`);
    ids.add(capability.id);
    parseVersion(capability.version, `La capacidad ${capability.id}`);
    if (typeof capability.title !== 'string' || !capability.title.trim()) {
      throw new Error(`La capacidad ${capability.id} no tiene título.`);
    }
  }
  return ids;
}

export function compareAdoption(catalog, adoption) {
  const ids = validateCatalog(catalog);
  if (adoption?.schema_version !== 1 || adoption.template_repository !== catalog.template_repository ||
      typeof adoption.product !== 'string' || !adoption.product.trim() ||
      !adoption.capabilities || typeof adoption.capabilities !== 'object' || Array.isArray(adoption.capabilities)) {
    throw new Error('El manifiesto de adopción no coincide con el esquema o repositorio del catálogo.');
  }

  for (const id of Object.keys(adoption.capabilities)) {
    if (!ids.has(id)) throw new Error(`El manifiesto refiere una capacidad ausente del catálogo: ${id}.`);
  }

  const pending = [];
  const current = [];
  const excluded = [];
  for (const capability of catalog.capabilities) {
    const entry = adoption.capabilities[capability.id];
    if (!entry) {
      pending.push({ id: capability.id, title: capability.title, adopted_version: null, current_version: capability.version, status: 'missing' });
      continue;
    }
    if (!STATUSES.has(entry.status)) throw new Error(`La capacidad ${capability.id} tiene un estado inválido.`);
    if ((entry.status === 'deferred' || entry.status === 'not-applicable') &&
        (typeof entry.reason !== 'string' || !entry.reason.trim())) {
      throw new Error(`La capacidad ${capability.id} requiere un motivo para el estado ${entry.status}.`);
    }
    if (entry.status === 'not-applicable') {
      excluded.push({ id: capability.id, status: entry.status, reason: entry.reason });
      continue;
    }
    if (entry.version !== undefined) {
      const order = compareVersions(entry.version, capability.version);
      if (order > 0) throw new Error(`La adopción de ${capability.id} es posterior a la versión publicada.`);
      if (order < 0 || entry.status === 'deferred') {
        pending.push({ id: capability.id, title: capability.title, adopted_version: entry.version, current_version: capability.version, status: entry.status });
        continue;
      }
    } else if (entry.status === 'deferred') {
      pending.push({ id: capability.id, title: capability.title, adopted_version: null, current_version: capability.version, status: entry.status });
      continue;
    } else if (entry.status === 'adopted') {
      throw new Error(`La capacidad ${capability.id} no tiene versión adoptada.`);
    }
    current.push({ id: capability.id, version: capability.version });
  }

  return {
    ok: pending.length === 0,
    product: adoption.product,
    template_repository: catalog.template_repository,
    pending,
    current,
    excluded,
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} no contiene JSON válido.`);
    throw new Error(`No se pudo leer ${label}.`);
  }
}

function argumentValue(args, key, fallback) {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}.`);
  return value;
}

async function main(args) {
  const root = process.cwd();
  const catalogPath = path.resolve(root, argumentValue(args, '--catalog', 'template-capabilities.json'));
  const adoptionPath = path.resolve(root, argumentValue(args, '--adoption', 'template-adoption.json'));
  const json = args.includes('--json');
  const check = args.includes('--check');
  const result = compareAdoption(await readJson(catalogPath, 'el catálogo'), await readJson(adoptionPath, 'el manifiesto'));
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`${result.product}: todas las capacidades están adoptadas (${result.current.length}); excluidas justificadas: ${result.excluded.length}.`);
  else {
    console.log(`${result.product}: ${result.pending.length} capacidad(es) por adoptar:`);
    for (const item of result.pending) console.log(`- ${item.id}: ${item.adopted_version ?? 'sin registrar'} → ${item.current_version}${item.status === 'deferred' ? ' (postergada)' : ''}`);
  }
  if (check && !result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Verificación de adopción: ${error.message}`);
    process.exitCode = 2;
  });
}
