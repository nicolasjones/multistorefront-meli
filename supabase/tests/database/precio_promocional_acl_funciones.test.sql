-- MSF-816 (hallazgo menor de la revisión retroactiva de #944/#957/#950): las funciones del precio promocional y de la guarda
-- de confirmación no son ejecutables por NINGÚN rol de la API (`public`, `anon`, `authenticated`, `service_role`): solo las
-- llaman las RPC `security definer` de ventas en nombre del dueño. `promocion_vigente_fila` y `precio_linea_venta` solo
-- revocaban `public/anon/authenticated`; la migración 20270431000100 agrega `service_role` y este test lo fija por catálogo.
-- Se revisa CADA sobrecarga por nombre (una firma vieja que quedara viva también cuenta) y el ACL exacto (solo el dueño).
begin;

select no_plan();

-- Las cuatro funciones existen (al menos una sobrecarga de cada una).
select is(
  (select count(distinct p.proname)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('promocion_vigente_fila', 'precio_linea_venta', 'precio_linea_venta_calculo', 'lineas_con_promocion_desactualizada')),
  4, 'existen las cuatro funciones del precio promocional');

-- Ningún rol de la API ejecuta ninguna sobrecarga.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || ' -> ' || r.rol, '; ' order by p.proname, r.rol), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol)
    where n.nspname = 'private'
      and p.proname in ('promocion_vigente_fila', 'precio_linea_venta', 'precio_linea_venta_calculo', 'lineas_con_promocion_desactualizada')
      and has_function_privilege(r.rol, p.oid, 'execute')),
  '', 'ni anon, ni authenticated, ni service_role ejecutan ninguna función del precio promocional');

-- Tampoco `public` (PUBLIC = grantee 0 en el ACL) ni ningún otro grantee: el ACL es solo el del dueño.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || ' -> ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), '; ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'private'
      and p.proname in ('promocion_vigente_fila', 'precio_linea_venta', 'precio_linea_venta_calculo', 'lineas_con_promocion_desactualizada')
      and a.grantee <> p.proowner),
  '', 'el ACL de las funciones del precio promocional es solo el del dueño (sin PUBLIC ni otros roles)');

-- Siguen siendo las que se esperan: la guarda y la lectura de la promoción son security definer con search_path vacío
-- (el revoke no las cambió); el envoltorio con compuerta de sesión sigue siendo security invoker.
select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text || '/' || (p.proconfig = array['search_path=""'])::text, '; ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('promocion_vigente_fila', 'precio_linea_venta', 'precio_linea_venta_calculo', 'lineas_con_promocion_desactualizada')),
  'lineas_con_promocion_desactualizada=true/true; precio_linea_venta=false/true; precio_linea_venta_calculo=true/true; promocion_vigente_fila=true/true',
  'las funciones conservan su modo (security definer/invoker) y el search_path vacío');

-- Una llamada directa de service_role y de authenticated falla con 42501 (sin execute), no con un error de la función.
select throws_ok(
  $$set local role service_role; select * from private.promocion_vigente_fila(gen_random_uuid(), gen_random_uuid(), now())$$,
  '42501', null, 'service_role no puede llamar promocion_vigente_fila');
reset role;
select throws_ok(
  $$set local role service_role; select * from private.precio_linea_venta(gen_random_uuid(), gen_random_uuid(), 'minorista', 1, 0, now(), true, null)$$,
  '42501', null, 'service_role no puede llamar precio_linea_venta');
reset role;

select * from finish();
rollback;
