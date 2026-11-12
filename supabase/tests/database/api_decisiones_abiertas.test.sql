-- F-API-01 (MSF-233): las cuatro decisiones que dejaron abiertas las revisiones QA y Código/Seguridad
-- (migración 20270301100000): cursor en una sola función, precios sin recorrer el catálogo entero, `creada_por` que no
-- borra la integración, secreto de Vault que se va con la suscripción y tope por organización.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a3000000-0000-0000-0000-000000000001', 'Organización decisiones');

insert into auth.users (id, email) values
  ('f3000000-0000-0000-0000-000000000001', 'admin-decisiones@example.com'),
  ('f3000000-0000-0000-0000-000000000003', 'creador-suscripcion@example.com'),
  ('f3000000-0000-0000-0000-000000000002', 'creador-decisiones@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'administrador', 'activo');

-- ============================================================================
-- Cursor: private.api_cursor_partes
-- ============================================================================

select is((select count(*)::int from private.api_cursor_partes(null, 2)), 0, 'sin cursor no hay fila');

select is(
  (select c.id from private.api_cursor_partes(
     private.api_codificar_cursor('2026-01-01T00:00:00Z'::timestamptz, 'b3000000-0000-0000-0000-000000000001'::uuid), 2) c),
  'b3000000-0000-0000-0000-000000000001'::uuid,
  'un cursor de dos partes devuelve su id');

select is(
  (select c.extra from private.api_cursor_partes(
     private.api_codificar_cursor('2026-01-01T00:00:00Z'::timestamptz, 'b3000000-0000-0000-0000-000000000001'::uuid,
       'b3000000-0000-0000-0000-000000000002'::uuid), 3) c),
  'b3000000-0000-0000-0000-000000000002'::uuid,
  'un cursor de tres partes devuelve el uuid extra');

select throws_ok(
  $$select * from private.api_cursor_partes(private.api_codificar_cursor('2026-01-01T00:00:00Z'::timestamptz, 'b3000000-0000-0000-0000-000000000001'::uuid), 3)$$,
  '22023', 'CURSOR_INVALIDO', 'un cursor con menos partes de las esperadas es inválido');

select throws_ok(
  $$select * from private.api_cursor_partes(encode(convert_to('1767225600000000|b3000000-0000-0000-0000-000000000001|no-es-uuid', 'UTF8'), 'base64'), 3)$$,
  '22023', 'CURSOR_INVALIDO', 'un tercer valor que no es uuid es CURSOR_INVALIDO y no un error interno');

-- ============================================================================
-- Precios: el cambio de una escala hace aparecer el producto; el filtro y el cursor no lo pierden
-- ============================================================================

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo, updated_at)
select ('b3000000-0000-0000-0000-00000000000' || n)::uuid, 'a3000000-0000-0000-0000-000000000001', 'Producto ' || n,
       'D-' || n, 'ARS', 100 * n, true, '2027-01-01T00:00:00Z'::timestamptz + (n || ' hours')::interval
  from generate_series(1, 4) n;

-- Solo la escala del producto 1 cambia después: su `actualizado_en` pasa a ser el de la escala.
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio, updated_at)
values ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'x5', 90, '2027-02-01T00:00:00Z'),
       ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'x10', 80, '2027-01-02T00:00:00Z');

select is(
  (select array_agg(e->>'sku' order by e->>'sku')
     from private.api_leer_precios('a3000000-0000-0000-0000-000000000001', null, 100, null) r,
          jsonb_array_elements(r.filas) e),
  array['D-1', 'D-2', 'D-3', 'D-4'], 'sin filtro devuelve todos los productos');

select is(
  (select array_agg(e->>'sku' order by e->>'sku')
     from private.api_leer_precios('a3000000-0000-0000-0000-000000000001', null, 100, '2027-01-15T00:00:00Z') r,
          jsonb_array_elements(r.filas) e),
  array['D-1'], 'con `actualizado_desde` solo aparece el producto cuya escala cambió');

select is(
  (select (e->>'precio_x5')::numeric
     from private.api_leer_precios('a3000000-0000-0000-0000-000000000001', null, 100, '2027-01-15T00:00:00Z') r,
          jsonb_array_elements(r.filas) e),
  90::numeric, 'el producto filtrado trae el precio de su escala');

select is(
  (select (e->>'precio_x10')::numeric
     from private.api_leer_precios('a3000000-0000-0000-0000-000000000001', null, 100, '2027-01-15T00:00:00Z') r,
          jsonb_array_elements(r.filas) e),
  80::numeric, 'el producto filtrado trae también la escala vieja, no solo la que cambió');

create temp table paginas_precios (n int, skus text[], siguiente text);
do $$
declare
  v_cursor text := null;
  v_fila record;
  v_n int := 0;
