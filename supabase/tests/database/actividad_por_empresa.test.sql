-- Actividad por empresa accesible (seguimiento de Gastos de la empresa, D19): quien tiene la sección `actividad` ve los eventos de
-- las empresas a las que accede y los de toda la organización (sin empresa), pero NO los de una empresa ajena (p. ej. un gasto
-- «Sueldos» de otra tienda). Cubre la política de lectura, `listar_actividad`, `obtener_detalle_actividad`, `opciones_actividad`
-- y `exportar_actividad` (security definer: aplica el mismo predicado). El historial de una empresa pausada sigue visible.
begin;

select plan(18);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('b1000000-0000-0000-0000-000000000006', 'administracion@example.com'),
  ('b2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Propia', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Ajena', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda Pausada', false);

-- Administración solo accede a «Tienda Propia» (fila explícita) y a la pausada, que tiene asignada.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('b1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('b1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'administracion');

insert into registro_actividad (id, organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle, creado_en) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'gasto.creado', 'Cargó un gasto de Alquiler en Tienda Propia', '2026-10-01 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'gasto.creado', 'Cargó un gasto de Sueldos en Tienda Ajena', '2026-10-02 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null,
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'usuario.rol_cambiado', 'Cambió el rol de Ana', '2026-10-03 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000001', 'Ana Admin', 'empresa.pausada', 'Se pausó la empresa', '2026-10-04 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', null,
    'b2000000-0000-0000-0000-000000000001', 'Admin Dos', 'otra.cosa', 'Evento de la otra organización', '2026-10-05 12:00:00+00');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Administración (lectura de actividad, dos empresas asignadas).
select pg_temp.como('b1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from public.registro_actividad), 3,
  'administración ve los eventos de sus empresas y los de toda la organización (3 de 4 de su organización)');
select is((select count(*)::int from public.registro_actividad where empresa_id = 'e1000000-0000-0000-0000-000000000002'), 0,
  'no ve los eventos de una empresa a la que no accede');
select is((select count(*)::int from public.registro_actividad where tipo = 'gasto.creado' and detalle like '%Sueldos%'), 0,
  'no ve la categoría de un gasto de una empresa ajena');
select is((select count(*)::int from public.registro_actividad where empresa_id is null), 1,
  'sigue viendo los eventos sin empresa de su organización');
select is((select count(*)::int from public.registro_actividad where tipo = 'empresa.pausada'), 1,
  'el historial de una empresa pausada que tiene asignada sigue visible');
select is((select count(*)::int from public.listar_actividad()), 3, 'listar_actividad devuelve lo mismo que la política (3)');
select is((select count(*)::int from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000002')), 0,
  'el detalle de un evento de una empresa ajena no se obtiene');
select is((select count(*)::int from public.obtener_detalle_actividad('a0000000-0000-0000-0000-000000000001')), 1,
  'el detalle de un evento de su empresa sí');
reset role;

-- Administrador (edición de actividad, todas las empresas de la organización, incluso la pausada).
select pg_temp.como('b1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.registro_actividad), 4, 'el administrador ve todo el historial de su organización (incluida la empresa pausada)');
select is((select count(*)::int from public.registro_actividad where tipo = 'otra.cosa'), 0, 'y nunca el de otra organización');
select is((public.exportar_actividad(p_tipo => 'gasto.creado', p_con_total => true)->>'total')::int, 2,
  'exportar_actividad cuenta los eventos de todas sus empresas');
reset role;

-- `exportar_actividad` es security definer (no pasa por la política): aplica el mismo predicado en el total, en la página y en la búsqueda
-- del nombre del usuario filtrado. Solo el administrador exporta y él accede a todas las empresas, así que se verifica que las tres
-- consultas lo lleven en su definición y se prueba el predicado directo con la persona restringida.
select is((select (length(d) - length(replace(d, 'private.empresas_de_actividad()', ''))) / length('private.empresas_de_actividad()')
             from (select pg_get_functiondef('public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean)'::regprocedure) as d) f), 4,
  'exportar_actividad aplica el alcance por empresa en sus cuatro consultas');
select pg_temp.como('b1000000-0000-0000-0000-000000000006');
-- Nombre de la tienda en la constancia: un UUID de empresa ajena no deja su nombre en el detalle (solo el administrador exporta y ve
-- todo, así que se prueba el predicado con la persona restringida).
select is((select count(*)::int from private.empresas_de_actividad() x where x = 'e1000000-0000-0000-0000-000000000002'), 0,
  'la persona restringida no tiene la tienda ajena entre sus empresas de actividad');
select is((select count(*)::int from dominio.empresas e where e.id = 'e1000000-0000-0000-0000-000000000002' and e.id in (select private.empresas_de_actividad())), 0,
  'la búsqueda del nombre de la tienda filtrada (mismo predicado que exportar_actividad) no devuelve la tienda ajena');
select is((select count(*)::int from private.empresas_de_actividad()), 2, 'empresas_de_actividad devuelve sus dos empresas asignadas (activa y pausada)');
select is((select count(*)::int from private.empresas_accesibles()), 1, 'mientras empresas_accesibles solo la activa (la pausada queda fuera del selector)');
reset role;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname = 'empresas_de_actividad'
              and not has_function_privilege('anon', p.oid, 'execute')), 1, 'anon no ejecuta empresas_de_actividad');

-- Guardia estructural: las únicas funciones `security definer` que leen (o depuran) `registro_actividad` son estas cuatro. Una función
-- definer no pasa por la política, así que una nueva (o una sobrecarga vieja de `exportar_actividad`) que la lea debe revisarse a mano:
-- aplicar `private.empresas_de_actividad()` o justificar por qué no hace falta, y sumarse a esta lista.
--   * private.depurar_registro_actividad: solo borra por antigüedad, restringida a los roles de orquestación.
--   * public.exportar_actividad: aplica el alcance por empresa en sus consultas (aserción de arriba).
--   * public.historial_comprobante: solo eventos de la empresa del comprobante y con `ventas` en esa empresa.
--   * public.regenerar_enlace_consulta: solo cuenta los eventos de la propia persona (tope por hora), no devuelve filas.
select is((select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prosecdef and p.prokind = 'f' and n.nspname in ('public', 'private', 'publico', 'dominio')
              and p.prosrc ~* '(from|join|using)\s+(only\s+)?(public\.)?registro_actividad\M'),
  array['private.depurar_registro_actividad', 'public.exportar_actividad', 'public.historial_comprobante', 'public.regenerar_enlace_consulta'],
  'solo cuatro funciones security definer leen el registro de actividad, cada una con su propio control');

select * from finish();
rollback;
