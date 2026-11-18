-- Controles del registro de migraciones (MSF-658/671). SOLO LECTURA. Lo corre `scripts/verificar-higiene-base.mjs` únicamente si
-- existe `supabase_migrations.schema_migrations` (una base descartable sin el CLI de Supabase no la tiene).
set default_transaction_read_only = on;

select 'migraciones_registradas' as control, count(*) as cantidad, '' as detalle from supabase_migrations.schema_migrations
union all select 'migraciones_sin_statements', count(*), 'esperado: el cron migrar-supabase-vps.sh inserta statements = {} por diseño' from supabase_migrations.schema_migrations where statements is null or cardinality(statements) = 0
union all select 'migraciones_nombre_vacio', count(*), left(coalesce(string_agg(version, ', '), ''), 300) from supabase_migrations.schema_migrations where name is null or btrim(name) = '';
