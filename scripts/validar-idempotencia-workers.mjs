import assert from 'node:assert/strict';

const runs = new Map();
function record(executionId, result) {
  const previous = runs.get(executionId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(result)) {
    throw new Error(`EJECUCION_ID ${executionId} produjo resultados distintos`);
  }
  runs.set(executionId, result);
  return previous ? { duplicate: true, result: previous } : { duplicate: false, result };
}

const executionId = process.env.EJECUCION_ID ?? 'fixture-idempotente-001';
const result = { rows: 2, status: 'ok', executionId };
const first = record(executionId, result);
const second = record(executionId, result);
assert.equal(first.duplicate, false);
assert.equal(second.duplicate, true);
console.log(JSON.stringify({ executionId, first, second, passed: true }));
