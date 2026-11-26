-- Lote 89 (MSF-728): private.exigir_indice_valido rechaza un índice INVALID real, el que deja un `create unique index concurrently`
-- fallido. SIN transacción a propósito (esa sentencia no corre dentro de una) y sin superusuario: la tabla scratch y el índice los crea
-- el propio rol de la prueba y se borran al final. Datos inventados.
select plan(5);

\set ON_ERROR_STOP 0
drop table if exists public.lote89b_scratch;
\set ON_ERROR_STOP 1

create table public.lote89b_scratch (a int, b int);
insert into public.lote89b_scratch (a, b) values (1, 1), (1, 2);

create unique index lote89b_scratch_b_uidx on public.lote89b_scratch (b);

-- Falla de verdad por el valor repetido en `a` y deja el índice con indisvalid = false. Se tolera el error de esta sentencia.
\set ON_ERROR_STOP 0
create unique index concurrently lote89b_scratch_a_uidx on public.lote89b_scratch (a);
\set ON_ERROR_STOP 1

select is((select indisvalid from pg_index where indexrelid = 'public.lote89b_scratch_a_uidx'::regclass), false, 'la creación concurrente fallida dejó el índice INVALID');
select throws_ok($$select private.exigir_indice_valido('public.lote89b_scratch_a_uidx'::regclass)$$, '55000',
  'El índice public.lote89b_scratch_a_uidx existe pero no es válido (una creación concurrente falló): ejecutá drop index concurrently public.lote89b_scratch_a_uidx; y repetí la migración',
  'un índice INVALID es rechazado con la instrucción');
select lives_ok($$select private.exigir_indice_valido('public.lote89b_scratch_b_uidx'::regclass)$$, 'un índice válido pasa');
select lives_ok($$select private.exigir_indice_fragmentos_valido()$$, 'el índice único real de fragmentos es válido');
select is(has_function_privilege('authenticated', 'private.exigir_indice_valido(regclass)', 'execute'), false, 'authenticated no ejecuta la comprobación');

select * from finish();

drop index concurrently if exists public.lote89b_scratch_a_uidx;
drop table if exists public.lote89b_scratch;
