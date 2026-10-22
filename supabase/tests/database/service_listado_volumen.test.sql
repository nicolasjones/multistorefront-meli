-- F-SVC-04 (MSF-342, épica MSF-199): volumen del listado de reparaciones (SC-002).
-- Siembra 2.000 reparaciones en tres tiendas y varios técnicos, mide una página del listado y comprueba
-- que el plan de las consultas por período y por serie usa los índices de la migración 20261022110100.
-- Umbral provisorio de la spec (Decisiones abiertas 5): < 500 ms por página en base local.
-- Los planes se miden con `enable_seqscan = off`: con 2.000 filas el planificador prefiere un barrido
-- secuencial aunque el índice sirva; lo que se comprueba es que el índice es utilizable por la consulta.
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000010', 'tecnico-uno@example.com'),
  ('e1000000-0000-0000-0000-000000000011', 'tecnico-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tercera');
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null);

create temp table datos as
  select
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno,
    (select id from dominio.estados_reparacion where organizacion_id = '11111111-1111-1111-1111-111111111111' order by orden limit 1) as estado_uno,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date as hoy;

-- 2.000 reparaciones: tienda e ingreso rotan, la entrega prevista cae en los próximos 90 días (1 de cada 7
-- sin fecha), el técnico alterna y la serie es única. Sin sesión (superusuario): sembrado directo.
insert into dominio.reparaciones (
  organizacion_id, empresa_id, numero, cliente_id, modelo_id, estado_id, numero_serie,
  tecnico_id, ingreso_en, entrega_prevista
)
select
  '11111111-1111-1111-1111-111111111111',
  ('a1000000-0000-0000-0000-00000000000' || (1 + g % 3))::uuid,
  (g / 3) + 1,
  'c5000000-0000-0000-0000-000000000001',
  (select modelo_uno from datos),
  (select estado_uno from datos),
  'SN-' || lpad(g::text, 6, '0'),
  case g % 3 when 0 then 'e1000000-0000-0000-0000-000000000010'::uuid when 1 then 'e1000000-0000-0000-0000-000000000011'::uuid end,
  (select hoy from datos) - (g % 30),
  case when g % 7 = 0 then null else (select hoy from datos) - (g % 30) + (g % 90) end
from generate_series(1, 2000) g;

analyze dominio.reparaciones;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select is((select count(*) from dominio.reparaciones)::int, 2000, 'quedaron sembradas 2.000 reparaciones');

-- ============================================================================
-- Tiempo de una página (listado completo y búsqueda por serie)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

create temp table medida (clave text primary key, ms numeric);
grant select, insert on medida to public;

do $$
declare
  v_inicio timestamptz;
  v_json jsonb;
begin
  v_inicio := clock_timestamp();
  v_json := public.listar_reparaciones(null, 'mes', null, null, 1, 25);
  insert into medida values ('mes', extract(epoch from clock_timestamp() - v_inicio) * 1000);
  perform set_config('volumen.mes_filas', jsonb_array_length(v_json -> 'filas')::text, true);

  v_inicio := clock_timestamp();
  v_json := public.listar_reparaciones('a1000000-0000-0000-0000-000000000001', 'semana', null, null, 1, 25);
  insert into medida values ('semana_tienda', extract(epoch from clock_timestamp() - v_inicio) * 1000);

  v_inicio := clock_timestamp();
  v_json := public.listar_reparaciones(null, 'mes', 'sn-00121', null, 1, 25);
  insert into medida values ('serie', extract(epoch from clock_timestamp() - v_inicio) * 1000);
  perform set_config('volumen.serie_filas', jsonb_array_length(v_json -> 'filas')::text, true);
end $$;

select is(current_setting('volumen.mes_filas')::int, 25, 'la página de Mes trae 25 filas');
select ok((select ms from medida where clave = 'mes') < 500, 'una página de Mes tarda menos de 500 ms');
select ok((select ms from medida where clave = 'semana_tienda') < 500, 'una página de Semana por tienda tarda menos de 500 ms');
select ok((select ms from medida where clave = 'serie') < 500, 'la búsqueda por serie tarda menos de 500 ms');
select is(current_setting('volumen.serie_filas')::int, 10, 'la serie parcial «sn-00121» encuentra SN-001210…SN-001219');

-- ============================================================================
-- Planes: las consultas del listado pueden usar los índices
-- ============================================================================

reset role;
set local enable_seqscan = off;

create function pg_temp.plan(p_consulta text) returns text language plpgsql as $$
declare v_linea text; v_plan text := '';
begin
  for v_linea in execute 'explain ' || p_consulta loop v_plan := v_plan || v_linea || E'\n'; end loop;
  return v_plan;
end $$;

select ok(
  pg_temp.plan($q$select id from dominio.reparaciones
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and empresa_id = 'a1000000-0000-0000-0000-000000000001'
       and entrega_prevista between current_date and current_date + 6$q$)
  like '%reparaciones_org_empresa_entrega_idx%', 'el período por tienda usa el índice de entrega prevista');
select ok(
  pg_temp.plan($q$select id from dominio.reparaciones
     where organizacion_id = '11111111-1111-1111-1111-111111111111'
       and lower(numero_serie) = 'sn-001210'$q$)
  like '%reparaciones_org_serie_idx%', 'la serie exacta usa el índice de serie en minúsculas (la parcial recorre las filas de la organización)');
select ok(
  pg_temp.plan($q$select id from dominio.reparaciones
     where tecnico_id = 'e1000000-0000-0000-0000-000000000010'$q$)
  like '%reparaciones_tecnico_idx%', 'el filtro de técnico usa el índice de técnico');

select * from finish();
rollback;
