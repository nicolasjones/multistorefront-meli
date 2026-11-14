-- MSF-816 / F-3 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes): el ciclo de la venta con precio
-- promocional: confirmación, presupuestos, notas de crédito, saldo y cobros, motos y edición manual.
-- Cubre T014 (guarda de `confirmar_comprobante`, FR-009), T016 (FR-008), T017 (FR-012, SC-002) y T018 (FR-019):
--   · la guarda rechaza con 40001 / hint `precios_cambiaron` SIN efectos (estado, stock, movimientos, costos, cobros y
--     eventos intactos) cuando una promoción cobrada venció, hay una nueva, la sustituyó otra (aun con el mismo precio) o
--     se editó el precio promocional (diferencia de 0,01, mayor que la tolerancia de 0,005);
--   · la guarda corre ANTES del movimiento de stock (con stale + sin stock gana `precios_cambiaron`);
--   · omite líneas manuales, sin stock, de producto en dólares sin cotización; usa el descuento del cliente y la tienda del comprobante;
--   · con la bandera apagada no actúa, tampoco sobre un borrador guardado con promoción; al reencender rechaza una vez;
--   · confirmación idempotente (un solo movimiento, un solo evento; la confirmada no pasa por la guarda);
--   · aislamiento entre organizaciones y tiendas, y permisos (la función auxiliar no la ejecuta nadie);
--   · presupuestos: `aceptar_presupuesto` no reprecia, un pendiente conserva el precio hasta que se edita;
--   · nota de crédito, saldo neto, cobros, contrarreembolso de motos, IVA 21 % y exento sobre facturas promocionales;
--   · edición manual: sin `editar_precio` 42501; con permiso manda sobre la promoción y deja `comprobante.editado`;
--   · medición de 200 líneas en `confirmar_comprobante`, bandera apagada contra encendida (< 1,5×, mediana de 5).
-- El fixture corre como postgres (RLS no aplica); las verificaciones, con el rol que corresponda.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('f1000000-0000-0000-0000-000000000004', 'mixto@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

-- OP (f…02) opera en A; consulta (f…03) en A; «mixto» (f…04) es mostrador en A (sin `editar_precio`) y operador en B.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

-- c2 minorista sin descuento; c4 minorista 15 %; c9 de la organización dos.
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, descuento) values
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista', null, null),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Cliente 15 %', 'minorista', null, 15),
  ('c5000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 10, 'Cliente org dos', 'minorista', null, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- Q1…Q26 de lista $1.000 sin IVA (categoría 21 %) salvo Q17 (exento, $500). Costo $400 en pesos para ver el costo guardado.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'Q-' || n, 'ARS', case when n = 17 then 500 else 1000 end,
       'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 26) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b4000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Teclado ajeno', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000001', null, true);
update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'b3000000-0000-0000-0000-000000000017';
insert into dominio.producto_costos (producto_id, organizacion_id, costo)
select id, organizacion_id, 400 from dominio.productos where sku like 'Q-%' and organizacion_id = '11111111-1111-1111-1111-111111111111';

-- 200 productos para la medición de rendimiento (lista $1.000).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b3000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Masivo ' || n, 'M-' || n, 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 200) n;

-- Depósitos: el principal vende para A y para B.
create temp table datos as
  select
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as principal_dos;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, e, '11111111-1111-1111-1111-111111111111'
  from datos, (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000002'::uuid)) v(e)
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal_dos, 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222' from datos
on conflict do nothing;

-- Stock: 50 de cada Q (Q12 con 1 para probar el orden de la guarda) y 100 de cada masivo; la organización dos, 10.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p.id, p.organizacion_id, case when p.sku = 'Q-12' then 1 when p.sku like 'M-%' then 100 when p.sku like 'Q-%' then 50 else 10 end, 0
  from dominio.productos p where p.sku ~ '^(Q-|M-|TEC-)'
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.id, case when p.organizacion_id = '11111111-1111-1111-1111-111111111111' then (select principal from datos) else (select principal_dos from datos) end,
       p.organizacion_id, case when p.sku = 'Q-12' then 1 when p.sku like 'M-%' then 100 when p.sku like 'Q-%' then 50 else 10 end, 0
  from dominio.productos p where p.sku ~ '^(Q-|M-|TEC-)'
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

-- Formas de pago para cobros y contrarreembolso; forma de envío moto de la tienda A.
insert into dominio.formas_pago (id, organizacion_id, empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, activo) values
  ('9a000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Contrarreembolso', 'contrarreembolso', false, false, true),
  ('9a000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Efectivo', 'efectivo', false, false, true);
insert into dominio.formas_envio (id, organizacion_id, empresa_id, nombre, tipo) values
  ('b1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'Moto', 'moto');

-- Solo para leer en las aserciones (la app lee por `obtener_comprobante`).
grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.bandera(p_activa boolean) returns void language plpgsql as $$
begin
  reset role;
  update public.banderas_plataforma set activa = p_activa where clave = 'promociones_precio';
end $$;

create temp table comps (clave text primary key, id uuid);
grant select, insert, update on comps to public;

create function pg_temp.crear(p_clave text, p_tipo text, p_empresa uuid, p_cliente uuid) returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante(p_tipo, p_empresa, p_cliente, 'mostrador', '2027-03-01');
  insert into comps (clave, id) values (p_clave, v_c.id);
end $$;

create function pg_temp.id_de(p_clave text) returns uuid language sql as $$ select id from comps where clave = p_clave $$;
create function pg_temp.upd(p_clave text) returns timestamptz language sql security definer as $$
  select updated_at from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave) $$;
create function pg_temp.guardar(p_clave text, p_lineas jsonb) returns void language plpgsql as $$
begin
  perform public.guardar_lineas_comprobante((select id from comps where clave = p_clave), p_lineas, pg_temp.upd(p_clave));
end $$;
-- Una línea del producto Qn (o Mn con p_masivo) y cantidad dados.
create function pg_temp.q(p_n integer, p_cant integer, p_manual numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'producto_id', 'b3000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'), 'cantidad', p_cant, 'precio_manual', p_manual));
$$;
create function pg_temp.pq(p_n integer) returns uuid language sql as $$
  select ('b3000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;

-- Una tanda de promociones del fixture (como postgres): vigente de ayer a mañana.
create function pg_temp.promo(p_id text, p_n integer, p_empresa uuid, p_precio numeric) returns void language plpgsql security definer as $$
begin
  insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
  values (p_id::uuid, '11111111-1111-1111-1111-111111111111', p_empresa, pg_temp.pq(p_n), p_precio, now() - interval '30 minutes', now() + interval '1 day');
end $$;
create function pg_temp.vencer(p_id text) returns void language plpgsql security definer as $$
begin
  update dominio.promociones_precio set desde = now() - interval '3 days', hasta = now() - interval '1 hour' where id = p_id::uuid;
end $$;
create function pg_temp.anular(p_id text) returns void language plpgsql security definer as $$
begin
  update dominio.promociones_precio set anulada_at = now() where id = p_id::uuid;
end $$;
grant execute on function pg_temp.promo(text, integer, uuid, numeric), pg_temp.vencer(text), pg_temp.anular(text) to public;

-- «unitario|referencia|descuento_pct|escala|manual» de la primera línea y su promoción.
create function pg_temp.res(p_clave text) returns text language sql security definer as $$
  select l.precio_unitario::text || '|' || coalesce(l.precio_referencia::text, '-') || '|' || l.descuento_pct::text
         || '|' || l.escala || '|' || l.precio_manual::text
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave)
   order by l.orden limit 1;
