-- Spec 022 (T007): bucket `evidencias-e2e` privado, lectura autenticada,
-- sin escritura para roles de navegador.
begin;

select plan(4);

select is(
  (select public from storage.buckets where id = 'evidencias-e2e'),
  false,
  'el bucket evidencias-e2e existe y es privado'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evidencias_e2e_select_authenticated') = 1,
  'existe la policy de lectura autenticada'
);

select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'evidencias_e2e\_%\_%' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'ninguna policy de escritura para roles de navegador'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evidencias_e2e_select_authenticated' and roles = '{authenticated}') = 1,
  'la lectura queda acotada al rol authenticated'
);

select * from finish();

rollback;
