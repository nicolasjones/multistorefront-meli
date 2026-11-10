-- F-SVC-13 (MSF-418, épica MSF-232): las líneas `sin_stock` del comprobante de una reparación no mueven stock (SC-002).
-- Cubre FR-003 y FR-006: confirmar y anular un comprobante generado desde Service no genera movimientos ni
-- reservas por esas líneas; las líneas de catálogo (regresión de MSF-159) siguen descontando y devolviendo; editar
-- las líneas de catálogo conserva las de Service y recalcula los totales; una nota de crédito sobre una línea de
-- Service no devuelve stock y copia la marca; `rls_en_toda_tabla` verde.
-- Matriz vigente: administrador y operador `edicion` en `service_tecnico` y `ventas`; el administrador anula y
-- emite notas de crédito.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'minorista', null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, activo) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', true);

create temp table datos as
  select
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.modelos_equipo where organizacion_id = '11111111-1111-1111-1111-111111111111' and equipo = 'Nintendo Switch' and modelo = 'Estándar') as modelo_uno;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

-- Joystick: 10 en el principal.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table reps (clave text primary key, id uuid);
grant select, insert on reps to public;
create temp table comps (clave text primary key, id uuid);
grant select, insert on comps to public;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.est(p_clave text) returns text language sql security definer as $$
  select estado from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.stock() returns text language sql security definer as $$
  select cantidad || '/' || reservado from dominio.existencias_deposito
   where producto_id = 'b1000000-0000-0000-0000-000000000001' and deposito_id = (select principal from datos) $$;
create function pg_temp.movimientos(p_tipo text) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock where tipo = p_tipo $$;
create function pg_temp.reservas() returns integer language sql security definer as $$
  select count(*)::int from dominio.reservas_stock $$;
create function pg_temp.lineas(p_clave text, p_filtro text) returns integer language sql security definer as $$
  select count(*)::int from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave)
     and case p_filtro when 'sin_stock' then l.sin_stock when 'catalogo' then not l.sin_stock else true end $$;
create function pg_temp.linea_sin_stock(p_clave text) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave) and l.sin_stock order by l.orden limit 1 $$;
grant execute on function pg_temp.id_de(text), pg_temp.upd(text), pg_temp.est(text), pg_temp.stock(),
  pg_temp.movimientos(text), pg_temp.reservas(), pg_temp.lineas(text, text), pg_temp.linea_sin_stock(text) to public;

-- Reparaciones con dos ítems cada una (mano de obra 2 × 1.000 y un repuesto libre 1 × 200).
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into reps (clave, id)
select c, (public.crear_reparacion(
  'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', (select modelo_uno from datos)
)->>'id')::uuid
from unnest(array['r1', 'r2', 'r3']) c;
select public.agregar_item_reparacion((select id from reps where clave = c), 'mano_obra', 'Cambio de pantalla', null, 2, 1000)
  from unnest(array['r1', 'r2', 'r3']) c;
select public.agregar_item_reparacion((select id from reps where clave = c), 'repuesto', 'Cinta flex', null, 1, 200)
  from unnest(array['r1', 'r2', 'r3']) c;

-- ============================================================================
-- Editar líneas de catálogo conserva las de Service (FR-006)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
insert into comps (clave, id)
select 'c' || substr(c, 2), (public.generar_comprobante_reparacion((select id from reps where clave = c))->>'comprobante_id')::uuid
from unnest(array['r1', 'r2', 'r3']) c;

select is(pg_temp.lineas('c1', 'sin_stock'), 2, 'el comprobante nace con dos líneas sin_stock');

select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L,
    '[{"producto_id": "b1000000-0000-0000-0000-000000000001", "cantidad": 2}]'::jsonb, %L)$$,
    pg_temp.id_de('c1'), pg_temp.upd('c1')),
  'el comprobante de Service se edita como cualquier factura (agregar una línea de catálogo)');
select is(pg_temp.lineas('c1', 'sin_stock'), 2, 'las líneas de Service se conservan al guardar las de catálogo');
select is(pg_temp.lineas('c1', 'catalogo'), 1, 'la línea de catálogo se agrega');
select lives_ok(
  format($$select public.guardar_lineas_comprobante(%L,
    '[{"producto_id": "b1000000-0000-0000-0000-000000000001", "cantidad": 2}]'::jsonb, %L)$$,
    pg_temp.id_de('c1'), pg_temp.upd('c1')),
  'volver a guardar las mismas líneas de catálogo');
