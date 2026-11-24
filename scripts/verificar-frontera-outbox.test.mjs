import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { violaFrontera } from './verificar-frontera-outbox.mjs';

const viola = (sql) => assert.equal(violaFrontera(sql), true, sql);
const pasa = (sql) => assert.equal(violaFrontera(sql), false, sql);

test('rechaza una llamada HTTP saliente desde SQL, en cualquier capitalización', () => {
  viola("select net.http_post(url := 'https://x.test');");
  viola('PERFORM HTTP_GET($1);');
  viola('create extension pg_net;');
  viola("select enviar('x');\nselect 'webhook';");
});

test('el falso positivo original: «webhook» dentro de comment on ... is no cuenta', () => {
  pasa("comment on function public.f(text) is 'valida el destino de un webhook';");
  pasa("COMMENT ON TABLE public.t IS 'it''s un webhook; sin envío';");
  pasa('-- usa un webhook\nselect 1;');
  pasa("select 1; comment on table t is 'webhook'; select 2;");
});

test('un comentario de SQL no esconde una llamada que va después, en la misma línea o en otra', () => {
  viola("comment on table public.t is 'ok';\nselect net.http_get('x');");
  viola("comment on table t is 'ok'; select net.http_get('x');");
  viola("comment on table t is 'a\nb';\nselect net.http_get('x');");
  viola("comment on table t is 'a' || net.http_post('x');");
});

test('caso a: un comentario de bloque que abre un literal falso no oculta la llamada', () => {
  viola("/* comment on x is ' */ select net.http_post(x); -- '\n;");
});

test('caso b: `--` a mitad de línea no abre un comment on', () => {
  viola("select 1; -- comment on x is '\nselect net.http_post(x); -- '\n;");
});

test('caso c: un literal que contiene «comment on t is» no es una sentencia comment on', () => {
  viola("select 'comment on t is '; select net.http_get(1); select ';'");
});

test('SQL dinámico: execute, do $$ y concatenación se evalúan', () => {
  viola("execute 'select net.http_post(1)';");
  viola("do $$ begin perform net.http_post(1); end $$;");
  viola("do $f$ begin perform http_get(1); end $f$;");
  viola("select 'net.' || 'http_post' || net.http_post(1);");
  viola('select net.http_post(1);');
});

test('comentarios de bloque anidados se descartan por completo y no ocultan lo que sigue', () => {
  pasa('/* a /* net.http_post(1) */ b */ select 1;');
  viola('/* a /* b */ c */ select net.http_post(1);');
});

test('ante literal o comentario sin cerrar falla cerrado', () => {
  viola("select 'abierto;");
  viola('/* sin cerrar select 1;');
  viola('select $$ sin cerrar;');
});

test('las migraciones reales del repo siguen dando válido', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const malas = readdirSync(dir).filter((f) => f.endsWith('.sql') && violaFrontera(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(malas, []);
});

test('el recorrido es lineal: muchos literales, comentarios y dollar-quotes terminan en tiempo acotado', () => {
  const casos = {
    literales: "'' ".repeat(100_000),
    lineas: '-- c\n'.repeat(100_000),
    bloques: '/* c */ '.repeat(100_000),
    dollar: '$$ x $$ '.repeat(100_000),
    sentencias: 'select 1; '.repeat(100_000),
  };
  for (const [nombre, sql] of Object.entries(casos)) {
    const t0 = performance.now();
    assert.equal(violaFrontera(sql), false, nombre);
    assert.ok(performance.now() - t0 < 3000, `${nombre} tardó demasiado (cuadrático)`);
  }
});

test('sin estado oculto: la misma entrada da el mismo resultado, sola o alternada con otras', () => {
  const entradas = [
    "comment on table t is 'webhook';",
    'select net.http_post(1);',
    "select 'a'; -- x",
    "select 'abierto;",
    '/* a */ select http_get(1);',
  ];
  const base = entradas.map((e) => violaFrontera(e));
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    assert.deepEqual(entradas.map((e) => violaFrontera(e)), base);
    assert.deepEqual([...entradas].reverse().map((e) => violaFrontera(e)).reverse(), base);
  }
});

test('el resultado por migración no depende del orden en que se lean los archivos', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const evaluar = (lista) => Object.fromEntries(lista.map((f) => [f, violaFrontera(readFileSync(new URL(f, dir), 'utf8'))]));
  const normal = evaluar(archivos);
  const invertido = evaluar([...archivos].reverse());
  assert.deepEqual(invertido, normal);
});
