-- F-CLI-21 (MSF-453, spec 20270327-100000-listas-de-precios-por-cliente, Fase 3, T014 y T016): las ventas usan la lista del cliente y
-- guardan el snapshot. Dueño de RF-CLI-21-5, CA-CLI-21-2…6 y D12:
--   · estructura de las columnas `lista_precio_id` y `lista_ajuste_pct` de la línea (checks, FK, índice, mismos grants que `precio_referencia`);
--   · `guardar_lineas_comprobante`: con la bandera `listas_precios` encendida la línea sale al precio de la lista y guarda el snapshot; con
--     precio manual, precio propio o escala no guarda lista; sin lista o con la bandera apagada, todo igual que hoy;
--   · `obtener_comprobante` expone `lista_ajuste_pct` y `lista_nombre` (la marca de la pantalla);
--   · D12: lo confirmado no cambia al editar la lista ni al reasignar al cliente; el borrador se recalcula al guardar;
--   · `copiar_presupuesto` reprecia con la lista; las notas de crédito heredan el snapshot;
--   · la validación de la confirmación (`lineas_con_promocion_desactualizada`) compara contra el precio normal CON la lista.
-- El fixture corre como postgres; las verificaciones, con el rol que corresponda.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena', -50);

-- c1 sin lista · c2 con la lista Revendedores · c3 con la lista y descuento personal 10 % · c4 mayorista con la lista
insert into clientes (id, organizacion_id, numero, nombre, tipo, descuento) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente sin lista', 'minorista', null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente con lista', 'minorista', null),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente lista y descuento', 'minorista', 10),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Mayorista con lista', 'mayorista', null);
update clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000001'
 where id in ('c5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-000000000004');

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');
-- P1 $1.000 · P2 $1.000 con precio propio 950 en la tienda A · P3 $1.000 con escala x5 = 800 · P4 $1.000 (promociones)
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'P-' || n, 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 4) n;
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'x5', 800);

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 100, 0 from generate_series(1, 4) n
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, (select principal from datos), '11111111-1111-1111-1111-111111111111', 100, 0
  from generate_series(1, 4) n
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function pg_temp.bandera(p_clave text, p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = p_clave;
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;
create function pg_temp.crear(p_clave text, p_tipo text, p_cliente uuid) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, 'a1000000-0000-0000-0000-000000000001', p_cliente, 'mostrador', '2027-03-01');
  insert into comps (clave, id) values (p_clave, v_c.id);
end $$;
create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante((select id from comps where clave = p_clave), p_lineas, pg_temp.upd(p_clave));
end $$;
create function pg_temp.l(p_n integer, p_cant integer, p_manual numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'producto_id', 'b1000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'), 'cantidad', p_cant, 'precio_manual', p_manual));
$$;
-- «unitario|descuento|lista|pct» de la línea de un orden (security definer: lee sin RLS).
create function pg_temp.lin(p_clave text, p_orden integer) returns text language sql security definer as $$
  select l.precio_unitario::text || '|' || l.descuento_pct::text || '|' || coalesce((l.lista_precio_id = 'd1000000-0000-0000-0000-000000000001')::text, '-')
         || '|' || coalesce(l.lista_ajuste_pct::text, '-')
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave) and l.orden = p_orden
$$;
grant execute on function pg_temp.lin(text, integer), pg_temp.upd(text), pg_temp.id_de(text) to public;

-- ============================================================================
-- Estructura (T014)
-- ============================================================================

select has_column('dominio', 'comprobantes_venta_lineas', 'lista_precio_id', 'la línea tiene lista_precio_id');
select has_column('dominio', 'comprobantes_venta_lineas', 'lista_ajuste_pct', 'la línea tiene lista_ajuste_pct');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'lista_precio_id', 'lista_precio_id es nulable');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'lista_ajuste_pct', 'lista_ajuste_pct es nulable');
select col_type_is('dominio', 'comprobantes_venta_lineas', 'lista_ajuste_pct', 'numeric(5,2)', 'el porcentaje es numeric(5,2) como el de la lista');
select is((select count(*)::int from pg_constraint where conname = 'comprobantes_venta_lineas_lista_fk' and contype = 'f'
             and conrelid = 'dominio.comprobantes_venta_lineas'::regclass and confrelid = 'dominio.listas_precios'::regclass
             and array_length(conkey, 1) = 2 and confdeltype = 'a'), 1, 'FK compuesta (lista, organización) a listas_precios, sin cascada');