select is(pg_temp.lineas('c1', 'todas'), 3, 'sin duplicar líneas al re-guardar');
reset role;
select is(
  (select total_sin_iva::text || '/' || total_con_iva::text from dominio.comprobantes_venta where id = pg_temp.id_de('c1')),
  '4200.00/5082.00', 'los totales suman las líneas de Service y las de catálogo (21 % general)');
select is(
  (select string_agg(orden::text, ',' order by orden) from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('c1')),
  '1,2,3', 'la línea de catálogo se numera a continuación');

-- ============================================================================
-- Confirmar: solo la línea de catálogo descuenta
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('c1')),
  'confirmar un comprobante con líneas de Service y de catálogo');
select is(pg_temp.est('c1'), 'confirmada', 'queda confirmada');
select is(pg_temp.stock(), '8/0', 'solo la línea de catálogo descontó stock (10 − 2)');
select is(pg_temp.movimientos('salida'), 1, 'un solo movimiento de salida: el de la línea de catálogo');
select is(pg_temp.reservas(), 0, 'ninguna reserva');

-- Comprobante solo de Service: confirma sin tocar nada.
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('c2')),
  'confirmar un comprobante solo con líneas de Service');
select is(pg_temp.est('c2'), 'confirmada', 'el comprobante solo de Service queda confirmado');
select is(pg_temp.stock(), '8/0', 'el stock no se movió');
select is(pg_temp.movimientos('salida'), 1, 'ningún movimiento nuevo');
select is(pg_temp.reservas(), 0, 'sin reservas por líneas de Service');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('c2')),
  'reintentar la confirmación es idempotente');
select throws_ok(
  format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, %L)$$, pg_temp.id_de('c2'), pg_temp.upd('c2')),
  '55000', null, 'una vez confirmado, el comprobante de Service ya no se edita');

-- ============================================================================
-- Anular: solo se devuelve la línea de catálogo
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', %L)$$, pg_temp.id_de('c1'), pg_temp.upd('c1')),
  'anular el comprobante con líneas de Service y de catálogo');
select is(pg_temp.stock(), '10/0', 'el stock vuelve: solo la línea de catálogo se devolvió');
select is(pg_temp.movimientos('entrada'), 1, 'una sola entrada por la anulación');
select lives_ok(
  format($$select public.anular_comprobante(%L, 'Error de carga', %L)$$, pg_temp.id_de('c2'), pg_temp.upd('c2')),
  'anular el comprobante solo de Service');
select is(pg_temp.est('c2'), 'anulada', 'queda anulado');
select is(pg_temp.movimientos('entrada'), 1, 'anular el comprobante solo de Service no devuelve stock');
select is(pg_temp.stock(), '10/0', 'el stock sigue igual');

-- ============================================================================
-- Nota de crédito sobre una línea de Service
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select public.confirmar_comprobante(pg_temp.id_de('c3'));
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(
  format($$select public.emitir_nota_credito(%L, 'devolucion_productos',
    jsonb_build_array(jsonb_build_object('linea_id', %L, 'cantidad', 1)), 'Devolución del cliente')$$,
    pg_temp.id_de('c3'), pg_temp.linea_sin_stock('c3')),
  'una nota de devolución de productos sobre una línea de Service');
select is(pg_temp.movimientos('entrada'), 1, 'la nota no devuelve stock por la línea de Service');
select is(pg_temp.stock(), '10/0', 'el stock no cambia');
reset role;
select is(
  (select count(*)::int from dominio.comprobantes_venta_lineas l
     join dominio.comprobantes_venta n on n.id = l.comprobante_id
    where n.comprobante_origen_id = pg_temp.id_de('c3') and l.sin_stock and l.producto_id is null),
  1, 'la línea de la nota copia la marca sin_stock');

-- ============================================================================
-- Aislamiento
-- ============================================================================

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'dominio') and c.relkind = 'r' and not c.relrowsecurity)::int,
  0, 'toda tabla de public y dominio tiene RLS (rls_en_toda_tabla)');
select throws_ok(
  $$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, descripcion, cantidad, precio_unitario, subtotal_sin_iva, iva)
    values ('11111111-1111-1111-1111-111111111111', (select id from dominio.comprobantes_venta limit 1), 99, 'Sin marca', 1, 1, 1, 0)$$,
  '23514', null, 'sin la marca sin_stock, producto, depósito y escala siguen siendo obligatorios');

select * from finish();
rollback;
