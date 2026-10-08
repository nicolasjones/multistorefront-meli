import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? path.join('scripts', 'fixtures', 'worker-rollback', 'audit.jsonl');
const required = ['ejecucion_id', 'digest', 'worker', 'flow', 'organizacion_id', 'intento', 'estado', 'codigo_salida'];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
if (!lines.length) throw new Error(`No hay eventos de auditoria en ${file}`);
for (const [index, line] of lines.entries()) {
  const event = JSON.parse(line);
  for (const field of required) {
    if (event[field] === undefined || event[field] === '') throw new Error(`Evento ${index + 1} sin ${field}`);
  }
}
console.log(JSON.stringify({ file, events: lines.length, passed: true }));
