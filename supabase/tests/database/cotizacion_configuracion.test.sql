-- F-PRE-06 (MSF-419, épica MSF-352) · SC-001: configuración de la cotización del dólar.
-- Cubre FR-001, FR-002 y FR-006 (lectura de la configuración) con dos organizaciones: valores por defecto
-- (los del lanzamiento), permisos por rol (edición / lectura / ninguno), rangos inválidos, idempotencia,
-- evento `cotizacion.configuracion_guardada`, aislamiento entre organizaciones y `anon` sin ejecución ni acceso.
-- `rls_en_toda_tabla` cubre además que `cotizacion_configuracion` tenga RLS.
begin;

select plan(39);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'deposito@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

-- cotizacion_dolar: administrador = edición, operador = lectura, deposito = ninguno.
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'deposito'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-001, FR-002)
-- ============================================================================

select ok(to_regclass('dominio.cotizacion_configuracion') is not null, 'cotizacion_configuracion vive en el esquema dominio');
select ok((select relrowsecurity from pg_class where oid = 'dominio.cotizacion_configuracion'::regclass), 'cotizacion_configuracion tiene RLS activado');
select is(has_table_privilege('anon', 'dominio.cotizacion_configuracion', 'SELECT'), false, 'anon no lee cotizacion_configuracion');
select is(has_table_privilege('authenticated', 'dominio.cotizacion_configuracion', 'INSERT'), false, 'authenticated no inserta en cotizacion_configuracion');
select is(has_table_privilege('authenticated', 'dominio.cotizacion_configuracion', 'UPDATE'), false, 'authenticated no actualiza cotizacion_configuracion');
select is(has_function_privilege('anon', 'public.obtener_configuracion_cotizacion()', 'EXECUTE'), false, 'anon no ejecuta obtener_configuracion_cotizacion');
select is(has_function_privilege('anon', 'public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean)', 'EXECUTE'), false, 'anon no ejecuta guardar_configuracion_cotizacion');
select is(has_function_privilege('authenticated', 'public.obtener_configuracion_cotizacion()', 'EXECUTE'), true, 'authenticated ejecuta obtener_configuracion_cotizacion');
select is(has_function_privilege('authenticated', 'public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean)', 'EXECUTE'), true, 'authenticated ejecuta guardar_configuracion_cotizacion');

-- ============================================================================
-- Administrador (org 1): sin fila rigen los valores del lanzamiento
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

select is((select public.obtener_configuracion_cotizacion() ->> 'alcance'), 'sistema', 'defecto: una cotización para todo el sistema');
select is((select (public.obtener_configuracion_cotizacion() ->> 'redondeo_pesos')::int), 10, 'defecto: redondeo al $ 10');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 1::numeric, 'defecto: umbral de 1 %');
select is((select (public.obtener_configuracion_cotizacion() ->> 'confirmacion_pct')::numeric), 15::numeric, 'defecto: confirmación de 15 %');
select is((select (public.obtener_configuracion_cotizacion() ->> 'aviso_activo')::boolean), true, 'defecto: aviso en Inicio activo');

-- ============================================================================
-- Guardar: cambia, es idempotente y deja un solo evento
-- ============================================================================

select is((select (public.guardar_configuracion_cotizacion(50, 2, 20, false) ->> 'actualizado')::boolean), true, 'guardar un cambio: actualizado');
select is((select (public.obtener_configuracion_cotizacion() ->> 'redondeo_pesos')::int), 50, 'se guardó el redondeo');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 2::numeric, 'se guardó el umbral');
select is((select (public.obtener_configuracion_cotizacion() ->> 'aviso_activo')::boolean), false, 'se guardó el aviso apagado');
select is((select (public.guardar_configuracion_cotizacion(50, 2, 20, false) ->> 'actualizado')::boolean), false, 'guardar lo mismo no actualiza (idempotente)');

reset role;
select is(
  (select count(*)::int from public.registro_actividad
    where organizacion_id = '11111111-1111-1111-1111-111111111111' and tipo = 'cotizacion.configuracion_guardada'),
  1, 'guardar dos veces lo mismo deja un solo evento cotizacion.configuracion_guardada'
);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- ============================================================================
-- Rangos inválidos (FR-002): nada se guarda
-- ============================================================================

select throws_ok($$select public.guardar_configuracion_cotizacion(50, -1, 20, true)$$, '22023', 'El umbral debe estar entre 0 y 100 % y tener hasta 3 decimales', 'umbral negativo');
select throws_ok($$select public.guardar_configuracion_cotizacion(50, 101, 100, true)$$, '22023', 'El umbral debe estar entre 0 y 100 % y tener hasta 3 decimales', 'umbral mayor a 100');
select throws_ok($$select public.guardar_configuracion_cotizacion(50, null, 20, true)$$, '22023', 'El umbral debe estar entre 0 y 100 % y tener hasta 3 decimales', 'umbral vacío');
select throws_ok($$select public.guardar_configuracion_cotizacion(50, 1.2345, 20, true)$$, '22023', 'El umbral debe estar entre 0 y 100 % y tener hasta 3 decimales', 'umbral con más de 3 decimales');
select throws_ok($$select public.guardar_configuracion_cotizacion(7, 1, 15, true)$$, '22023', 'Elegí un redondeo válido', 'redondeo fuera del conjunto admitido');
select throws_ok($$select public.guardar_configuracion_cotizacion(10, 5, 5, true)$$, '22023', 'La confirmación debe ser mayor al umbral y de hasta 100 %', 'confirmación igual al umbral');
select throws_ok($$select public.guardar_configuracion_cotizacion(10, 5, 101, true)$$, '22023', 'La confirmación debe ser mayor al umbral y de hasta 100 %', 'confirmación mayor a 100');
select throws_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, null)$$, '22023', 'Indicá si querés el aviso en Inicio', 'aviso vacío');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 2::numeric, 'tras los errores la configuración sigue igual');

-- ============================================================================
-- Permisos por rol
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 2::numeric, 'lectura: ve la configuración');
select throws_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, true)$$, '42501', 'Tu rol no puede cambiar la configuración de la cotización', 'lectura: no la cambia');

select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.obtener_configuracion_cotizacion()$$, '42501', 'Tu rol no puede ver la cotización del dólar', 'sin sección: no la ve');
select throws_ok($$select public.guardar_configuracion_cotizacion(10, 1, 15, true)$$, '42501', 'Tu rol no puede cambiar la configuración de la cotización', 'sin sección: no la cambia');

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 1::numeric, 'org 2: no ve la configuración de la org 1 (valores del lanzamiento)');
select is((select (public.guardar_configuracion_cotizacion(100, 0.5, 10, true) ->> 'actualizado')::boolean), true, 'org 2: guarda la suya');
select is((select count(*)::int from dominio.cotizacion_configuracion), 1, 'org 2: la RLS solo le deja ver su fila');

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select (public.obtener_configuracion_cotizacion() ->> 'umbral_pct')::numeric), 2::numeric, 'org 1: la configuración de la org 2 no la toca');

-- ============================================================================
-- Restricciones de la tabla (superusuario)
-- ============================================================================

reset role;
select throws_ok(
  $$insert into dominio.cotizacion_configuracion (organizacion_id) values ('22222222-2222-2222-2222-222222222222')$$,
  '23505', null, 'la tabla no admite una segunda fila por organización (PK)'
);
select throws_ok(
  $$update dominio.cotizacion_configuracion set confirmacion_pct = 0.5 where organizacion_id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', null, 'la tabla rechaza una confirmación que no supera el umbral'
);

select * from finish();
rollback;