$$;
create function pg_temp.promo_de(p_clave text) returns uuid language sql security definer as $$
  select l.promocion_id from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave) order by l.orden limit 1;
$$;
create function pg_temp.total(p_clave text) returns text language sql security definer as $$
  select c.total_sin_iva::text || '/' || c.total_con_iva::text from dominio.comprobantes_venta c
   where c.id = (select id from comps where clave = p_clave) $$;
create function pg_temp.estado(p_clave text) returns text language sql security definer as $$
  select c.estado from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave) $$;
-- La función auxiliar la ejecuta el dueño: se la llama desde acá (security definer del fixture).
create function pg_temp.aux(p_clave text, p_ahora timestamptz default null) returns integer language plpgsql security definer as $$
begin
  return private.lineas_con_promocion_desactualizada((select id from comps where clave = p_clave), coalesce(p_ahora, now()));
end $$;
-- Resultado de ejecutar una sentencia: 'ok' o 'sqlstate|hint|mensaje'.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_hint text; v_msg text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  return sqlstate || '|' || coalesce(v_hint, '') || '|' || v_msg;
end $$;
create function pg_temp.conf(p_clave text) returns text language sql as $$
  select pg_temp.err(format('select public.confirmar_comprobante(%L)', (select id from comps where clave = p_clave)))
$$;
-- Foto de todo lo que una confirmación podría tocar: estado, stock de la organización, movimientos y reservas,
-- costos de las líneas, cobros del comprobante y eventos de confirmación.
create function pg_temp.snap(p_clave text) returns text language sql security definer as $$
  select c.estado || '|' || (c.confirmado_en is null)::text || '|' || c.updated_at::text
      || '|stock=' || (select coalesce(sum(x.cantidad), 0) + coalesce(sum(x.reservado), 0) from dominio.existencias_deposito x where x.organizacion_id = c.organizacion_id)
      || '|mov=' || (select count(*) from dominio.movimientos_stock m where m.organizacion_id = c.organizacion_id)
      || '|res=' || (select count(*) from dominio.reservas_stock r where r.organizacion_id = c.organizacion_id)
      || '|costos=' || (select count(*) from dominio.comprobantes_venta_lineas l where l.comprobante_id = c.id and l.costo_unitario is not null)
      || '|cobros=' || (select count(*) from dominio.cobros_comprobante b where b.comprobante_id = c.id)
      || '|eventos=' || (select count(*) from public.registro_actividad a where a.organizacion_id = c.organizacion_id and a.tipo = 'comprobante.confirmado')
    from dominio.comprobantes_venta c where c.id = (select id from comps where clave = p_clave)
$$;
create function pg_temp.stock_de(p_n integer) returns integer language sql security definer as $$
  select cantidad from dominio.existencias_deposito where producto_id = pg_temp.pq(p_n) $$;
create function pg_temp.movs_de(p_n integer) returns integer language sql security definer as $$
  select count(*)::int from dominio.movimientos_stock where producto_id = pg_temp.pq(p_n) $$;
grant execute on function pg_temp.res(text), pg_temp.promo_de(text), pg_temp.total(text), pg_temp.estado(text), pg_temp.aux(text, timestamptz),
  pg_temp.snap(text), pg_temp.stock_de(integer), pg_temp.movs_de(integer), pg_temp.upd(text), pg_temp.id_de(text) to public;

create function pg_temp.msg_c() returns text language sql as $$
  select '40001|precios_cambiaron|Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total' $$;

select pg_temp.bandera(true);

-- ============================================================================
-- Contrato de la función auxiliar y de la bandera
-- ============================================================================