begin
  loop
    v_n := v_n + 1;
    select r.filas, r.siguiente_cursor into v_fila
      from private.api_leer_precios('a3000000-0000-0000-0000-000000000001', v_cursor, 2, null) r;
    insert into paginas_precios
    select v_n, array(select e->>'sku' from jsonb_array_elements(v_fila.filas) e), v_fila.siguiente_cursor;
    v_cursor := v_fila.siguiente_cursor;
    exit when v_cursor is null or v_n >= 10;
  end loop;
end $$;

select is((select count(*)::int from paginas_precios), 2, '4 productos con límite 2 se recorren en 2 páginas');
select is((select count(distinct s)::int from paginas_precios, unnest(skus) s), 4,
  'las páginas de precios no repiten ni pierden productos');
select is((select skus from paginas_precios where n = 2), array['D-4', 'D-1'],
  'el producto con escala nueva queda al final, ordenado por su último cambio');

-- ============================================================================
-- `creada_por` no borra la integración
-- ============================================================================

insert into public.api_claves (id, organizacion_id, nombre, prefijo, hash, alcances, creada_por)
values ('c3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'De quien se va',
  'c3c3c3c3', extensions.digest('clave-decisiones', 'sha256'), array['productos'], 'f3000000-0000-0000-0000-000000000002');

delete from auth.users where id = 'f3000000-0000-0000-0000-000000000002';

select is((select count(*)::int from public.api_claves where id = 'c3000000-0000-0000-0000-000000000001'), 1,
  'eliminar a quien creó la clave no la borra');
select is((select creada_por from public.api_claves where id = 'c3000000-0000-0000-0000-000000000001'), null,
  'la clave queda sin creador');

-- ============================================================================
-- El secreto de Vault se va con la suscripción, también por cascada de la organización
-- ============================================================================

do $$
declare
  v_vault uuid;
begin
  v_vault := vault.create_secret('secreto-decisiones');
  insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id, creada_por)
  values ('d3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'https://ejemplo.com/a',
    array['stock.actualizado'], v_vault, 'f3000000-0000-0000-0000-000000000001');
  create temp table vault_prueba as select v_vault as id;
end $$;

select is((select count(*)::int from vault.secrets where id = (select id from vault_prueba)), 1, 'el secreto existe mientras hay suscripción');
delete from public.api_suscripciones where id = 'd3000000-0000-0000-0000-000000000001';
select is((select count(*)::int from vault.secrets where id = (select id from vault_prueba)), 0, 'borrar la suscripción borra su secreto');

-- Dos suscripciones: borrar una no toca el secreto de la otra, y no pueden compartir secreto.
do $$
declare
  v_a uuid := vault.create_secret('secreto-a');
  v_b uuid := vault.create_secret('secreto-b');
begin
  insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id, creada_por) values
    ('d3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'https://ejemplo.com/uno', array['stock.actualizado'], v_a, 'f3000000-0000-0000-0000-000000000003'),
    ('d3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'https://ejemplo.com/dos', array['stock.actualizado'], v_b, 'f3000000-0000-0000-0000-000000000001');
  create temp table vault_par as select v_a as a, v_b as b;
end $$;

select throws_ok(
  $$insert into public.api_suscripciones (organizacion_id, url, tipos, secreto_vault_id)
    values ('a3000000-0000-0000-0000-000000000001', 'https://ejemplo.com/tres', array['stock.actualizado'], (select b from vault_par))$$,
  '23505', null, 'dos suscripciones no pueden compartir el mismo secreto de Vault');

delete from auth.users where id = 'f3000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.api_suscripciones where id = 'd3000000-0000-0000-0000-000000000002'), 1,
  'eliminar a quien creó la suscripción no la borra');
select is((select creada_por from public.api_suscripciones where id = 'd3000000-0000-0000-0000-000000000002'), null,
  'la suscripción queda sin creador');

delete from public.api_suscripciones where id = 'd3000000-0000-0000-0000-000000000002';
select is((select count(*)::int from vault.secrets where id = (select a from vault_par)), 0, 'se borró el secreto de la suscripción eliminada');
select is((select count(*)::int from vault.secrets where id = (select b from vault_par)), 1, 'el secreto de la otra suscripción sigue ahí');
delete from public.api_suscripciones where id = 'd3000000-0000-0000-0000-000000000003';

insert into organizaciones (id, nombre) values ('a3000000-0000-0000-0000-000000000002', 'Organización que se va');
do $$
declare
  v_vault uuid;
begin
  v_vault := vault.create_secret('secreto-cascada');
  insert into public.api_suscripciones (organizacion_id, url, tipos, secreto_vault_id)
  values ('a3000000-0000-0000-0000-000000000002', 'https://ejemplo.com/b', array['stock.actualizado'], v_vault);
  create temp table vault_cascada as select v_vault as id;
end $$;
delete from organizaciones where id = 'a3000000-0000-0000-0000-000000000002';
select is((select count(*)::int from vault.secrets where id = (select id from vault_cascada)), 0,
  'eliminar la organización también borra el secreto de la suscripción');

-- ============================================================================
-- Tope por organización
-- ============================================================================

insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, creada_por)
select 'a3000000-0000-0000-0000-000000000001', 'Clave ' || n, lpad(to_hex(n), 8, '0'),
       extensions.digest('tope-' || n, 'sha256'), array['stock'], 'f3000000-0000-0000-0000-000000000001'
  from generate_series(1, 48) n;   -- + la clave sin creador = 49 vigentes

