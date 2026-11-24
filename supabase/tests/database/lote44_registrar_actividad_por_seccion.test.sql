-- Lote 44: `registrar_actividad` acepta la misma condición que la RLS de `empresas_update` (puede_escribir O sección empresas en
-- edición). Antes un rol personalizado con Empresas en edición pausaba la tienda pero su evento de Actividad se rechazaba (42501)
-- y el historial quedaba sin rastro. Sigue rechazando: roles sin la sección, tipos fuera de la lista, empresa ajena, anon.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'administracion@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e2000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Tienda D');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'administracion');
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'administracion' and seccion = 'empresas';

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Rol personalizado con Empresas en edición (no administrador): puede pausar (RLS) y ahora también deja el evento.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
with u as (update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-00000000000a' returning 1)
select is((select count(*)::int from u), 1, 'el rol con Empresas en edición pausa la tienda (RLS)');
select lives_ok($$select public.registrar_actividad('empresa.pausada', 'Se pausó la tienda', 'e1000000-0000-0000-0000-00000000000a')$$,
  'y registra el evento de Actividad');
select throws_ok($$select public.registrar_actividad('usuario.rol_cambiado', 'Falsificado', 'e1000000-0000-0000-0000-00000000000a')$$, '42501', null,
  'pero no puede registrar un tipo fuera de la lista cerrada');
select throws_ok($$select public.registrar_actividad('empresa.pausada', 'Ajena', 'e2000000-0000-0000-0000-00000000000d')$$, '22023', null,
  'ni el evento de una empresa de otra organización');

-- Operador (sin Empresas en edición): ni edita ni registra.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.registrar_actividad('empresa.pausada', 'Falsificado', 'e1000000-0000-0000-0000-00000000000a')$$, '42501', null,
  'un rol sin la sección Empresas en edición no registra');

-- Administrador: sigue registrando.
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select lives_ok($$select public.registrar_actividad('empresa.reactivada', 'Se reactivó la tienda', 'e1000000-0000-0000-0000-00000000000a')$$,
  'el administrador sigue registrando');

reset role;
select is((select count(*)::int from public.registro_actividad where tipo in ('empresa.pausada', 'empresa.reactivada')), 2, 'quedaron los dos eventos legítimos');
select is(has_function_privilege('anon', 'public.registrar_actividad(text, text, uuid)', 'execute'), false, 'anon sigue sin ejecutarla');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.registrar_actividad(text, text, uuid)'::regprocedure), true,
  'security definer con search_path vacío');

select * from finish();
rollback;
