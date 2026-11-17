import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const script = path.resolve('scripts/validar-migraciones-aditivas.mjs');

async function withMigrations(files, callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'migraciones-'));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('acepta una migración aditiva sin advertencia', async () => {
  await withMigrations({ '001.sql': 'create table demo (id uuid primary key);' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.code, 0);
  });
});

test('rechaza una migración destructiva sin camino de reversión documentado', async () => {
  await withMigrations({ '001.sql': 'alter table demo drop column obsoleta;' }, async (dir) => {
    const result = await run(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /001\.sql/);
  });
});

test('acepta una migración destructiva que documenta su Reversión', async () => {
  await withMigrations({ '001.sql': '-- Reversión: recrear la columna desde el backup previo\nalter table demo drop column obsoleta;' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.code, 0);
  });
});

test('no confunde un DROP dentro de un comentario (instrucción de reversión) con SQL ejecutable', async () => {
  await withMigrations({ '001.sql': '-- Reversión: en orden inverso a como se crea:\n--   drop table demo;\ncreate table demo (id uuid primary key);' }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.code, 0);
  });
});

test('no confunde ALTER TABLE ... DROP CONSTRAINT con una migración destructiva (regresión real, ver 20261003183000_esperando_aprobacion_ia.sql)', async () => {
  await withMigrations({ '001.sql': "alter table demo drop constraint demo_check; alter table demo add constraint demo_check check (true);" }, async (dir) => {
    const result = await run(dir);
    assert.equal(result.code, 0, result.stderr);
  });
});

test('rechaza DROP SCHEMA, DROP FUNCTION y DELETE FROM sin WHERE sin reversión', async () => {
  for (const sql of ['drop schema viejo cascade;', 'drop function public.f();', 'delete from demo;']) {
    await withMigrations({ '001.sql': sql }, async (dir) => {
      assert.notEqual((await run(dir)).code, 0, sql);
    });
  }
});

test('acepta DELETE FROM con WHERE y DROP FUNCTION con reversión comentada', async () => {
  await withMigrations({
    '001.sql': "delete from demo where id = 1;\ndelete from demo\n where creado < now();",
    '002.sql': '-- Reversión: recrear public.f() con la migración 001.\ndrop function public.f();',
  }, async (dir) => {
    assert.equal((await run(dir)).code, 0);
  });
});

test('la palabra reversión fuera de un comentario no cuenta como camino de reversión', async () => {
  await withMigrations({ '001.sql': "drop table demo;\ninsert into notas values ('reversible');" }, async (dir) => {
    assert.notEqual((await run(dir)).code, 0);
  });
});

test('un -- dentro de un literal no anula el resto de la línea', async () => {
  await withMigrations({ '001.sql': "select '--'; drop table x;" }, async (dir) => {
    assert.notEqual((await run(dir)).code, 0);
  });
});

test('un comentario negado («sin reversión») no cuenta como camino de reversión', async () => {
  await withMigrations({ '001.sql': '-- sin reversión\ndrop table x;' }, async (dir) => {
    assert.notEqual((await run(dir)).code, 0);
  });
  await withMigrations({ '001.sql': '/* Camino de reversión: recrear x */\ndrop table x;' }, async (dir) => {
    assert.equal((await run(dir)).code, 0);
  });
});

test('dollar-quoting, E\'…\\\'…\' y comentarios de bloque anidados', async () => {
  const malas = [
    "select $$it's$$; drop table t;",
    "select $tag$ -- no es comentario $tag$; drop table t;",
    "select E'it\\'s'; drop table t;",
    "do $$ begin drop table t; end $$;",
    "/* a /* b */ c */ drop table t;",
  ];
  for (const sql of malas) {
    await withMigrations({ '001.sql': sql }, async (dir) => {
      assert.notEqual((await run(dir)).code, 0, sql);
    });
  }
  const buenas = [
    '/* a /* drop table t; */ drop table t; */ select 1;',
    '-- drop table t;\nselect 1;',
  ];
  for (const sql of buenas) {
    await withMigrations({ '001.sql': sql }, async (dir) => {
      assert.equal((await run(dir)).code, 0, sql);
    });
  }
});

test('rechaza Reversión vacía, ninguna, n/a y no aplica; acepta pasos en la línea siguiente', async () => {
  for (const marcador of ['-- Reversión: ninguna', '-- Reversion: n/a', '-- Reversión: no aplica.', '-- Reversión:\nselect 1;', '-- Reversión: no hay reversión automática']) {
    await withMigrations({ '001.sql': `${marcador}\ndrop table t;` }, async (dir) => {
      assert.notEqual((await run(dir)).code, 0, marcador);
    });
  }
  await withMigrations({ '001.sql': '-- Reversión:\n--   create table t (id int);\ndrop table t;' }, async (dir) => {
    assert.equal((await run(dir)).code, 0);
  });
});

test('tag de dollar-quote Unicode y marcadores en inglés', async () => {
  await withMigrations({ '001.sql': '$é$ -- $é$; drop table t;' }, async (dir) => {
    assert.notEqual((await run(dir)).code, 0);
  });
  for (const marcador of ['-- Reversion: none', '-- Reversion: n.a.', '-- Reversion: na', '-- Reversion: nothing']) {
    await withMigrations({ '001.sql': `${marcador}\ndrop table t;` }, async (dir) => {
      assert.notEqual((await run(dir)).code, 0, marcador);
    });
  }
});

test('rendimiento: 1 MB de tags únicos sin cierre se analiza en menos de 2 s', async () => {
  const sql = Array.from({ length: 105000 }, (_, k) => `$t${k}$ `).join('') + '\n-- Reversión: x\nselect 1;';
  await withMigrations({ '001.sql': sql }, async (dir) => {
    const t = Date.now();
    const r = await run(dir);
    assert.equal(r.code, 0);
    assert.ok(Date.now() - t < 2000, `tardó ${Date.now() - t} ms`);
  });
});