insert into public.api_suscripciones (organizacion_id, url, tipos, secreto_vault_id, creada_por)
select 'a3000000-0000-0000-0000-000000000001', 'https://ejemplo.com/s' || n, array['stock.actualizado'], gen_random_uuid(),
       'f3000000-0000-0000-0000-000000000001'
  from generate_series(1, 19) n;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f3000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$select * from public.crear_clave_api('La número 50', array['stock'])$$, 'la clave número 50 se crea');
select throws_ok($$select * from public.crear_clave_api('La 51', array['stock'])$$, '54000', null,
  'la clave número 51 supera el tope de la organización');

select lives_ok($$select * from public.crear_suscripcion_api('https://ejemplo.com/veinte', array['stock.actualizado'])$$,
  'la suscripción número 20 se crea');
select throws_ok($$select * from public.crear_suscripcion_api('https://ejemplo.com/veintiuna', array['stock.actualizado'])$$,
  '54000', null, 'la suscripción número 21 supera el tope');

reset role;

-- Las claves revocadas y las vencidas no cuentan para el tope.
update public.api_claves set revocada_en = now() where nombre = 'Clave 1';
update public.api_claves set vence_en = now() - interval '1 day' where nombre = 'Clave 2';
set local role authenticated;
select lives_ok($$select * from public.crear_clave_api('Tras revocar', array['stock'])$$, 'al revocar una clave se libera un cupo');
select lives_ok($$select * from public.crear_clave_api('Tras vencer', array['stock'])$$, 'al vencer una clave se libera otro cupo');
select throws_ok($$select * from public.crear_clave_api('Otra más', array['stock'])$$, '54000',
  'La organización llegó al máximo de 50 claves vigentes: revocá alguna antes de crear otra',
  'con 50 vigentes vuelve a rechazar, con el mensaje del tope');
reset role;

-- Rotar tiene un tope duro de 100 vigentes.
insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, creada_por)
select 'a3000000-0000-0000-0000-000000000001', 'Extra ' || n, lpad(to_hex(1000 + n), 8, '0'),
       extensions.digest('extra-' || n, 'sha256'), array['stock'], 'f3000000-0000-0000-0000-000000000001'
  from generate_series(1, 50) n;
set local role authenticated;
select throws_ok(
  $$select * from public.rotar_clave_api('c3000000-0000-0000-0000-000000000001')$$,
  '54000', null, 'rotar con 100 claves vigentes se rechaza');
reset role;

-- La purga borra las claves revocadas o vencidas hace más de la retención y deja las recientes.
update public.api_claves set revocada_en = now() - interval '100 days' where nombre = 'Clave 3';
update public.api_claves set vence_en = now() - interval '100 days' where nombre = 'Clave 4';
select private.purgar_api_llamadas(90);
select is((select count(*)::int from public.api_claves where nombre in ('Clave 3', 'Clave 4')), 0,
  'la purga borra las claves revocadas o vencidas hace más de 90 días');
select is((select count(*)::int from public.api_claves where nombre in ('Clave 1', 'Clave 2')), 2,
  'la purga conserva las revocadas o vencidas hace poco');

-- Privilegios: las funciones privadas no son ejecutables por la app; las RPC públicas conservan los suyos.
select is(has_function_privilege('anon', 'private.api_cursor_partes(text, integer)', 'EXECUTE'), false, 'anon no ejecuta api_cursor_partes');
select is(has_function_privilege('authenticated', 'private.api_cursor_partes(text, integer)', 'EXECUTE'), false, 'authenticated no ejecuta api_cursor_partes');
select is(has_function_privilege('authenticated', 'private.api_borrar_secreto_suscripcion()', 'EXECUTE'), false, 'authenticated no ejecuta el trigger de Vault');
select is(has_function_privilege('anon', 'private.api_borrar_secreto_suscripcion()', 'EXECUTE'), false, 'anon no ejecuta el trigger de Vault');
select is(has_function_privilege('anon', 'public.rotar_clave_api(uuid)', 'EXECUTE'), false, 'anon no rota claves');
select is(has_function_privilege('authenticated', 'public.rotar_clave_api(uuid)', 'EXECUTE'), true, 'authenticated rota claves');
select is(has_function_privilege('anon', 'public.eliminar_suscripcion_api(uuid)', 'EXECUTE'), false, 'anon no elimina suscripciones');
select is(has_function_privilege('authenticated', 'public.eliminar_suscripcion_api(uuid)', 'EXECUTE'), true, 'authenticated elimina suscripciones');

select finish();
rollback;
