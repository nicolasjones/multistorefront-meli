-- MSF-930: alertas de Inicio `cobros_pendientes` y `faltantes` (recálculo, sin umbral, RLS por sección y empresa).
-- El fixture corre como postgres; las lecturas, como «authenticated», igual que PostgREST.
begin;

select plan(13);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),
  ('f3000000-0000-0000-0000-000000000001', 'sin-organizacion@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');

-- Uno tiene correo; Sin Correo no.
insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', 'uno@example.com', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente Sin Correo', 'minorista', null, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas');

-- P3 «A pedido» con 6 en stock; P4 «A pedido» con 3 (se reservan los 3: queda sin stock disponible).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Consola bajo pedido', 'CON-1', 'ARS', 2000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Monitor bajo pedido', 'MON-1', 'ARS', 3000, 'c1000000-0000-0000-0000-000000000001', 'a_pedido', true);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 6, 0),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 3, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000003', (select principal from datos), '11111111-1111-1111-1111-111111111111', 6, 0),
  ('b1000000-0000-0000-0000-000000000004', (select principal from datos), '11111111-1111-1111-1111-111111111111', 3, 0)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create temp table lin (clave text primary key, id uuid);
grant select, insert, update on lin to public;

create function pg_temp.armar(p_clave text, p_cliente uuid, p_producto uuid, p_cantidad integer) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', '2026-10-24');
  insert into comps (clave, id) values (p_clave, v_c.id);
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(jsonb_build_object(
    'producto_id', p_producto, 'cantidad', p_cantidad, 'deposito_id', (select principal from datos))), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
  insert into lin (clave, id)
    select p_clave, l.linea_id from public.faltantes_listado l where l.comprobante_id = v_c.id;
end $$;

create function pg_temp.lineas(variadic p_claves text[]) returns uuid[] language sql as $$
  select array_agg(l.id order by l.clave) from lin l where l.clave = any (p_claves) $$;

-- La reserva que dejó la línea del comprobante (la referencia es `comprobante:<id>:linea:<orden>`).
create function pg_temp.reserva_de(p_clave text) returns uuid language sql security definer as $$
  select r.id from dominio.reservas_stock r
   where r.referencia like 'comprobante:' || (select id from comps where clave = p_clave) || ':linea:%' $$;

-- Lectura directa de la tabla con los privilegios del dueño: service_role solo ejecuta las RPC.
create function pg_temp.q(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute p_sql into v;
  return v;
end $$;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

select pg_temp.armar('F1', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F2', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F3', 'c5000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', 1);
select pg_temp.armar('F4', 'c5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 3);
reset role;

-- Avisos: F1 enviado, F2 pendiente, F3 agotado (no cuenta), F4 sin aviso (no cuenta).
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, estado)
select l.id, '11111111-1111-1111-1111-111111111111'::uuid, 'a1000000-0000-0000-0000-000000000001'::uuid,
       case l.clave when 'F3' then 'c5000000-0000-0000-0000-000000000002'::uuid else 'c5000000-0000-0000-0000-000000000001'::uuid end,
       case l.clave when 'F1' then 'enviado' when 'F2' then 'pendiente' else 'agotado' end
  from lin l where l.clave in ('F1', 'F2', 'F3');

select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from dominio.alertas_inicio where tipo in ('cobros_pendientes', 'faltantes')), 2,
  'el recálculo genera las dos alertas nuevas: cobros pendientes y faltantes');
select is(
  (select cantidad from dominio.alertas_inicio where tipo = 'cobros_pendientes' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  4, 'cobros_pendientes cuenta las facturas confirmadas con saldo (las cuatro sin cobrar)');
select is(
  (select cantidad from dominio.alertas_inicio where tipo = 'faltantes' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2, 'faltantes cuenta los avisados (pendiente o enviado) y no el agotado ni el sin aviso');
select is(
  (select array_agg(tipo || '=' || seccion || '=' || enlace order by tipo)
     from dominio.alertas_inicio where tipo in ('cobros_pendientes', 'faltantes')),
  array['cobros_pendientes=ventas=/ventas/comprobantes', 'faltantes=stock=/stock/faltantes'],
  'cada tipo nuevo lleva a su listado');

-- Un cobro que cubre el total saca la factura; resolver un faltante lo saca de la cuenta.
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Efectivo', 'efectivo', false, false, true);
insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, registrado_en, actualizado_en)
select 'b1000000-0000-0000-0000-000000000101', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', c.id, c.total_con_iva,
       'b1000000-0000-0000-0000-00000000000a', 'manual', 'f1000000-0000-0000-0000-000000000002', 'Operador', now(), now()
  from dominio.comprobantes_venta c where c.id = (select id from comps where clave = 'F4');
update dominio.reservas_stock set estado = 'descontada', resuelto_en = now() where id = pg_temp.reserva_de('F1');
select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is(
  (select cantidad from dominio.alertas_inicio where tipo = 'cobros_pendientes' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3, 'una factura cobrada por completo deja de contar');
select is(
  (select cantidad from dominio.alertas_inicio where tipo = 'faltantes' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'un faltante resuelto deja de contar');

-- RLS: Operador (Ventas y Stock con edición) ve ambas; Consulta, según su nivel; otra organización, ninguna.
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.alertas_inicio_visibles where tipo in ('cobros_pendientes', 'faltantes')), 2,
  'Operador ve las dos alertas nuevas de su empresa');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.alertas_inicio_visibles where tipo in ('cobros_pendientes', 'faltantes')), 0,
  'otra organización no ve las alertas de la primera');
reset role;

-- Sin nada pendiente no hay alerta (sin umbral: con uno basta, con cero no).
update dominio.reservas_stock set estado = 'descontada', resuelto_en = now() where id in (pg_temp.reserva_de('F2'));
insert into dominio.cobros_comprobante
  (id, organizacion_id, empresa_id, comprobante_id, importe, forma_pago_id, origen, registrado_por, registrado_por_nombre, registrado_en, actualizado_en)
select gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', c.id, c.total_con_iva,
       'b1000000-0000-0000-0000-00000000000a', 'manual', 'f1000000-0000-0000-0000-000000000002', 'Operador', now(), now()
  from dominio.comprobantes_venta c where c.id in (select id from comps where clave in ('F1', 'F2', 'F3'));
select public.recalcular_alertas_inicio('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from dominio.alertas_inicio where tipo in ('cobros_pendientes', 'faltantes')), 0,
  'sin cobros pendientes ni faltantes no se genera ninguna alerta');

select is(
  (select count(*)::int from pg_constraint where conrelid = 'dominio.alertas_inicio'::regclass and conname = 'alertas_inicio_tipo_coherente'),
  1, 'la regla de coherencia tipo/sección/enlace sigue vigente');
select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'cobros_pendientes', 'ventas', 1, '/ventas/comprobantes')$$,
  '23514', null, 'un cobro pendiente sin empresa no se puede guardar');
select throws_ok(
  $$insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace)
    values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'faltantes', 'stock', 1, 'https://ejemplo.com')$$,
  '23514', null, 'el enlace de un faltante sale de la lista cerrada');
select is(
  (select count(*)::int from information_schema.check_constraints where constraint_name = 'alertas_inicio_tipo_check'), 1,
  'el tipo sigue acotado a una lista cerrada');

select * from finish();
rollback;
