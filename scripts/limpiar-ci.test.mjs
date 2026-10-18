import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contenedoresCi, locksVencidos } from './limpiar-ci.mjs';

describe('locksVencidos (janitor)', () => {
  it('sólo marca los más viejos que el TTL', () => {
    const ahora = 1_000_000;
    const entradas = [
      { nombre: 'ci-0', mtimeMs: ahora - 10_000 }, // 10 s: vivo
      { nombre: 'ci-1', mtimeMs: ahora - 120_000 }, // 2 min: vencido con TTL de 1 min
    ];
    assert.deepEqual(locksVencidos({ entradas, ahora, ttlMs: 60_000 }), ['ci-1']);
  });
});

describe('contenedoresCi (janitor)', () => {
  it('sólo toma stacks del CI DETENIDOS, nunca dev/stg/prd ni uno en uso', () => {
    const lineas = [
      'supabase_db_ci-multistorefront-meli|Up 2 minutes',
      'supabase_db_ci-r1-multistorefront-meli|Exited (0) 1 hour ago',
      'supabase_db_multistorefront-meli-supabase-dev|Up 5 hours',
      'supabase_db_multistorefront-meli-supabase-prd|Up 5 hours',
      'multistorefront-meli-kestra-dev-kestra-1|Up 5 hours',
    ];
    assert.deepEqual(contenedoresCi({ lineas }), ['supabase_db_ci-r1-multistorefront-meli']);
  });
});
