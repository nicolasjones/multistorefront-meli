-- MSF-170 (revisión independiente, hallazgo 6): guardia de CI. Ninguna función, vista, vista materializada ni política
-- referencia `public.superadmin_organizacion_activa` fuera de la vista `private.superadmin_contexto_vigente`
-- (que filtra los accesos vencidos, FR-015). Las únicas funciones que pueden leer la tabla cruda son las que
-- necesitan ver también los vencidos para asentarlos: entrar/salir de la organización y el cierre automático.
-- Si este test falla: una función nueva (o reescrita) lee la tabla directamente; hacela leer la vista.
begin;

select plan(5);

select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
      and p.prokind in ('f', 'p')
      and p.prosrc ~ 'superadmin_organizacion_activa'
      -- private.exclusiones_exportacion_total() solo nombra la tabla como texto (no la lee); se fija por oid, no por nombre.
      and p.proname not in ('entrar_a_organizacion', 'salir_de_organizacion', 'cerrar_accesos_soporte_vencidos')
      and p.oid <> 'private.exclusiones_exportacion_total()'::regprocedure),
  null::text[], 'ninguna función (en cualquier esquema) lee la tabla cruda fuera de entrar/salir/cierre');

select is(
  (select array_agg(c.oid::regclass::text order by c.oid::regclass::text)
     from pg_depend d
     join pg_rewrite rw on rw.oid = d.objid and d.classid = 'pg_rewrite'::regclass
     join pg_class c on c.oid = rw.ev_class
    where d.refobjid = 'public.superadmin_organizacion_activa'::regclass
      and c.oid <> 'public.superadmin_organizacion_activa'::regclass
      and c.oid <> 'private.superadmin_contexto_vigente'::regclass),
  null::text[], 'ninguna otra vista ni vista materializada depende de la tabla cruda');

select is(
  (select array_agg(pol.polname::text order by pol.polname)
     from pg_depend d
     join pg_policy pol on pol.oid = d.objid and d.classid = 'pg_policy'::regclass
    where d.refobjid = 'public.superadmin_organizacion_activa'::regclass
      and pol.polrelid <> 'public.superadmin_organizacion_activa'::regclass),
  null::text[], 'ninguna política de otra tabla depende de la tabla cruda');

select is(
  (select array_agg(pp.schemaname || '.' || pp.tablename || ':' || pp.policyname order by pp.schemaname, pp.tablename, pp.policyname)
     from pg_policies pp
    where pp.tablename <> 'superadmin_organizacion_activa'
      and (coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')) ~ 'superadmin_organizacion_activa'),
  null::text[], 'ningún texto de política de otra tabla menciona la tabla cruda');

select ok(
  (select pg_get_viewdef('private.superadmin_contexto_vigente'::regclass) ~ 'superadmin_organizacion_activa'),
  'la vista vigente es la única que lee la tabla (y la lee filtrando vence_en)');

select * from finish();
rollback;
