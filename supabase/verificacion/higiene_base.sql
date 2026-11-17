-- Diagnóstico de higiene de la base (lote 33: MSF-918/922/923/899/917/658/671/920/921). SOLO LECTURA.
-- Uso: node scripts/verificar-higiene-base.mjs --docker <contenedor> | DATABASE_URL=... ; o psql -f este archivo.
-- Cada fila: (control, cantidad, detalle). Esperado en una base alineada con el código: todas las cantidades en 0
-- salvo `vistas_definer_permitidas` (1: public.proveedores_basico) y `definer_sp_heredadas` (3, plan en docs/higiene-base-datos.md).
set default_transaction_read_only = on;

with
fk_sin_indice as (
  select k.conrelid::regclass::text || '.' || k.conname as d
    from pg_constraint k join pg_class c on c.oid = k.conrelid
   where k.contype = 'f' and k.connamespace::regnamespace::text in ('public', 'dominio')
     and c.relkind in ('r', 'p') and not c.relispartition
     and not (k.confrelid = 'auth.users'::regclass and k.confdeltype = 'n')
     and k.confrelid::regclass::text not in ('sistemas_externos', 'ia_perfiles_modelo', 'capacidades_proveedores', 'roles_organizacion',
                                            'dominio.alicuotas_iva', 'dominio.estados_reparacion', 'dominio.motivos_movimiento')
     and not exists (select 1 from pg_index i
                      where i.indrelid = k.conrelid and i.indisvalid and i.indpred is null
                        and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:array_length(k.conkey, 1) - 1]) x)
                          = (select array_agg(x order by x) from unnest(k.conkey) x))
),
rls_sin_politica as (
  select n.nspname || '.' || c.relname as d from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname in ('public', 'dominio', 'private')
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
),
sin_pk as (
  select n.nspname || '.' || c.relname as d from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and not c.relispartition and n.nspname in ('public', 'dominio')
     and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p')
),
fk_no_validas as (
  select conrelid::regclass::text || '.' || conname as d from pg_constraint
   where contype = 'f' and not convalidated and connamespace::regnamespace::text in ('public', 'dominio', 'private')
),
vistas_definer as (
  select n.nspname || '.' || c.relname as d from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname in ('public', 'dominio', 'publico')
     and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
),
definer_sp as (
  select p.oid::regprocedure::text as d, coalesce(array_to_string(p.proconfig, ','), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname in ('public', 'private', 'dominio', 'publico')
     and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c = 'search_path=""')
),
anon_publico as (
  select p.oid::regprocedure::text as d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'publico') and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute') and has_schema_privilege('anon', n.nspname, 'usage')
)
select 'fk_sin_indice' as control, count(*) as cantidad, left(coalesce(string_agg(d, ', '), ''), 300) as detalle from fk_sin_indice
union all select 'rls_sin_politica', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from rls_sin_politica
union all select 'tablas_sin_pk', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from sin_pk
union all select 'fk_no_validas', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from fk_no_validas
union all select 'vistas_definer_permitidas', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from vistas_definer
union all select 'definer_sp_heredadas', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from definer_sp
union all select 'anon_ejecuta_public_publico', count(*), left(coalesce(string_agg(d, ', '), ''), 300) from anon_publico
union all select 'migraciones_registradas', count(*), '' from supabase_migrations.schema_migrations
union all select 'migraciones_sin_statements', count(*), 'esperado: el cron migrar-supabase-vps.sh inserta statements = {} por diseño' from supabase_migrations.schema_migrations where statements is null or cardinality(statements) = 0
union all select 'migraciones_nombre_vacio', count(*), left(coalesce(string_agg(version, ', '), ''), 300) from supabase_migrations.schema_migrations where name is null or btrim(name) = '';