select is((select count(*)::int from pg_indexes where schemaname = 'dominio' and indexname = 'comprobantes_venta_lineas_lista_idx'), 1, 'índice parcial de la lista');
select is((select count(*)::int from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
             and (has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'lista_precio_id', 'select')
                  is distinct from has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'precio_referencia', 'select')
               or has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'lista_precio_id', 'insert')
                  is distinct from has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'precio_referencia', 'insert')
               or has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'lista_ajuste_pct', 'update')
                  is distinct from has_column_privilege(r.rolname, 'dominio.comprobantes_venta_lineas', 'precio_referencia', 'update'))), 0,
  'las columnas nuevas tienen los mismos privilegios que precio_referencia para anon, authenticated y service_role');
select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'lista_precio_id', 'insert'), false, 'authenticated no inserta la lista de la línea');
select is(has_column_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'lista_ajuste_pct', 'update'), false, 'authenticated no actualiza el porcentaje de la línea');
select is(has_column_privilege('anon', 'dominio.comprobantes_venta_lineas', 'lista_precio_id', 'select'), false, 'anon no lee la lista de la línea');

-- ============================================================================
-- Bandera APAGADA: todo igual que hoy, sin snapshot
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('apagada', 'factura', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('apagada', jsonb_build_array(pg_temp.l(1, 2)));
select is(pg_temp.lin('apagada', 1), '1000.00|0.00|-|-', 'bandera apagada: el cliente con lista paga 1000 y la línea no guarda lista');
select pg_temp.crear('apagada_desc', 'factura', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.guardar('apagada_desc', jsonb_build_array(pg_temp.l(1, 1)));
select is(pg_temp.lin('apagada_desc', 1), '900.00|10.00|-|-', 'bandera apagada: el descuento personal rige como siempre (900)');

-- ============================================================================
-- Bandera ENCENDIDA: guardar_lineas_comprobante (CA-CLI-21-2…4, 6)
-- ============================================================================

select pg_temp.bandera('listas_precios', true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('fact', 'factura', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('fact', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(2, 1), pg_temp.l(1, 1, 700)));
select is(pg_temp.lin('fact', 1), '800.00|0.00|true|-20.00', 'CA-CLI-21-2 · la línea sale a 1000 × 0,80 y guarda lista y porcentaje');
select is(pg_temp.lin('fact', 2), '950.00|0.00|-|-', 'CA-CLI-21-3 · precio propio de la tienda: 950, sin lista');
select is(pg_temp.lin('fact', 3), '700.00|0.00|-|-', 'el precio manual manda y no lleva lista');
select is((select c.total_sin_iva from dominio.comprobantes_venta c where c.id = pg_temp.id_de('fact')), 3250.00::numeric, 'el total suma 2 × 800 + 950 + 700');

select pg_temp.crear('may', 'factura', 'c5000000-0000-0000-0000-000000000004');
select pg_temp.guardar('may', jsonb_build_array(pg_temp.l(3, 5), pg_temp.l(3, 1)));
select is(pg_temp.lin('may', 1), '800.00|0.00|-|-', 'CA-CLI-21-3 · mayorista con escala x5 cargada: rige la escala (800) y no guarda lista');
select is(pg_temp.lin('may', 2), '800.00|0.00|true|-20.00', 'el mayorista que compra 1 paga la lista (800) y guarda el snapshot');

select pg_temp.crear('desc', 'factura', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.guardar('desc', jsonb_build_array(pg_temp.l(1, 1), pg_temp.l(2, 1)));
select is(pg_temp.lin('desc', 1), '800.00|0.00|true|-20.00', 'CA-CLI-21-4 · lista y descuento personal: rige la lista y no se descuenta');
select is(pg_temp.lin('desc', 2), '855.00|10.00|-|-', 'CA-CLI-21-4 · con precio propio sí rige el descuento personal (950 − 10 %)');

select pg_temp.crear('sin', 'factura', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.guardar('sin', jsonb_build_array(pg_temp.l(1, 1), pg_temp.l(2, 1)));
select is(pg_temp.lin('sin', 1), '1000.00|0.00|-|-', 'CA-CLI-21-6 · cliente sin lista con la bandera encendida: 1000 como siempre');
select is(pg_temp.lin('sin', 2), '950.00|0.00|-|-', 'CA-CLI-21-6 · y el precio propio igual');

-- Recalcular al guardar de nuevo (el borrador sigue la lista vigente).
select pg_temp.bandera('listas_precios', false);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('fact', jsonb_build_array(pg_temp.l(1, 2)));
select is(pg_temp.lin('fact', 1), '1000.00|0.00|-|-', 'apagar la bandera y guardar de nuevo recalcula el borrador sin lista');
select pg_temp.bandera('listas_precios', true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('fact', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(2, 1)));
select is(pg_temp.lin('fact', 1), '800.00|0.00|true|-20.00', 'encender la bandera y guardar de nuevo vuelve a la lista');

-- obtener_comprobante: la marca de la pantalla (RF-CLI-21-6).
select is(public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 0 ->> 'lista_nombre', 'Revendedores', 'obtener_comprobante expone el nombre de la lista');
select is((public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 0 ->> 'lista_ajuste_pct')::numeric, -20::numeric, 'y el porcentaje congelado');
select is(public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 1 -> 'lista_nombre', 'null'::jsonb, 'una línea sin lista trae lista_nombre nulo');
select is(public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 1 -> 'lista_ajuste_pct', 'null'::jsonb, 'y lista_ajuste_pct nulo');
select ok((public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 0) ?& array['id', 'orden', 'precio_unitario', 'escala', 'precio_manual', 'descuento_pct', 'precio_referencia', 'sin_stock', 'subtotal_sin_iva', 'iva'],
  'obtener_comprobante conserva las claves existentes de cada línea');
select is((public.obtener_comprobante(pg_temp.id_de('fact')) -> 'lineas' -> 0) ? 'lista_precio_id', false, 'obtener_comprobante no expone el id de la lista');
select ok(public.obtener_comprobante(pg_temp.id_de('fact')) ?& array['de_tienda', 'operador', 'cliente', 'total_sin_iva'], 'y conserva las claves del encabezado (de_tienda incluida)');

-- Aislamiento: el operador no puede inyectar la lista por el payload.
select pg_temp.guardar('fact', jsonb_build_array(jsonb_build_object(
  'producto_id', 'b1000000-0000-0000-0000-000000000001', 'cantidad', 1, 'lista_precio_id', 'd2000000-0000-0000-0000-000000000001', 'lista_ajuste_pct', -50)));
select is(pg_temp.lin('fact', 1), '800.00|0.00|true|-20.00', 'las claves lista_* dentro de p_lineas se ignoran: la lista sale del cliente');

-- ============================================================================
-- D12: lo confirmado no cambia
-- ============================================================================

select pg_temp.guardar('fact', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(2, 1)));
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('fact')), 'se confirma la factura con lista');
reset role;
update dominio.listas_precios set ajuste_pct = -30 where id = 'd1000000-0000-0000-0000-000000000001';
select is(pg_temp.lin('fact', 1), '800.00|0.00|true|-20.00', 'D12 · cambiar el porcentaje de la lista no cambia la línea confirmada (ni su snapshot)');
update public.clientes set lista_precio_id = null where id = 'c5000000-0000-0000-0000-000000000002';
select is(pg_temp.lin('fact', 1), '800.00|0.00|true|-20.00', 'D12 · quitar la lista al cliente tampoco');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('nueva', 'factura', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('nueva', jsonb_build_array(pg_temp.l(1, 1)));
select is(pg_temp.lin('nueva', 1), '1000.00|0.00|-|-', 'CA-CLI-21-8 · sin lista el cliente vuelve al precio normal desde la próxima línea');
reset role;
update public.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000001' where id = 'c5000000-0000-0000-0000-000000000002';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('nueva', jsonb_build_array(pg_temp.l(1, 1)));
select is(pg_temp.lin('nueva', 1), '700.00|0.00|true|-30.00', 'el borrador se recalcula con el porcentaje nuevo de la lista (1000 × 0,70) y congela -30');

-- ============================================================================
-- copiar_presupuesto
-- ============================================================================

select pg_temp.crear('pres', 'presupuesto', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('pres', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(2, 1), pg_temp.l(1, 1, 650)));
create temp table copias (clave text primary key, id uuid);
grant select, insert on copias to public;
insert into copias select 'c1', c.id from public.copiar_presupuesto(pg_temp.id_de('pres')) c;
select is((select string_agg(l.precio_unitario::text || ':' || coalesce(l.lista_ajuste_pct::text, '-'), ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from copias where clave = 'c1')),
  '700.00:-30.00 950.00:- 650.00:-', 'copiar presupuesto: reprecia con la lista (700), conserva el precio propio y el manual, y guarda el snapshot');
reset role;
update dominio.listas_precios set ajuste_pct = -10 where id = 'd1000000-0000-0000-0000-000000000001';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into copias select 'c2', c.id from public.copiar_presupuesto(pg_temp.id_de('pres')) c;
select is((select l.precio_unitario::text || ':' || l.lista_ajuste_pct::text from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = (select id from copias where clave = 'c2') and l.orden = 1), '900.00:-10.00', 'la copia usa el porcentaje vigente de la lista en ese momento');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('pres') and lista_precio_id is not null), 1,
  'el presupuesto original no se modifica al copiarlo (su línea con lista conserva el snapshot -30)');
reset role;
update dominio.listas_precios set ajuste_pct = -20 where id = 'd1000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Notas de crédito: reutilizan el snapshot (la devolución es al precio cobrado)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('nc', 'factura', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('nc', jsonb_build_array(pg_temp.l(1, 3), pg_temp.l(2, 1)));
select public.confirmar_comprobante(pg_temp.id_de('nc'));
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
create function pg_temp.linea_de(p_clave text, p_orden integer) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave) and l.orden = p_orden $$;
grant execute on function pg_temp.linea_de(text, integer) to public;
select lives_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('nc'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('nc', 1), 'cantidad', 2), jsonb_build_object('linea_id', pg_temp.linea_de('nc', 2), 'cantidad', 1))::text),
  'nota de crédito de devolución sobre una factura con lista');
