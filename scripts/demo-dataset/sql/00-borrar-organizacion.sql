-- Borra una organización demo con TODOS sus datos y los usuarios de Auth asociados (paso SQL del reset).
-- Por qué SQL y no `DELETE` por la API: varias FK de `dominio` son ON DELETE RESTRICT (p. ej. las líneas de ingresos
-- de mercadería hacia productos y movimientos), así que borrar la organización en cascada falla según el orden en que
-- Postgres recorra las tablas; además los movimientos de stock son inmutables. Con `session_replication_role = replica`
-- se desactivan FK y triggers, y se borran las filas de cada tabla con `organizacion_id`. Idempotente.
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/00-borrar-organizacion.sql
-- Solo para bases demo: nunca apuntar a una organización real.
\set ON_ERROR_STOP on
select coalesce((select id::text from public.organizaciones where nombre = :'org'), '') as org_id \gset
select set_config('demo.org', :'org_id', false);
begin;
set local session_replication_role = replica;
do $$
declare
  v_org uuid := nullif(current_setting('demo.org'), '')::uuid;  -- nulo si la organización no existe: solo se limpian huérfanos
  t record;
  g record;
  f record;
  i integer;
  v_n integer;
  v_borrados integer;
  v_cambiados text[] := '{}';
begin
  -- Algunos triggers (p. ej. los de inmutabilidad) están en modo ALWAYS/REPLICA y disparan aunque la replicación esté
  -- desactivada: se apagan de a uno y se restauran al final en su modo exacto, todo dentro de la misma transacción.
  for g in
    select c.oid::regclass as tabla, tg.tgname as nombre, tg.tgenabled as modo
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where not tg.tgisinternal and tg.tgenabled in ('A', 'R') and n.nspname in ('public', 'dominio', 'publico', 'private')
  loop
    execute format('alter table %s disable trigger %I', g.tabla, g.nombre);
    v_cambiados := v_cambiados || format('%s|%s|%s', g.tabla, g.nombre, g.modo);
  end loop;

  for t in
    select c.table_schema as esquema, c.table_name as tabla
      from information_schema.columns c
      join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.column_name = 'organizacion_id' and c.table_schema in ('public', 'dominio', 'publico', 'private')
     order by 1, 2
  loop
    execute format('delete from %I.%I where organizacion_id = $1', t.esquema, t.tabla) using v_org;
  end loop;
  delete from public.organizaciones where id = v_org;

  -- Con la replicación desactivada las FK no cascadean: las tablas hijas que no tienen `organizacion_id` (p. ej.
  -- identificadores externos de clientes, hijos de reparaciones) quedarían huérfanas y, por ejemplo, un identificador
  -- externo huérfano (único a nivel de toda la instancia) bloquearía la próxima siembra. Se borran las filas cuyo padre
  -- ya no existe, en pasadas sucesivas porque borrar un huérfano puede dejar huérfanos a sus propios hijos.
  for i in 1..8 loop
    v_borrados := 0;
    for f in
      select c.conrelid::regclass as hijo, c.confrelid::regclass as padre,
             (select string_agg(format('h.%I = p.%I', ha.attname, pa.attname), ' and ')
                from unnest(c.conkey, c.confkey) as k(hk, pk)
                join pg_attribute ha on ha.attrelid = c.conrelid and ha.attnum = k.hk
                join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.pk) as unir,
             (select string_agg(format('h.%I is not null', ha.attname), ' and ')
                from unnest(c.conkey) as k(hk)
                join pg_attribute ha on ha.attrelid = c.conrelid and ha.attnum = k.hk) as no_nulas
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        join pg_class pc on pc.oid = c.confrelid
        join pg_namespace pn on pn.oid = pc.relnamespace
       where c.contype = 'f' and n.nspname in ('public', 'dominio') and pn.nspname in ('public', 'dominio')
    loop
      execute format('delete from %s h where %s and not exists (select 1 from %s p where %s)', f.hijo, f.no_nulas, f.padre, f.unir);
      get diagnostics v_n = row_count;
      v_borrados := v_borrados + v_n;
    end loop;
    exit when v_borrados = 0;
  end loop;

  for g in select split_part(x, '|', 1) as tabla, split_part(x, '|', 2) as nombre, split_part(x, '|', 3) as modo from unnest(v_cambiados) x loop
    execute format('alter table %s enable %s trigger %I', g.tabla, case g.modo when 'A' then 'always' else 'replica' end, g.nombre);
  end loop;
end $$;
commit;
-- Usuarios de Auth del dataset: staff (<clave><sufijo>@demo.msf.test) y cuentas web de clientes (@mail<sufijo>.demo).
delete from auth.users
 where email in (select c || :'sufijo' || '@demo.msf.test'
                   from unnest(array['admin','operador','mostrador','deposito','administracion','tecnico','consulta']) c)
    or email like '%@mail' || :'sufijo' || '.demo';
select 'borrada: ' || :'org' as resultado;