select is((select p.prosecdef from pg_proc p where p.oid = 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)'::regprocedure), true,
  'la función auxiliar es security definer');
select ok((select 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)'::regprocedure),
  'la función auxiliar fija search_path = ''''');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)'::regprocedure and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE'), 0,
  'nadie fuera del dueño ejecuta la función auxiliar (ni public, anon, authenticated ni service_role)');
select ok(not has_function_privilege('authenticated', 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)', 'execute'), 'authenticated no la ejecuta');
select ok(not has_function_privilege('anon', 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)', 'execute'), 'anon no la ejecuta');
select ok(not has_function_privilege('service_role', 'private.lineas_con_promocion_desactualizada(uuid, timestamptz)', 'execute'), 'service_role no la ejecuta');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok($$select private.lineas_con_promocion_desactualizada(gen_random_uuid(), now())$$, '42501', null,
  'authenticated recibe 42501 al llamar la función auxiliar');
select is(pg_temp.err($$select private.lineas_con_promocion_desactualizada(gen_random_uuid(), now())$$) like '42501%', true, 'sin execute: el mismo 42501 por el helper');
reset role;
select is(private.lineas_con_promocion_desactualizada(gen_random_uuid(), now()), 0, 'un comprobante inexistente cuenta 0 líneas desactualizadas');

-- ============================================================================
-- S1 · promoción vencida entre el guardado y el cobro: rechazo sin efectos, re-guardado y cobro
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000001', 1, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s1', jsonb_build_array(pg_temp.q(1, 2)));
select is(pg_temp.res('s1'), '800.00|1000.00|0.00|x1|false', 'S1: el borrador quedó con la promoción (800, referencia 1000)');
select is(pg_temp.aux('s1'), 0, 'S1: con la promoción vigente no hay líneas desactualizadas');
select is(pg_temp.aux('s1', now() + interval '10 days'), 1, 'S1: evaluada a futuro (promoción vencida) la línea figura desactualizada');
create temp table fotos (clave text primary key, foto text);
grant select, insert, update on fotos to public;
insert into fotos select 's1', pg_temp.snap('s1');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000001');
select is(pg_temp.aux('s1'), 1, 'S1: vencida la promoción, una línea desactualizada');
select is(pg_temp.conf('s1'), pg_temp.msg_c(), 'S1: confirmar rechaza con 40001, hint precios_cambiaron y el mensaje del contrato');
select is(pg_temp.snap('s1'), (select foto from fotos where clave = 's1'), 'S1: el rechazo no deja rastro (estado, stock, movimientos, reservas, costos, cobros y eventos intactos)');
select is(pg_temp.estado('s1'), 'borrador', 'S1: la factura sigue en borrador');
select is(pg_temp.stock_de(1), 50, 'S1: el stock no se movió');
select is(pg_temp.conf('s1'), pg_temp.msg_c(), 'S1: un segundo intento sin re-guardar vuelve a rechazar');
select pg_temp.guardar('s1', jsonb_build_array(pg_temp.q(1, 2)));
select is(pg_temp.res('s1'), '1000.00|-|0.00|x1|false', 'S1: el re-guardado reprecia al precio normal sin promoción');
select is(pg_temp.promo_de('s1'), null::uuid, 'S1: la línea ya no guarda promoción');
select is(pg_temp.conf('s1'), 'ok', 'S1: tras re-guardar se confirma');
select is(pg_temp.estado('s1'), 'confirmada', 'S1: confirmada');
select is(pg_temp.total('s1'), '2000.00/2420.00', 'S1: total con el precio nuevo');
select is(pg_temp.stock_de(1), 48, 'S1: el stock bajó 2');

-- ============================================================================
-- S2 · promoción nueva (más baja) sobre un borrador guardado sin promoción
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s2', jsonb_build_array(pg_temp.q(2, 1)));
select is(pg_temp.res('s2'), '1000.00|-|0.00|x1|false', 'S2: sin promoción al guardar');
insert into fotos select 's2', pg_temp.snap('s2');
select pg_temp.promo('e3000000-0000-0000-0000-000000000002', 2, 'a1000000-0000-0000-0000-000000000001', 700);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s2'), pg_temp.msg_c(), 'S2: una promoción nueva más baja rechaza la confirmación');
select is(pg_temp.snap('s2'), (select foto from fotos where clave = 's2'), 'S2: sin efectos');
select pg_temp.guardar('s2', jsonb_build_array(pg_temp.q(2, 1)));
select is(pg_temp.res('s2'), '700.00|1000.00|0.00|x1|false', 'S2: el re-guardado toma la promoción nueva');
select is(pg_temp.conf('s2'), 'ok', 'S2: y se confirma');

-- ============================================================================
-- S3 · otra promoción sustituye a la cobrada (distinto precio); S4 · otra con el MISMO precio (se compara por id)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000003', 3, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000004', 4, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s3', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s3', jsonb_build_array(pg_temp.q(3, 1)));
select pg_temp.crear('s4', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s4', jsonb_build_array(pg_temp.q(4, 1)));
select is(pg_temp.promo_de('s3'), 'e3000000-0000-0000-0000-000000000003'::uuid, 'S3: guardada con la promoción 3');
insert into fotos select 's3', pg_temp.snap('s3');
insert into fotos select 's4', pg_temp.snap('s4');
select pg_temp.anular('e3000000-0000-0000-0000-000000000003');
select pg_temp.promo('e3000000-0000-0000-0000-000000000033', 3, 'a1000000-0000-0000-0000-000000000001', 700);
select pg_temp.anular('e3000000-0000-0000-0000-000000000004');
select pg_temp.promo('e3000000-0000-0000-0000-000000000044', 4, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s3'), pg_temp.msg_c(), 'S3: otra promoción (700) sustituyó a la cobrada (800): rechaza');
select is(pg_temp.snap('s3'), (select foto from fotos where clave = 's3'), 'S3: sin efectos');
select is(pg_temp.conf('s4'), pg_temp.msg_c(), 'S4: otra promoción con el MISMO precio (distinto id) también rechaza: se compara por promocion_id');
select is(pg_temp.snap('s4'), (select foto from fotos where clave = 's4'), 'S4: sin efectos');
select pg_temp.guardar('s4', jsonb_build_array(pg_temp.q(4, 1)));
select is(pg_temp.promo_de('s4'), 'e3000000-0000-0000-0000-000000000044'::uuid, 'S4: el re-guardado toma la promoción vigente (la nueva)');
select is(pg_temp.conf('s4'), 'ok', 'S4: y se confirma');

-- ============================================================================
-- S5 · precio promocional editado (misma promoción, otro precio): 0,01 supera la tolerancia de 0,005
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000005', 5, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s5', jsonb_build_array(pg_temp.q(5, 1)));
select is(pg_temp.aux('s5'), 0, 'S5: sin cambios no hay diferencias');
insert into fotos select 's5', pg_temp.snap('s5');
reset role;
update dominio.promociones_precio set precio_promocional = 799.99 where id = 'e3000000-0000-0000-0000-000000000005';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.aux('s5'), 1, 'S5: la misma promoción con 0,01 de diferencia cuenta como desactualizada (tolerancia 0,005)');
select is(pg_temp.conf('s5'), pg_temp.msg_c(), 'S5: un precio promocional editado rechaza');
select is(pg_temp.snap('s5'), (select foto from fotos where clave = 's5'), 'S5: sin efectos');
select pg_temp.guardar('s5', jsonb_build_array(pg_temp.q(5, 1)));
select is(pg_temp.res('s5'), '799.99|1000.00|0.00|x1|false', 'S5: el re-guardado toma el precio editado');

-- ============================================================================
-- S6 · confirmación normal, idempotente; una confirmada no pasa por la guarda
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000006', 6, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s6', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s6', jsonb_build_array(pg_temp.q(6, 2)));
insert into fotos select 's6antes', pg_temp.snap('s6');
select is(pg_temp.conf('s6'), 'ok', 'S6: la confirmación normal con promoción vigente pasa');
select is(pg_temp.estado('s6'), 'confirmada', 'S6: confirmada');
select is(pg_temp.total('s6'), '1600.00/1936.00', 'S6: total promocional (2 × 800 + IVA 21 %)');
select is(pg_temp.stock_de(6), 48, 'S6: el stock bajó 2');
select is(pg_temp.movs_de(6), 1, 'S6: un movimiento de stock');
select is((select l.costo_unitario from dominio.comprobantes_venta_lineas l where l.comprobante_id = pg_temp.id_de('s6')), 400.00::numeric, 'S6: costo guardado');
select is((select count(*)::int from public.registro_actividad where tipo = 'comprobante.confirmado' and detalle like '%' || (select numero from dominio.comprobantes_venta where id = pg_temp.id_de('s6')) || '%'), 1, 'S6: un evento de confirmación');
insert into fotos select 's6despues', pg_temp.snap('s6');
select is(pg_temp.conf('s6'), 'ok', 'S6: reintentar devuelve la factura confirmada (idempotente)');
select is(pg_temp.snap('s6'), (select foto from fotos where clave = 's6despues'), 'S6: el reintento no duplica movimientos, costos ni eventos');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000006');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s6'), 'ok', 'S6: una factura ya confirmada no pasa por la guarda aunque la promoción venza después');
select is(pg_temp.snap('s6'), (select foto from fotos where clave = 's6despues'), 'S6: y no cambia nada');
select is(pg_temp.promo_de('s6'), 'e3000000-0000-0000-0000-000000000006'::uuid, 'S6: la línea emitida conserva su promoción');
select is(pg_temp.total('s6'), '1600.00/1936.00', 'S6: ni su total');

-- ============================================================================
-- S7 manual, S8 producto sin precio, S9 línea sin stock: se omiten de la guarda
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000007', 7, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000008', 8, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000009', 9, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s7', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s7', jsonb_build_array(pg_temp.q(7, 1, 700)));
select is(pg_temp.res('s7'), '700.00|-|0.00|x1|true', 'S7: el precio manual manda sobre la promoción, sin referencia');
select pg_temp.crear('s8', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s8', jsonb_build_array(pg_temp.q(8, 1)));
select pg_temp.crear('s9', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s9', jsonb_build_array(pg_temp.q(9, 1), pg_temp.q(1, 1)));
reset role;
update dominio.productos set moneda = 'USD' where id = pg_temp.pq(8);
update dominio.comprobantes_venta_lineas set sin_stock = true where comprobante_id = pg_temp.id_de('s9') and producto_id = pg_temp.pq(9);
select pg_temp.vencer('e3000000-0000-0000-0000-000000000007');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000008');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000009');
select pg_temp.promo('e3000000-0000-0000-0000-000000000077', 7, 'a1000000-0000-0000-0000-000000000001', 600);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.aux('s7'), 0, 'S7: la línea manual se omite aunque la promoción venció y hay una nueva más baja');
select is(pg_temp.conf('s7'), 'ok', 'S7: la factura con precio manual se confirma');
select is(pg_temp.total('s7'), '700.00/847.00', 'S7: cobra el manual');
select is(pg_temp.aux('s8'), 0, 'S8: una línea sin precio calculable (producto en dólares sin cotización) se omite');
select is(pg_temp.conf('s8'), 'ok', 'S8: y la factura se confirma');
select is(pg_temp.aux('s9'), 0, 'S9: una línea sin_stock se omite aunque su promoción venció');
select is(pg_temp.conf('s9'), 'ok', 'S9: y se confirma');
select is(pg_temp.movs_de(9), 0, 'S9: la línea sin stock no movió stock');

-- ============================================================================
-- S10 · bandera apagada con un borrador guardado con promoción; S11 · reencendido
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000010', 10, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000011', 11, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s10', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s10', jsonb_build_array(pg_temp.q(10, 1)));
select pg_temp.crear('s11', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s11', jsonb_build_array(pg_temp.q(11, 1)));
select pg_temp.bandera(false);
select pg_temp.vencer('e3000000-0000-0000-0000-000000000010');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000011');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.aux('s10'), 0, 'S10: con la bandera apagada la función auxiliar no cuenta nada');
select is(pg_temp.conf('s10'), 'ok', 'S10: bandera apagada: el borrador con promoción vencida se confirma (la guarda no actúa)');
select is(pg_temp.total('s10'), '800.00/968.00', 'S10: conserva su precio promocional hasta el próximo guardado');
select is(pg_temp.promo_de('s10'), 'e3000000-0000-0000-0000-000000000010'::uuid, 'S10: y su promocion_id');
select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s11'), pg_temp.msg_c(), 'S11: al reencender la bandera el borrador con promoción vencida se rechaza una vez');
select pg_temp.guardar('s11', jsonb_build_array(pg_temp.q(11, 1)));
select is(pg_temp.res('s11'), '1000.00|-|0.00|x1|false', 'S11: se reprecia al guardar');
select is(pg_temp.conf('s11'), 'ok', 'S11: y se confirma');

-- ============================================================================
-- S12 · la guarda corre ANTES del movimiento de stock
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000012', 12, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s12', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s12', jsonb_build_array(pg_temp.q(12, 5)));
select pg_temp.vencer('e3000000-0000-0000-0000-000000000012');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s12'), pg_temp.msg_c(), 'S12: precios cambiados y sin stock suficiente: gana precios_cambiaron (la guarda va antes del movimiento de stock)');
select pg_temp.guardar('s12', jsonb_build_array(pg_temp.q(12, 5)));
select is(pg_temp.conf('s12'), 'P0001|stock|No hay stock suficiente de Producto 12 en el depósito Depósito principal: hay 1 y la factura pide 5'
  , 'S12: control: ya repreciada, el faltante de stock sigue rechazando igual que antes (P0001 / stock)');

-- ============================================================================
-- S13 · descuento del cliente (la guarda usa el mismo descuento que el guardado)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000013', 13, 'a1000000-0000-0000-0000-000000000001', 900);
select pg_temp.promo('e3000000-0000-0000-0000-000000000014', 14, 'a1000000-0000-0000-0000-000000000001', 700);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s13', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000004');
select pg_temp.guardar('s13', jsonb_build_array(pg_temp.q(13, 1), pg_temp.q(14, 1)));
select is((select string_agg(l.precio_unitario::text || ':' || coalesce(l.precio_referencia::text, '-') || ':' || l.descuento_pct::text, ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l where l.comprobante_id = pg_temp.id_de('s13')),
  '850.00:-:15.00 700.00:850.00:0.00', 'S13: con 15 % de descuento la promoción de 900 no gana (normal 850) y la de 700 sí (la referencia es el normal del cliente, 850)');
select is(pg_temp.aux('s13'), 0, 'S13: la guarda usa el descuento del cliente: no hay falsos rechazos');
select is(pg_temp.conf('s13'), 'ok', 'S13: se confirma');

-- ============================================================================
-- S14/S15 · tienda A contra tienda B (la promoción es la de la tienda del comprobante)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000015', 15, 'a1000000-0000-0000-0000-000000000002', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000016', 16, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select pg_temp.crear('s14', 'factura', 'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s14', jsonb_build_array(pg_temp.q(15, 1)));
select is(pg_temp.promo_de('s14'), 'e3000000-0000-0000-0000-000000000015'::uuid, 'S14: la factura de la tienda B cobra la promoción de B');
select pg_temp.crear('s15b', 'factura', 'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s15b', jsonb_build_array(pg_temp.q(16, 1)));
select is(pg_temp.res('s15b'), '1000.00|-|0.00|x1|false', 'S15: la tienda B no cobra la promoción de la tienda A');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s15a', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s15a', jsonb_build_array(pg_temp.q(16, 1)));
select is(pg_temp.promo_de('s15a'), 'e3000000-0000-0000-0000-000000000016'::uuid, 'S15: la tienda A sí');
reset role;
-- Mientras tanto: vence la promoción de B (afecta a s14), aparece una de B para Q16 (no afecta a s15a) y una de A (no afecta a s15b).
select pg_temp.vencer('e3000000-0000-0000-0000-000000000015');
select pg_temp.promo('e3000000-0000-0000-0000-000000000166', 16, 'a1000000-0000-0000-0000-000000000002', 600);
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(pg_temp.conf('s14'), pg_temp.msg_c(), 'S14: vencida la promoción de B, la factura de B se rechaza');
select is(pg_temp.conf('s15b'), pg_temp.msg_c(), 'S15: una promoción nueva de B para Q16 sí afecta a la factura de B');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('s15a'), 'ok', 'S15: pero la promoción de B no afecta a la factura de A (se usa la tienda del comprobante)');
reset role;
select pg_temp.vencer('e3000000-0000-0000-0000-000000000016');
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select pg_temp.guardar('s15b', jsonb_build_array(pg_temp.q(16, 1)));
select is(pg_temp.promo_de('s15b'), 'e3000000-0000-0000-0000-000000000166'::uuid, 'S15: el re-guardado de B toma la promoción de B');

-- Organización dos: su propia guarda y sin cruces.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select pg_temp.crear('o2', 'factura', 'a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000009');
select pg_temp.guardar('o2', jsonb_build_array(jsonb_build_object('producto_id', 'b4000000-0000-0000-0000-000000000001', 'cantidad', 1)));
reset role;
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e4000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 300, now() - interval '1 day', now() + interval '1 day');
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is(pg_temp.conf('o2'), pg_temp.msg_c(), 'Org dos: una promoción nueva de su empresa rechaza su confirmación');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.conf('o2') like '%P0002%' or pg_temp.conf('o2') like 'P0002|%', true, 'Org uno: no confirma (ni ve) el comprobante de la organización dos (P0002)');
select is(pg_temp.stock_de(1), 47, 'el stock de la organización uno no se movió (50 − 2 de S1 − 1 de S9)');

-- ============================================================================
-- S16 · permisos: la guarda va después del permiso y del estado
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000021', 21, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s21', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s21', jsonb_build_array(pg_temp.q(21, 1)));
select pg_temp.vencer('e3000000-0000-0000-0000-000000000021');
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select is(pg_temp.conf('s21') like '42501|%', true, 'S16: consulta recibe 42501 y no se entera de que cambiaron los precios');
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(pg_temp.conf('s21'), pg_temp.msg_c(), 'S16: el mostrador (ventas en edición) recibe precios_cambiaron');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- ============================================================================
-- S17 · una sola línea desactualizada entre varias bien preciadas rechaza la factura entera
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000022', 22, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000023', 23, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('s17', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('s17', jsonb_build_array(pg_temp.q(22, 1), pg_temp.q(23, 1), pg_temp.q(24, 1)));
insert into fotos select 's17', pg_temp.snap('s17');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000023');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.aux('s17'), 1, 'S17: exactamente una línea desactualizada de tres');
select is(pg_temp.conf('s17'), pg_temp.msg_c(), 'S17: basta una para rechazar');
select is(pg_temp.snap('s17'), (select foto from fotos where clave = 's17'), 'S17: sin efectos sobre las tres líneas');

-- ============================================================================
-- T016 · presupuestos (FR-008): aceptar no reprecia; un pendiente conserva el precio hasta que se edita
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000018', 18, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('p1', 'presupuesto', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('p1', jsonb_build_array(pg_temp.q(18, 2)));
select pg_temp.crear('p2', 'presupuesto', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('p2', jsonb_build_array(pg_temp.q(18, 2)));
select is(pg_temp.res('p1'), '800.00|1000.00|0.00|x1|false', 'T016: el presupuesto guarda el precio promocional');
select pg_temp.vencer('e3000000-0000-0000-0000-000000000018');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.res('p1'), '800.00|1000.00|0.00|x1|false', 'T016: un presupuesto pendiente conserva el precio guardado aunque la promoción venza');
select is((public.obtener_comprobante(pg_temp.id_de('p1')) -> 'lineas' -> 0 ->> 'precio_unitario')::numeric, 800.00::numeric,
  'T016: obtener_comprobante lo muestra al precio guardado');
select is(pg_temp.err(format('select public.aceptar_presupuesto(%L)', pg_temp.id_de('p1'))), 'ok', 'T016: aceptar el presupuesto no falla');
select is(pg_temp.estado('p1'), 'aceptado', 'T016: queda aceptado');
select is(pg_temp.res('p1') || ' ' || pg_temp.total('p1') || ' ' || coalesce(pg_temp.promo_de('p1')::text, '-'),
  '800.00|1000.00|0.00|x1|false 1600.00/1936.00 e3000000-0000-0000-0000-000000000018',
  'T016: aceptar no reprecia (precio, referencia, total y promoción intactos)');
select pg_temp.guardar('p2', jsonb_build_array(pg_temp.q(18, 2)));
select is(pg_temp.res('p2') || ' ' || pg_temp.total('p2'), '1000.00|-|0.00|x1|false 2000.00/2420.00',
  'T016: un guardado de líneas del presupuesto pendiente lo reprecia entero (sin la promoción vencida)');

-- ============================================================================
-- Nota de crédito, saldo neto, cobros, IVA 21 % y exento sobre facturas promocionales (FR-011, FR-012)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000019', 19, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.promo('e3000000-0000-0000-0000-000000000017', 17, 'a1000000-0000-0000-0000-000000000001', 400);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.crear('f19', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('f19', jsonb_build_array(pg_temp.q(19, 3)));
select is(pg_temp.conf('f19'), 'ok', 'Cobros: la factura promocional (3 × 800) se confirma');
select is(pg_temp.total('f19'), '2400.00/2904.00', 'IVA 21 %: 2400 sin IVA, 504 de IVA, 2904 con IVA');
select is((select row(s.total::numeric(14,2), s.cobrado::numeric(14,2), s.notas_credito::numeric(14,2), s.saldo::numeric(14,2))::text from public.saldo_comprobante(pg_temp.id_de('f19')) s), '(2904.00,0.00,0.00,2904.00)',
  'saldo inicial = total promocional con IVA');
select is(pg_temp.err(format($$select public.registrar_cobro(%L, 1000, '9a000000-0000-0000-0000-00000000000b', null, null)$$, pg_temp.id_de('f19'))), 'ok',
  'se registra un cobro parcial sobre la factura promocional');
select is((select row(s.total::numeric(14,2), s.cobrado::numeric(14,2), s.notas_credito::numeric(14,2), s.saldo::numeric(14,2))::text from public.saldo_comprobante(pg_temp.id_de('f19')) s), '(2904.00,1000.00,0.00,1904.00)',
  'saldo con cobro');
create function pg_temp.linea_de(p_clave text, p_orden integer) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave) and l.orden = p_orden $$;
grant execute on function pg_temp.linea_de(text, integer) to public;
select is(pg_temp.err(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('f19'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('f19', 1), 'cantidad', 1))::text)), 'ok',
  'nota de crédito parcial de 1 unidad');
select is((select l.precio_unitario::text || '|' || l.precio_referencia::text || '|' || (l.promocion_id = 'e3000000-0000-0000-0000-000000000019')::text
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('f19')), '800.00|1000.00|true',
  'la nota devuelve al precio cobrado y hereda referencia y promoción');
select is((select row(s.total::numeric(14,2), s.cobrado::numeric(14,2), s.notas_credito::numeric(14,2), s.saldo::numeric(14,2))::text from public.saldo_comprobante(pg_temp.id_de('f19')) s), '(2904.00,1000.00,968.00,936.00)',
  'saldo neto = 2904 − 1000 cobrado − 968 de nota (1 × 800 + IVA)');
select is(pg_temp.err(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('f19'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('f19', 1), 'cantidad', 2))::text)), 'ok',
  'segunda nota por las 2 unidades restantes');
select is((select sum(n.total_sin_iva) from dominio.comprobantes_venta n where n.comprobante_origen_id = pg_temp.id_de('f19')), 2400.00::numeric,
  'las notas suman exactamente el neto cobrado (sin deriva)');

select pg_temp.crear('f17', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('f17', jsonb_build_array(pg_temp.q(17, 3)));
select is(pg_temp.res('f17'), '400.00|500.00|0.00|x1|false', 'IVA exento: cobra la promoción (400, referencia 500)');
select is(pg_temp.conf('f17'), 'ok', 'IVA exento: se confirma');
select is(pg_temp.total('f17'), '1200.00/1200.00', 'IVA exento: el total con IVA es igual al neto');
select is((select l.iva from dominio.comprobantes_venta_lineas l where l.comprobante_id = pg_temp.id_de('f17')), 0.00::numeric, 'IVA exento: IVA 0');

-- ============================================================================
-- Contrarreembolso de motos: el abono usa el total promocional y el saldo neto (`least(abono, saldo)`)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000020', 20, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select pg_temp.crear('mt1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('mt1', jsonb_build_array(pg_temp.q(20, 2)));
select pg_temp.crear('mt2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('mt2', jsonb_build_array(pg_temp.q(20, 2)));
reset role;
update dominio.comprobantes_venta set envio_id = 'b1000000-0000-0000-0000-00000000000a' where id in (pg_temp.id_de('mt1'), pg_temp.id_de('mt2'));
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
select is(pg_temp.conf('mt1'), 'ok', 'Motos: la factura promocional 1 se confirma');
select is(pg_temp.conf('mt2'), 'ok', 'Motos: la factura promocional 2 se confirma');
select is(pg_temp.err(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('mt2'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('mt2', 1), 'cantidad', 1))::text)), 'ok',
  'Motos: nota parcial de 1 unidad sobre la segunda (saldo neto 968)');
select is(pg_temp.err(format($$select public.registrar_envio_moto(%L, 'Juan', null, 100, 5000, true)$$, pg_temp.id_de('mt1'))), 'ok', 'Motos: envío con abono 5000 sobre la primera');
select is(pg_temp.err(format($$select public.registrar_envio_moto(%L, 'Juan', null, 100, 5000, true)$$, pg_temp.id_de('mt2'))), 'ok', 'Motos: envío con abono 5000 sobre la segunda');
select is(pg_temp.err(format($$select public.rendir_envios_moto(array[%L, %L]::uuid[])$$,
    (select id from dominio.envios_moto where comprobante_id = pg_temp.id_de('mt1')), (select id from dominio.envios_moto where comprobante_id = pg_temp.id_de('mt2')))), 'ok',
  'Motos: se rinden los dos envíos');
select is((select b.importe from dominio.cobros_comprobante b where b.comprobante_id = pg_temp.id_de('mt1')), 1936.00::numeric,
  'Motos: el cobro es el total promocional con IVA (2 × 800 + 21 %), no el abono de 5000');
select is((select b.importe from dominio.cobros_comprobante b where b.comprobante_id = pg_temp.id_de('mt2')), 968.00::numeric,
  'Motos: con nota parcial el cobro es el saldo neto (968)');

-- ============================================================================
-- T018 · edición manual del precio (FR-019)
-- ============================================================================

select pg_temp.promo('e3000000-0000-0000-0000-000000000024', 24, 'a1000000-0000-0000-0000-000000000001', 800);
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select pg_temp.crear('m1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select is(pg_temp.err(format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$, pg_temp.id_de('m1'),
    jsonb_build_array(pg_temp.q(24, 1, 700))::text, pg_temp.upd('m1'))), '42501|precio_manual|Tu rol no puede editar precios',
  'T018: sin editar_precio el precio manual falla con 42501 (hint precio_manual), también sobre un producto en promoción');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('m1')), 0, 'T018: y no guarda ninguna línea');
select pg_temp.guardar('m1', jsonb_build_array(pg_temp.q(24, 1)));
select is(pg_temp.res('m1'), '800.00|1000.00|0.00|x1|false', 'T018: sin precio manual el mostrador cobra la promoción');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('m2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
reset role;
create temp table eventos_antes as select count(*)::int n from public.registro_actividad where tipo = 'comprobante.editado' and organizacion_id = '11111111-1111-1111-1111-111111111111';
grant select on eventos_antes to public;
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('m2', jsonb_build_array(pg_temp.q(24, 1, 700)));
select is(pg_temp.res('m2'), '700.00|-|0.00|x1|true', 'T018: con editar_precio el manual manda sobre la promoción: precio_manual = true y sin referencia');
select is(pg_temp.promo_de('m2'), null::uuid, 'T018: sin promoción asociada');
select is((select count(*)::int from public.registro_actividad where tipo = 'comprobante.editado' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  (select n + 1 from eventos_antes), 'T018: el guardado deja un evento comprobante.editado');
select is((select r.detalle from public.registro_actividad r where r.tipo = 'comprobante.editado' and r.actor_id = 'f1000000-0000-0000-0000-000000000002'
            order by r.creado_en desc limit 1) like 'Actualizó las líneas de la factura %', true, 'T018: con el detalle de siempre');
select pg_temp.guardar('m2', jsonb_build_array(pg_temp.q(24, 1, 1200)));
select is(pg_temp.res('m2'), '1200.00|-|0.00|x1|true', 'T018: un manual mayor que la lista también manda');
select is(pg_temp.conf('m2'), 'ok', 'T018: la factura con precio manual se confirma');
select is(pg_temp.total('m2'), '1200.00/1452.00', 'T018: cobra el manual');

-- ============================================================================
-- FR-024 · 200 líneas en confirmar_comprobante: bandera apagada contra encendida (mediana de 5 corridas, 1 de calentamiento)
-- ============================================================================

reset role;
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
select '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', p.id, 900, now() - interval '1 day', now() + interval '1 day'
  from dominio.productos p where p.sku like 'M-%';
create temp table lineas200 as
  select jsonb_agg(jsonb_build_object('producto_id', p.id, 'cantidad', 1) order by p.sku) as lineas
    from dominio.productos p where p.sku like 'M-%';
grant select on lineas200 to public;
create temp table medidas (bandera boolean, ms numeric);
grant select, insert on medidas to public;
create function pg_temp.medir(p_clave text, p_bandera boolean, p_cuenta boolean) returns void language plpgsql as $$
declare v_t timestamptz;
begin
  v_t := clock_timestamp();
  perform public.confirmar_comprobante((select id from comps where clave = p_clave));
  if p_cuenta then
    insert into medidas values (p_bandera, extract(epoch from clock_timestamp() - v_t) * 1000);
  end if;
end $$;
-- Seis facturas guardadas con la bandera encendida (cada línea con su promoción) y seis con la apagada.
select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe3', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe4', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('mpe6', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('mpe1', (select lineas from lineas200)); select pg_temp.guardar('mpe2', (select lineas from lineas200));
select pg_temp.guardar('mpe3', (select lineas from lineas200)); select pg_temp.guardar('mpe4', (select lineas from lineas200));
select pg_temp.guardar('mpe5', (select lineas from lineas200)); select pg_temp.guardar('mpe6', (select lineas from lineas200));
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('mpe1') and promocion_id is not null), 200,
  'FR-024: con la bandera encendida las 200 líneas llevan su promoción');
select pg_temp.bandera(false);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('map1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('map2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('map3', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('map4', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('map5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('map6', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('map1', (select lineas from lineas200)); select pg_temp.guardar('map2', (select lineas from lineas200));
select pg_temp.guardar('map3', (select lineas from lineas200)); select pg_temp.guardar('map4', (select lineas from lineas200));
select pg_temp.guardar('map5', (select lineas from lineas200)); select pg_temp.guardar('map6', (select lineas from lineas200));
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('map1') and promocion_id is not null), 0,
  'FR-024: con la bandera apagada ninguna de las 200 líneas lleva promoción');
-- Apagada: confirmar con la bandera apagada (la guarda no actúa).
select pg_temp.medir('map1', false, false);
select pg_temp.medir('map2', false, true); select pg_temp.medir('map3', false, true); select pg_temp.medir('map4', false, true);
select pg_temp.medir('map5', false, true); select pg_temp.medir('map6', false, true);
-- Encendida: la guarda hace una búsqueda indexada por línea.
select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.medir('mpe1', true, false);
select pg_temp.medir('mpe2', true, true); select pg_temp.medir('mpe3', true, true); select pg_temp.medir('mpe4', true, true);
select pg_temp.medir('mpe5', true, true); select pg_temp.medir('mpe6', true, true);
select is((select count(*)::int from comps c join dominio.comprobantes_venta v on v.id = c.id where (c.clave like 'mpe%' or c.clave like 'map%') and v.estado = 'confirmada'), 12,
  'FR-024: las 12 facturas de 200 líneas quedaron confirmadas');
select diag(format('FR-024: confirmar 200 líneas, mediana de 5 corridas: apagada = %s ms, encendida = %s ms, razón = %s',
  (select round(percentile_cont(0.5) within group (order by ms)::numeric, 1) from medidas where not bandera),
  (select round(percentile_cont(0.5) within group (order by ms)::numeric, 1) from medidas where bandera),
  (select round((select percentile_cont(0.5) within group (order by ms) from medidas where bandera)::numeric
               / (select percentile_cont(0.5) within group (order by ms) from medidas where not bandera)::numeric, 2))));
select ok((select percentile_cont(0.5) within group (order by ms) from medidas where bandera) < 1.5 * (select percentile_cont(0.5) within group (order by ms) from medidas where not bandera),
  'FR-024: confirmar 200 líneas con la bandera encendida tarda menos de 1,5× que con la apagada');

select * from finish();
rollback;