select is((select l.precio_unitario::text || '|' || (l.lista_precio_id = 'd1000000-0000-0000-0000-000000000001')::text || '|' || l.lista_ajuste_pct::text
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc') and l.orden = 1), '800.00|true|-20.00',
  'la nota devuelve al precio cobrado (800) y hereda lista_precio_id y lista_ajuste_pct');
select is((select l.lista_precio_id is null and l.lista_ajuste_pct is null
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc') and l.orden = 2), true, 'la línea sin lista de la nota queda sin lista');
reset role;
update dominio.listas_precios set ajuste_pct = -45 where id = 'd1000000-0000-0000-0000-000000000001';
select is((select l.lista_ajuste_pct from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc') and l.orden = 1), -20.00::numeric, 'cambiar la lista después no mueve el snapshot de la nota');
update dominio.listas_precios set ajuste_pct = -20 where id = 'd1000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Validación de la confirmación: compara contra el precio normal CON la lista
-- ============================================================================

select pg_temp.bandera('promociones_precio', true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('guarda', 'factura', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('guarda_sin', 'factura', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.guardar('guarda', jsonb_build_array(pg_temp.l(4, 1)));
select pg_temp.guardar('guarda_sin', jsonb_build_array(pg_temp.l(4, 1)));
select is(pg_temp.lin('guarda', 1), '800.00|0.00|true|-20.00', 'el borrador con lista quedó a 800 (sin promoción)');
reset role;
-- Promoción de 900 sobre el producto 4: MAYOR que la lista (800) pero MENOR que el precio sin lista (1000).
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 900, now() - interval '1 day', now() + interval '1 day');
select is(private.lineas_con_promocion_desactualizada(pg_temp.id_de('guarda'), now()), 0,
  'la guarda de confirmación: una promoción de 900 no mejora el precio de lista (800): el comprobante no está desactualizado');
select is(private.lineas_con_promocion_desactualizada(pg_temp.id_de('guarda_sin'), now()), 1,
  'y para el cliente sin lista (1000) la misma promoción sí lo desactualiza');
update dominio.promociones_precio set precio_promocional = 500 where producto_id = 'b1000000-0000-0000-0000-000000000004';
select is(private.lineas_con_promocion_desactualizada(pg_temp.id_de('guarda'), now()), 1,
  'una promoción de 500 (menor que la lista) sí desactualiza el comprobante con lista');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('guarda')), '40001', null,
  'confirmar rechaza el comprobante cuyo precio cambió por una promoción menor a la lista (precios_cambiaron)');

select * from finish();
rollback;
