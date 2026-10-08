-- Smoke test de capacidades habilitadas por migracion, sin depender de
-- ninguna tabla de negocio (todavia no existen). Cuando exista "organizaciones",
-- el test de aislamiento RLS real se agrega en este mismo directorio.
begin;

select plan(2);

select has_extension('vector', 'pgvector debe estar habilitada (ver migracion enable_pgvector)');
select has_extension('pgtap', 'pgtap debe estar habilitada (ver migracion enable_pgtap)');

select * from finish();

rollback;
