import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  contarZombis,
  contenedoresCi,
  esNavegador,
  excedeUmbral,
  locksVencidos,
  navegadoresHuerfanos,
  nombresDeContenedores,
  parsearProcesos,
} from './limpiar-ci.mjs';

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

describe('parsearProcesos (janitor)', () => {
  it('lee pid, ppid, edad, estado y cmdline y descarta basura', () => {
    const salida = [
      '123|1|1200|R|/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome --headless',
      '124|1|10|S|/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome --headless',
      '125|1|600|Z|[chrome] <defunct>',
      'basura',
      '',
    ].join('\n');
    const procesos = parsearProcesos({ salida });
    assert.equal(procesos.length, 3);
    assert.deepEqual(procesos[0], { pid: 123, ppid: 1, edad: 1200, estado: 'R', cmd: '/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome --headless' });
    assert.equal(procesos[2].estado, 'Z');
  });
});

describe('esNavegador (janitor)', () => {
  it('reconoce los binarios de Playwright/Chromium y no los comandos de pnpm', () => {
    assert.equal(esNavegador('/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome --headless=new'), true);
    assert.equal(esNavegador('/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell'), true);
    assert.equal(esNavegador('chrome-headless'), true);
    assert.equal(esNavegador('node /home/runner/_work/repo/node_modules/.bin/playwright test'), false);
    assert.equal(esNavegador('node scripts/limpiar-ci.mjs --aplicar'), false);
    assert.equal(esNavegador('pnpm test:e2e -- acceso-publico.e2e.ts'), false);
  });
});

describe('navegadoresHuerfanos (janitor)', () => {
  it('sólo devuelve navegadores vivos más viejos que el TTL', () => {
    const procesos = [
      { pid: 10, ppid: 1, edad: 3600, estado: 'S', cmd: '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome' },
      { pid: 11, ppid: 1, edad: 60, estado: 'S', cmd: '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome' }, // job en curso
      { pid: 12, ppid: 1, edad: 3600, estado: 'Z', cmd: '[chrome] <defunct>' }, // zombie: no se mata
      { pid: 13, ppid: 1, edad: 3600, estado: 'S', cmd: 'node scripts/limpiar-ci.mjs' },
    ];
    assert.deepEqual(navegadoresHuerfanos({ procesos, ttlS: 1800 }).map((proceso) => proceso.pid), [10]);
  });

  it('con el TTL por defecto no toca un job de 30 minutos', () => {
    const procesos = [{ pid: 10, ppid: 1, edad: 29 * 60, estado: 'S', cmd: '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome' }];
    assert.deepEqual(navegadoresHuerfanos({ procesos }), []);
  });
});

describe('evidencia y umbrales (janitor)', () => {
  it('cuenta zombies sin confundirlos con vivos', () => {
    const procesos = [
      { pid: 1, ppid: 0, edad: 999, estado: 'S', cmd: 'node /entrypoint.mjs' },
      { pid: 2, ppid: 1, edad: 10, estado: 'Z', cmd: '' },
      { pid: 3, ppid: 1, edad: 20, estado: 'Z', cmd: '' },
    ];
    assert.equal(contarZombis(procesos), 2);
  });

  it('excedeUmbral informa navegadores y zombies por separado', () => {
    assert.deepEqual(excedeUmbral({ navegadores: 6, zombis: 0 }), { navegadores: true, zombis: false });
    assert.deepEqual(excedeUmbral({ navegadores: 5, zombis: 21 }), { navegadores: false, zombis: true });
    assert.deepEqual(excedeUmbral({ navegadores: 0, zombis: 0 }), { navegadores: false, zombis: false });
  });

  it('nombresDeContenedores quita vacíos y duplicados', () => {
    assert.deepEqual(nombresDeContenedores({ salida: 'runner-1\nrunner-2\nrunner-1\n\n' }), ['runner-1', 'runner-2']);
  });
});
