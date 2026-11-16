-- Spec 022 (T007): bucket `evidencias-e2e` privado, lectura autenticada,
-- sin escritura para roles de navegador.
begin;

select plan(3);

select ok(
  (select public from storage.buckets where id = 'evidencias-e2e') is false,
  'el bucket evidencias-e2e existe y es privado'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'evidencias_e2e_select_authenticated'
      and cmd = 'SELECT' and 'authenticated' = any (roles)
  ),
  'existe la policy de lectura acotada al rol authenticated'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'evidencias_e2e\_%'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'ninguna policy de escritura para roles de navegador'
);

select * from finish();

rollback;
