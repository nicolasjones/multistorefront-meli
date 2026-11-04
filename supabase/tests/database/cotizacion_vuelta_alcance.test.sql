-- F-PRE-06 (MSF-419) · devolución del Revisor (PR #687): vuelta a alcance «empresa» y aislamiento entre organizaciones.
--  · el historial viejo de una empresa no pisa el valor inicial que recibe al volver a «empresa»;
--  · `private.cotizacion_config` y `private.empresa_de_cotizacion` no revelan nada de otra organización.
begin;

select plan(7);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Tres');
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1500);
-- Configuración ajena con valores distintos a los del lanzamiento.
insert into dominio.cotizacion_configuracion (organizacion_id, alcance, redondeo_pesos) values
  ('22222222-2222-2222-2222-222222222222', 'empresa', 50);
-- Historial viejo de la empresa (de una época con alcance «empresa»): 1000, hace 30 días.
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, cargada_por, cargada_por_nombre, cargada_en, recalculo_aplicado, precios_recalculados)
values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 1000,
        'd1000000-0000-0000-0000-000000000001', 'Administrador', now() - interval '30 days', true, 0);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Org 1 vuelve a «empresa» con el dólar general en 1500: la empresa arranca en 1500, no en su 1000 viejo.
select lives_ok($$select public.cambiar_alcance_cotizacion('empresa', true)$$, 'volver a alcance empresa');
reset role;
select is(private.cotizacion_vigente_para('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001'),
  1500::numeric, 'la vigente de la empresa es el valor inicial, no su historial viejo');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((public.estado_cotizacion('e1000000-0000-0000-0000-000000000001') -> 'vigente' ->> 'valor')::numeric,
  1500::numeric, 'el estado muestra 1500 como vigente');

-- Cargar 1505 (+0,33 %) es menor al umbral: la anterior que se informa es 1500, no 1000.
select lives_ok($$select public.cargar_cotizacion(1505, 'e1000000-0000-0000-0000-000000000001')$$, 'cargar 1505');
select is((public.previsualizar_cotizacion('e1000000-0000-0000-0000-000000000001') ->> 'anterior')::numeric,
  1500::numeric, 'la vista previa mide contra 1500');

-- Aislamiento: una sesión de la organización 1 no ve la configuración ni las empresas de la 2.
select is((select k.redondeo_pesos from private.cotizacion_config('22222222-2222-2222-2222-222222222222') k),
  10, 'cotizacion_config de otra organización devuelve los valores del lanzamiento');
select throws_ok(
  $$select private.empresa_de_cotizacion('22222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-000000000001')$$,
  '42501', 'Organización no válida', 'empresa_de_cotizacion no opera sobre otra organización');

select * from finish();
rollback;
