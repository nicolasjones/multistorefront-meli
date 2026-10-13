-- MSF-150 · F-ACC-01: anon solo ejecuta las RPC de acceso.
-- 20261012140200 concedió USAGE sobre public a anon para que alcance
-- bloqueo_acceso_hasta y registrar_fallo_acceso. Con USAGE, anon también
-- alcanza cualquier función de public que conserve EXECUTE por defecto
-- (PUBLIC). Esta migración quita EXECUTE a PUBLIC y anon sobre todas las
-- funciones de public (salvo las de extensiones y las 3 RPC de acceso) y
-- preserva el acceso efectivo que tenían los demás roles: se les concede
-- explícitamente lo que hasta ahora recibían vía PUBLIC.
--
-- Aditiva: solo revoca permisos. Reversión: grant execute on function
-- <función> to public; para cada función afectada.

do $$
declare
  f record;
  v_rol text;
  v_roles text[];
begin
  for f in
    select p.oid, p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.proname not in ('bloqueo_acceso_hasta', 'registrar_fallo_acceso', 'limpiar_intentos_acceso')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    v_roles := array(
      select quote_ident(rolname) from pg_roles
      where rolname <> 'anon' and rolname !~ '^pg_' and not rolsuper
        and has_function_privilege(oid, f.oid, 'EXECUTE')
    );
    execute format('revoke execute on function %s from public, anon', f.firma);
    foreach v_rol in array v_roles loop
      execute format('grant execute on function %s to %s', f.firma, v_rol);
    end loop;
  end loop;
end
$$;
