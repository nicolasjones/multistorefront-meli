-- MSF-816 / F-1 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes): precio promocional en el servidor.
-- Cubre US1 (FR-001…FR-007, FR-013, FR-014 lado servidor, FR-015, SC-001, SC-002, SC-003, FR-024) y, por adelanto
-- de F-1, FR-010 y FR-011 (copiar presupuesto y herencia del snapshot en notas de crédito):
--   · la tabla de 10 ejemplos de precedencia («gana el más bajo, sin acumular») con una aserción por fila y los
--     bordes (promoción igual o mayor al normal, cantidad que cruza la escala, descuento 5 % y 15 %, precio propio);
--   · snapshot: `precio_unitario`, `precio_referencia` y `promocion_id`; inmutable al cambiar, anular o vencer la
--     promoción tras confirmar; la factura cerrada rechaza el guardado (55000);
--   · vigencia `[desde, hasta)` con `p_ahora`, incluida la medianoche de Buenos Aires; el reloj del servidor es
--     `clock_timestamp()` y no el `now()` de la transacción;
--   · tienda A vs tienda B, aislamiento por organización (incluida una fila inconsistente forzada) y la baja de una
--     organización con una línea promocional (FK `no action`);
--   · bandera APAGADA ≡ comportamiento legado columna por columna (baseline con la expresión de antes);
--   · permisos: un rol con `ventas` y SIN `productos` cobra la promoción; `consulta` no escribe; `anon` y
--     `authenticated` no ejecutan las funciones `private`; `authenticated` no inserta ni actualiza líneas; las claves
--     `precio_referencia`/`promocion_id` dentro de `p_lineas` se ignoran;
--   · `obtener_comprobante` expone `precio_referencia` y NO `promocion_id`;
--   · `copiar_presupuesto` (sin descuento del cliente, igual que hoy) y notas de crédito que heredan las columnas;
--   · medición de 200 líneas con la bandera apagada contra encendida (< 1,5×).
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

-- El operador (f…02) vende en A; consulta (f…03) en A; «mixto» (f…04) es mostrador en A y operador en B.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mostrador'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

-- c1 mayorista sin descuento; c2 minorista sin descuento; c3 minorista 5 %; c4 minorista 15 %; c5 de la org 2.
insert into clientes (id, organizacion_id, numero, nombre, tipo, archivado_en, descuento) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Distribuidora Norte', 'mayorista', null, null),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 11, 'Cliente minorista', 'minorista', null, null),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 12, 'Cliente 5 %', 'minorista', null, 5),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 13, 'Cliente 15 %', 'minorista', null, 15),
  ('c5000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 14, 'Cliente 33,33 %', 'minorista', null, 33.33),
  ('c5000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 10, 'Cliente org dos', 'minorista', null, null);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena');

-- Todos de lista $1.000 sin IVA (categoría 21 %) salvo P8 (exento, $500) y P11 (org 2, $500).
--   P1 con escalas x5 900, x10 800, x50 700 · P2 y P3 con precio propio de la tienda A = 950 · P4 con x10 = 800
--   P5 promoción solo en B · P6 promoción igual al precio · P7 promoción mayor · P8 exento · P9 bordes de vigencia
--   P10 reloj · P12 sin promoción (baseline) · P20..P219 para la medición de 200 líneas.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'P-' || n, 'ARS', case when n = 8 then 500 when n = 13 then 990 else 1000 end,
       'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 15) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo) values
  ('b2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'Teclado ajeno', 'TEC-1', 'ARS', 500, 'c2000000-0000-0000-0000-000000000001', null, true);

insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'x50', 700),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'x10', 800);

insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);

update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'b1000000-0000-0000-0000-000000000008';

-- 200 productos más para la medición de rendimiento (lista $1.000, promoción propia en la tienda A).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Masivo ' || n, 'M-' || n, 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 200) n;

-- Depósitos: el principal lo siembra la organización; «Otro» vende solo para la tienda B.
insert into dominio.depositos (id, organizacion_id, nombre) values
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Otro');
create temp table datos as
  select
    (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal,
    (select id from dominio.depositos where organizacion_id = '22222222-2222-2222-2222-222222222222' and por_defecto) as principal_dos;
grant select on datos to public;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id) values
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal_dos, 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222' from datos
on conflict do nothing;

-- Stock: P1 10 en el principal con 3 reservadas (7 disponibles); P8 y P12 también 10.
insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado) values
  ('b1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 3),
  ('b1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 10, 0)
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p, (select principal from datos), '11111111-1111-1111-1111-111111111111', 10, case when p = 'b1000000-0000-0000-0000-000000000001'::uuid then 3 else 0 end
  from (values ('b1000000-0000-0000-0000-000000000001'::uuid), ('b1000000-0000-0000-0000-000000000012'::uuid)) v(p)
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = excluded.reservado;

-- Promociones (fixture como postgres). Ventana ancha: [ahora − 1 día, ahora + 1 día).
--   e1…01 P1 tienda A 900 · e1…02 P1 tienda B 850 · P2 A 900 · P3 A 980 · P4 A 700 · P5 solo B 850 · P6 A 1000 (=)
--   P7 A 1200 (>) · P8 A 400 · P9 A 600 en [2027-03-09 00:00-03, 2027-03-10 00:00-03) · P10 A 700 desde ahora + 0,4 s
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 900, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 850, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 900, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 980, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 700, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005', 850, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000006', 1000, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 1200, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000008', 400, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000009', 600, '2027-03-09 00:00:00-03', '2027-03-10 00:00:00-03'),
  ('e1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000010', 700, now() + interval '0.4 seconds', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000013', 660.03, now() - interval '1 day', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000014', 800, now() - interval '3 days', now() + interval '1 day'),
  ('e1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000015', 700, now() + interval '1 day', now() + interval '2 days'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000011', 400, now() - interval '1 day', now() + interval '1 day');
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
select '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', p.id, 900, now() - interval '1 day', now() + interval '1 day'
  from dominio.productos p where p.sku like 'M-%';

-- Solo para leer en las aserciones: la lectura directa de las líneas está revocada a `authenticated` (la app lee por
-- obtener_comprobante); acá se concede `select` dentro de la transacción de prueba. insert/update siguen sin concederse
-- y se afirman más abajo.
grant select on dominio.comprobantes_venta_lineas to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Sesión de un usuario SIN cambiar de rol (para llamar directo a las funciones `private` como dueño).
create function pg_temp.sesion(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

-- Una línea de un producto y cantidad dados (con depósito del principal o el que corresponda).
create function pg_temp.l(p_n integer, p_cant integer, p_manual numeric default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'producto_id', 'b1000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'), 'cantidad', p_cant, 'precio_manual', p_manual));
$$;

-- «unitario|referencia|descuento_pct|escala|manual» de la primera línea (security definer: lee sin RLS).
create function pg_temp.res(p_clave text) returns text language sql security definer as $$
  select l.precio_unitario::text || '|' || coalesce(l.precio_referencia::text, '-') || '|' || l.descuento_pct::text
         || '|' || l.escala || '|' || l.precio_manual::text
    from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave)
   order by l.orden limit 1;
$$;
create function pg_temp.promo(p_clave text) returns uuid language sql security definer as $$
  select l.promocion_id from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = (select id from comps where clave = p_clave) order by l.orden limit 1;
$$;
create function pg_temp.guardar_res(p_clave text, p_lineas jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.guardar(p_clave, p_lineas);
  return pg_temp.res(p_clave);
end $$;
create function pg_temp.total(p_clave text) returns text language sql security definer as $$
  select c.total_sin_iva::text || '/' || c.total_con_iva::text from dominio.comprobantes_venta c
   where c.id = (select id from comps where clave = p_clave) $$;
grant execute on function pg_temp.res(text), pg_temp.promo(text), pg_temp.total(text), pg_temp.upd(text), pg_temp.id_de(text) to public;

-- Baseline: recalcula cada línea con la expresión LEGADA (`precio_para` + `round(neto × (1 − d/100), 2)`) y
-- compara columna por columna con lo guardado; devuelve la cantidad de columnas distintas (0 = idéntico).
create function pg_temp.dif_baseline(p_clave text) returns integer language plpgsql security definer as $$
declare
  v_c dominio.comprobantes_venta;
  v_tipo text;
  v_d numeric;
  v_dif integer := 0;
  v_l dominio.comprobantes_venta_lineas;
  v_p record;
  v_unit numeric;
  v_sub numeric;
  v_iva numeric;
  v_alic numeric;
  v_ts numeric := 0;
  v_ti numeric := 0;
begin
  select * into v_c from dominio.comprobantes_venta where id = (select id from comps where clave = p_clave);
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo, v_d from public.clientes cl where cl.id = v_c.cliente_id;
  for v_l in select * from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id order by orden loop
    select * into v_p from private.precio_para(v_l.producto_id, v_c.empresa_id, private.escala_para_linea(v_tipo, v_l.cantidad));
    v_unit := coalesce(case when v_l.precio_manual then v_l.precio_unitario end, round(v_p.neto * (1 - v_d / 100), 2));
    v_alic := case when v_p.alicuota_exenta then 0 else coalesce(v_p.alicuota_porcentaje, 0) end;
    v_sub := round(v_unit * v_l.cantidad, 2);
    v_iva := round(v_sub * v_alic / 100, 2);
    v_dif := v_dif
      + (v_l.precio_unitario is distinct from v_unit)::int
      + (v_l.escala is distinct from v_p.escala_usada)::int
      + (v_l.descuento_pct is distinct from case when v_l.precio_manual then 0 else v_d end)::int
      + (v_l.subtotal_sin_iva is distinct from v_sub)::int
      + (v_l.iva is distinct from v_iva)::int
      + (v_l.alicuota_porcentaje is distinct from v_alic)::int
      + (v_l.precio_referencia is not null)::int
      + (v_l.promocion_id is not null)::int;
    v_ts := v_ts + v_sub;
    v_ti := v_ti + v_iva;
  end loop;
  v_dif := v_dif + (v_c.total_sin_iva is distinct from v_ts)::int + (v_c.total_con_iva is distinct from v_ts + v_ti)::int;
  return v_dif;
end $$;
grant execute on function pg_temp.dif_baseline(text) to public;

-- ============================================================================
-- Esquema, FK, check, índice y privilegios
-- ============================================================================

select has_column('dominio', 'comprobantes_venta_lineas', 'precio_referencia', 'la línea tiene precio_referencia (dominio, Principio VII)');
select has_column('dominio', 'comprobantes_venta_lineas', 'promocion_id', 'la línea tiene promocion_id');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'precio_referencia', 'precio_referencia es nulable (lo emitido queda intacto)');
select col_is_null('dominio', 'comprobantes_venta_lineas', 'promocion_id', 'promocion_id es nulable');
select is((select numeric_precision || ',' || numeric_scale from information_schema.columns
            where table_schema = 'dominio' and table_name = 'comprobantes_venta_lineas' and column_name = 'precio_referencia'),
  '14,2', 'precio_referencia es numeric(14,2)');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'comprobantes_venta_lineas'), 0, 'nada de esto va a public');
select is((select c.confdeltype::text from pg_constraint c where c.conname = 'comprobantes_venta_lineas_promocion_fk'),
  'a', 'la FK de la línea a la promoción es no action (no rompe la baja de la organización)');
select is((select array_agg(a.attname::text order by a.attname::text) from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            where c.conname = 'comprobantes_venta_lineas_promocion_fk'),
  array['organizacion_id', 'promocion_id'], 'la FK es compuesta con organizacion_id');
select ok(exists (select 1 from pg_constraint where conname = 'promociones_precio_id_organizacion_uk' and contype = 'u'),
  'promociones_precio tiene unique (id, organizacion_id)');
select ok(exists (select 1 from pg_indexes where schemaname = 'dominio' and indexname = 'comprobantes_venta_lineas_promocion_idx'
                    and indexdef ilike '%where (promocion_id is not null)%'), 'índice parcial por promocion_id');
select is(has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'insert')
       or has_table_privilege('authenticated', 'dominio.comprobantes_venta_lineas', 'update'), false,
  'authenticated no inserta ni actualiza líneas (solo las escribe la RPC)');
select is(has_table_privilege('anon', 'dominio.comprobantes_venta_lineas', 'select'), false, 'anon sin acceso a las líneas');
select is(has_function_privilege('anon', 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)', 'execute'), false,
  'anon no ejecuta precio_linea_venta');
select is(has_function_privilege('authenticated', 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)', 'execute'), false,
  'authenticated no ejecuta precio_linea_venta');
select is(has_function_privilege('anon', 'private.promocion_vigente_fila(uuid,uuid,timestamptz)', 'execute'), false,
  'anon no ejecuta promocion_vigente_fila');
select is(has_function_privilege('authenticated', 'private.promocion_vigente_fila(uuid,uuid,timestamptz)', 'execute'), false,
  'authenticated no ejecuta promocion_vigente_fila');
select is(has_function_privilege('authenticated', 'private.copiar_costo_linea_nota()', 'execute'), false,
  'authenticated no ejecuta el disparador de notas');
select is(has_function_privilege('service_role', 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)', 'execute'), false,
  'service_role no ejecuta precio_linea_venta');
select is(has_function_privilege('service_role', 'private.promocion_vigente_fila(uuid,uuid,timestamptz)', 'execute'), false,
  'service_role no ejecuta promocion_vigente_fila');
select is(has_function_privilege('service_role', 'private.copiar_costo_linea_nota()', 'execute'), false,
  'service_role no ejecuta el disparador de notas');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)'::regprocedure),
  false, 'precio_linea_venta es security invoker (hereda la compuerta de precio_para)');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.promocion_vigente_fila(uuid,uuid,timestamptz)'::regprocedure),
  true, 'promocion_vigente_fila es security definer (acceso acotado, FR-013)');
select ok((select p.proconfig::text like '%search_path=\\"\\"%' from pg_proc p where p.oid = 'private.promocion_vigente_fila(uuid,uuid,timestamptz)'::regprocedure),
  'promocion_vigente_fila con search_path vacío');
select ok((select p.proconfig::text like '%search_path=\\"\\"%' from pg_proc p where p.oid = 'private.precio_linea_venta(uuid,uuid,text,integer,numeric,timestamptz,boolean)'::regprocedure),
  'precio_linea_venta con search_path vacío');
select is(has_function_privilege('authenticated', 'public.guardar_lineas_comprobante(uuid,jsonb,timestamptz)', 'execute'), true,
  'authenticated sigue ejecutando guardar_lineas_comprobante (firma intacta)');
select is(has_function_privilege('anon', 'public.guardar_lineas_comprobante(uuid,jsonb,timestamptz)', 'execute'), false,
  'anon no ejecuta guardar_lineas_comprobante');
select is(has_function_privilege('anon', 'public.obtener_comprobante(uuid)', 'execute'), false, 'anon no ejecuta obtener_comprobante');
select is(has_function_privilege('anon', 'public.copiar_presupuesto(uuid)', 'execute'), false, 'anon no ejecuta copiar_presupuesto');

-- ============================================================================
-- Bandera por defecto: apagada (T000 en una base local con el seed)
-- ============================================================================

select is((select activa from public.banderas_plataforma where clave = 'promociones_precio'), false,
  'T000: en una base local con el seed la bandera promociones_precio nace APAGADA');

-- ============================================================================
-- Armado de los comprobantes (los vende el operador de la tienda A; B la vende «mixto»)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('min', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('may', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.crear('d5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.crear('d15', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000004');
select pg_temp.crear('base', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.crear('base5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select pg_temp.crear('minB', 'factura', 'a1000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002');

-- ============================================================================
-- Bandera APAGADA: el comportamiento es IDÉNTICO al legado (FR-005, SC-002), con promociones cargadas
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.guardar_res('min', jsonb_build_array(pg_temp.l(1, 1))), '1000.00|-|0.00|x1|false',
  'bandera apagada: minorista cantidad 1 cobra la lista aunque haya promoción cargada');
select is(pg_temp.dif_baseline('min'), 0, 'baseline apagada (minorista): cero columnas distintas del legado');
select pg_temp.guardar('may', jsonb_build_array(pg_temp.l(1, 10), pg_temp.l(1, 5) || '{"deposito_id": null}'));
select is(pg_temp.dif_baseline('may'), 0, 'baseline apagada (mayorista x10): cero columnas distintas');
select pg_temp.guardar('d5', jsonb_build_array(pg_temp.l(1, 1)));
select is(pg_temp.res('d5'), '950.00|-|5.00|x1|false', 'bandera apagada: cliente 5 % cobra 950 con su descuento y sin referencia');
select is(pg_temp.dif_baseline('d5'), 0, 'baseline apagada (descuento 5 %): cero columnas distintas');
select pg_temp.guardar('d15', jsonb_build_array(pg_temp.l(1, 1)));
select is(pg_temp.dif_baseline('d15'), 0, 'baseline apagada (descuento 15 %): cero columnas distintas');
select pg_temp.guardar('base', jsonb_build_array(pg_temp.l(2, 1), pg_temp.l(8, 3), pg_temp.l(12, 2), pg_temp.l(1, 3, 777)));
select is(pg_temp.dif_baseline('base'), 0, 'baseline apagada (precio propio, exento, lista y manual en un mismo comprobante): cero distintas');
select pg_temp.guardar('base5', jsonb_build_array(pg_temp.l(1, 10), pg_temp.l(4, 10), pg_temp.l(8, 1)));
select is(pg_temp.dif_baseline('base5'), 0, 'baseline apagada (mayorista con 5 % que no es descuento: tipo mayorista, escala x10): cero distintas');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where precio_referencia is not null or promocion_id is not null),
  0, 'bandera apagada: ninguna línea guardó referencia ni promoción');
select is(pg_temp.total('base'), (select (sum(l.subtotal_sin_iva))::text || '/' || (sum(l.subtotal_sin_iva + l.iva))::text
  from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = 'base')),
  'los totales del comprobante salen de las líneas (bandera apagada)');

-- ============================================================================
-- Bandera ENCENDIDA: tabla de precedencia de la spec, una aserción por fila (FR-003, SC-001)
-- ============================================================================

select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('e1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('e2', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.crear('e3', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.crear('e4', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000004');
select pg_temp.crear('e5', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.crear('e6', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('e7', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('e8', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.crear('e9', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.crear('e10', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');

-- 1. Minorista cantidad 1: normal 1000, promoción 900 → 900 con referencia 1000
select is(pg_temp.guardar_res('e1', jsonb_build_array(pg_temp.l(1, 1))), '900.00|1000.00|0.00|x1|false', 'fila 1: minorista cantidad 1 cobra la promoción (900), referencia 1000');
select is(pg_temp.promo('e1'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'fila 1: la línea guarda la promoción aplicada');
-- 2. Mayorista 10 unidades (x10 = 800): la escala es menor, la promoción no se aplica
select is(pg_temp.guardar_res('e2', jsonb_build_array(pg_temp.l(1, 10))), '800.00|-|0.00|x10|false', 'fila 2: mayorista x10 cobra 800 (la escala es menor), sin referencia');
select is(pg_temp.promo('e2'), null::uuid, 'fila 2: sin promoción aplicada');
-- 3. Mayorista 3 unidades (x1): gana la promoción
select is(pg_temp.guardar_res('e3', jsonb_build_array(pg_temp.l(1, 3))), '900.00|1000.00|0.00|x1|false', 'fila 3: mayorista 3 unidades (x1) cobra la promoción 900');
-- 4. Cliente con 15 % (850 < 900): el descuento es menor, no se acumula
select is(pg_temp.guardar_res('e4', jsonb_build_array(pg_temp.l(1, 1))), '850.00|-|15.00|x1|false', 'fila 4: descuento 15 % cobra 850 y conserva su descuento_pct');
-- 5. Cliente con 5 % (950 > 900): gana la promoción, NO 855; descuento_pct = 0
select is(pg_temp.guardar_res('e5', jsonb_build_array(pg_temp.l(1, 1))), '900.00|950.00|0.00|x1|false', 'fila 5: descuento 5 % cobra 900 (no 855), referencia 950 y descuento_pct 0');
-- 6. Precio propio 950 y promoción 900: la promoción baja el propio
select is(pg_temp.guardar_res('e6', jsonb_build_array(pg_temp.l(2, 1))), '900.00|950.00|0.00|x1|false', 'fila 6: precio propio 950 con promoción 900 cobra 900, referencia 950');
-- 7. Precio propio 950 y promoción 980: una promoción mayor al normal se ignora
select is(pg_temp.guardar_res('e7', jsonb_build_array(pg_temp.l(3, 1))), '950.00|-|0.00|x1|false', 'fila 7: precio propio 950 con promoción 980 cobra 950 (se ignora)');
-- 8. Promoción 700 con x10 = 800 (10 unidades): gana la más baja
select is(pg_temp.guardar_res('e8', jsonb_build_array(pg_temp.l(4, 10))), '700.00|800.00|0.00|x10|false', 'fila 8: promoción 700 contra x10 800 cobra 700, referencia 800');
-- 9. Precio manual 700: manda siempre, sin referencia ni promoción
select is(pg_temp.guardar_res('e9', jsonb_build_array(pg_temp.l(1, 1, 700))), '700.00|-|0.00|x1|true', 'fila 9: precio manual 700 manda sobre la promoción 900, sin referencia');
select is(pg_temp.promo('e9'), null::uuid, 'fila 9: el manual no lleva promoción');
-- 10. Promoción de la tienda B, venta en la tienda A: la promoción es por tienda
select is(pg_temp.guardar_res('e10', jsonb_build_array(pg_temp.l(5, 1))), '1000.00|-|0.00|x1|false', 'fila 10: promoción solo de B, venta en A cobra 1000');
-- y la tienda B, con su propia promoción de P1 (850), la cobra
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is(pg_temp.guardar_res('minB', jsonb_build_array(pg_temp.l(1, 1) || jsonb_build_object('deposito_id', 'd1000000-0000-0000-0000-000000000003'))),
  '850.00|1000.00|0.00|x1|false', 'tienda B cobra su promoción (850), no la de A (900)');
select is(pg_temp.promo('minB'), 'e1000000-0000-0000-0000-000000000002'::uuid, 'la línea de B guarda la promoción de B');
select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- Bordes: promoción igual o mayor al precio normal
select is(pg_temp.guardar_res('e1', jsonb_build_array(pg_temp.l(6, 1))), '1000.00|-|0.00|x1|false', 'borde: promoción igual al precio normal se ignora (< estricto)');
select is(pg_temp.guardar_res('e1', jsonb_build_array(pg_temp.l(7, 1))), '1000.00|-|0.00|x1|false', 'borde: promoción mayor al precio normal se ignora');
-- Cantidad que cruza la escala: x5 (900) empata con la promoción 900 → se ignora; x1 → gana la promoción
select is(pg_temp.guardar_res('e2', jsonb_build_array(pg_temp.l(1, 4))), '900.00|1000.00|0.00|x1|false', 'cruce de escala: 4 unidades (x1) cobra la promoción 900');
select is(pg_temp.guardar_res('e2', jsonb_build_array(pg_temp.l(1, 5))), '900.00|-|0.00|x5|false', 'cruce de escala: 5 unidades (x5 = 900) empata con la promoción: gana la escala, sin referencia');
-- Redondeo del precio normal: 990 con 33,33 % = 660,033 sin redondear / 660,03 redondeado; la promoción 660,03 EMPATA
-- con el normal redondeado y no gana (sin el round() ganaría con referencia == precio).
select pg_temp.crear('redondeo', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000006');
select is(pg_temp.guardar_res('redondeo', jsonb_build_array(pg_temp.l(13, 1))), '660.03|-|33.33|x1|false',
  'redondeo: descuento 33,33 % da 660,03 y una promoción de 660,03 empata: no gana, conserva su descuento');
select is(pg_temp.promo('redondeo'), null::uuid, 'redondeo: sin promoción aplicada');

-- IVA y totales salen de la línea con el neto promocional
select pg_temp.guardar('e1', jsonb_build_array(pg_temp.l(1, 3), pg_temp.l(8, 2)));
select is((select string_agg(l.subtotal_sin_iva::text || '/' || l.iva::text, ' ' order by l.orden) from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = pg_temp.id_de('e1')), '2700.00/567.00 800.00/0.00',
  'IVA con el neto promocional: 21 % sobre 2.700 y exento 0 sobre 800');
select is(pg_temp.total('e1'), '3500.00/4067.00', 'los totales del comprobante suman las líneas promocionales');

-- ============================================================================
-- Vigencia [desde, hasta) con p_ahora, incluida la medianoche de Buenos Aires (FR-002)
-- ============================================================================

select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
create function pg_temp.precio_en(p_ahora timestamptz) returns numeric language sql as $$
  select neto_unitario from private.precio_linea_venta(
    'b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, p_ahora);
$$;
select is(pg_temp.precio_en('2027-03-09 23:59:59.999-03'), 600.00, 'borde: 23:59:59.999 del día 9 en Buenos Aires usa la promoción');
select is(pg_temp.precio_en('2027-03-10 00:00:00-03'), 1000.00, 'borde: 00:00:00 del día 10 en Buenos Aires ya NO usa la promoción (hasta es exclusivo)');
select is(pg_temp.precio_en('2027-03-09 00:00:00-03'), 600.00, 'borde: exactamente en `desde` la promoción rige (desde es inclusivo)');
select is(pg_temp.precio_en('2027-03-08 23:59:59.999-03'), 1000.00, 'borde: un instante antes de `desde` no rige');
select is(pg_temp.precio_en(('2027-03-10 00:00:00'::timestamp) at time zone 'America/Argentina/Buenos_Aires'), 1000.00,
  'la medianoche de Buenos Aires (zona IANA) cierra la promoción');
select is(pg_temp.precio_en('2027-03-10 02:59:59.999+00'), 600.00, '02:59:59.999 UTC es todavía el día 9 en Buenos Aires');
select is((select referencia from (select precio_referencia as referencia from private.precio_linea_venta(
    'b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, '2027-03-09 12:00:00-03')) x),
  1000.00, 'la función devuelve la referencia del normal cuando gana la promoción');
select is((select count(*)::int from private.precio_linea_venta(
    'b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, null)), 1,
  'p_ahora nulo no rompe: devuelve el precio normal');

-- Anulada: no rige aunque esté en ventana
select pg_temp.bandera(true);
update dominio.promociones_precio set anulada_at = now() where id = 'e1000000-0000-0000-0000-000000000010';
select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.precio_en('2027-03-09 12:00:00-03'), 1000.00, 'una promoción anulada no rige');
reset role;
update dominio.promociones_precio set anulada_at = null where id = 'e1000000-0000-0000-0000-000000000010';

-- Dos promociones vigentes del mismo producto y tienda: el disparador de solapes (23P01) lo impide por las vías
-- normales; solo se alcanza con escrituras que lo saltean (carga directa). Defensa: rige la de `desde` más reciente.
reset role;
select throws_ok($$insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
  values ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000014', 750, now() - interval '1 day', now() + interval '1 day')$$,
  '23P01', null, 'el disparador impide dos promociones activas solapadas del mismo producto y tienda');
set local session_replication_role = replica;
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e1000000-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000014', 750, now() - interval '1 day', now() + interval '1 day');
set local session_replication_role = origin;
select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
select is((select precio from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000001', now())),
  750.00, 'con dos promociones vigentes forzadas rige la de desde más reciente (750, no la de hace 3 días)');
select is((select count(*)::int from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000001', now())), 1,
  'y devuelve una sola fila');
reset role;
-- Caso real alcanzable: rangos contiguos; en el límite exacto rige solo la segunda (hasta es exclusivo).
delete from dominio.promociones_precio where id = 'e1000000-0000-0000-0000-000000000099';
update dominio.promociones_precio set hasta = '2027-04-01 00:00:00-03' , desde = '2027-03-01 00:00:00-03' where id = 'e1000000-0000-0000-0000-000000000013';
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e1000000-0000-0000-0000-000000000098', '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000014', 600, '2027-04-01 00:00:00-03', '2027-05-01 00:00:00-03');
select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
select is((select precio from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000001', '2027-04-01 00:00:00-03')),
  600.00, 'rangos contiguos: en el instante exacto del corte rige la segunda promoción');
select is((select precio from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000001', '2027-03-31 23:59:59.999-03')),
  800.00, 'rangos contiguos: un instante antes del corte rige la primera');

-- Reloj del servidor: clock_timestamp() y no el now() de la transacción (la promoción de P10 se reprograma 1,5 s adelante)
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('reloj', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
reset role;
update dominio.promociones_precio set desde = clock_timestamp() + interval '1.5 seconds' where id = 'e1000000-0000-0000-0000-000000000011';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.guardar_res('reloj', jsonb_build_array(pg_temp.l(10, 1))), '1000.00|-|0.00|x1|false', 'reloj: antes de que empiece la promoción cobra 1000');
select pg_sleep(2);
select is(pg_temp.guardar_res('reloj', jsonb_build_array(pg_temp.l(10, 1))), '700.00|1000.00|0.00|x1|false',
  'reloj: pasado `desde` (clock_timestamp, no el now() de la transacción) cobra la promoción');

-- ============================================================================
-- Aislamiento entre organizaciones y filtro por organizacion_id
-- ============================================================================

select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
-- Una fila INCONSISTENTE (promoción de la org 2 sobre la tienda y el producto de la org 1) solo se puede cargar sin
-- disparadores de FK: la función la ignora porque filtra por la organización de la empresa.
create function pg_temp.hay_fila(p_producto uuid, p_empresa uuid) returns integer language sql as $$
  select count(*)::int from private.promocion_vigente_fila(p_producto, p_empresa, now());
$$;
select is(pg_temp.hay_fila('b1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000001'), 0, 'P12 sin promoción: no hay fila');
reset role;
set local session_replication_role = replica;
insert into dominio.promociones_precio (id, organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('e2000000-0000-0000-0000-000000000099', '22222222-2222-2222-2222-222222222222', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000012', 1, now() - interval '1 day', now() + interval '1 day');
set local session_replication_role = origin;
select pg_temp.sesion('f1000000-0000-0000-0000-000000000002');
select is(pg_temp.hay_fila('b1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000001'), 0,
  'una promoción de OTRA organización (fila inconsistente forzada) no se lee: el filtro por organizacion_id');
select is(pg_temp.hay_fila('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'), 1,
  'la promoción de la propia organización y tienda sí se lee');
select is(pg_temp.hay_fila('b1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'), 0,
  'una empresa de otra organización no ve la promoción');
reset role;
delete from dominio.promociones_precio where id = 'e2000000-0000-0000-0000-000000000099';

-- ============================================================================
-- Permisos: un rol con `ventas` y SIN `productos` cobra la promoción (FR-013)
-- ============================================================================

reset role;
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador' and seccion = 'productos';
select pg_temp.como('f1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from dominio.promociones_precio where empresa_id = 'a1000000-0000-0000-0000-000000000001'), 0,
  'mostrador sin `productos` en la tienda A no lee ninguna promoción de A (RLS por tienda)');
select pg_temp.crear('solo_ventas', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select is(pg_temp.guardar_res('solo_ventas', jsonb_build_array(pg_temp.l(1, 1))), '900.00|1000.00|0.00|x1|false',
  'un rol con ventas y sin productos cobra la promoción sin poder leerla');
select throws_ok($$select * from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1)$$,
  '42501', null, 'authenticated no ejecuta private.precio_linea_venta directamente');
select throws_ok($$select * from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'authenticated no ejecuta private.promocion_vigente_fila directamente');
select throws_ok($$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva)
  select organizacion_id, comprobante_id, 50, producto_id, 'x', 1, 1, 'x1', deposito_id, 1, 0 from dominio.comprobantes_venta_lineas limit 1$$,
  '42501', null, 'authenticated no inserta líneas');
select throws_ok($$update dominio.comprobantes_venta_lineas set precio_unitario = 1, precio_referencia = 2, promocion_id = null$$,
  '42501', null, 'authenticated no actualiza líneas');
-- consulta (lectura) no escribe
select pg_temp.como('f1000000-0000-0000-0000-000000000003');
select throws_ok(format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, now())$$, pg_temp.id_de('min'), jsonb_build_array(pg_temp.l(1, 1))::text),
  '42501', null, 'consulta (lectura) no guarda líneas');
-- anon
reset role;
set local role anon;
select throws_ok($$select public.guardar_lineas_comprobante(gen_random_uuid(), '[]'::jsonb, now())$$, '42501', null, 'anon no ejecuta guardar_lineas_comprobante');
select throws_ok($$select * from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1)$$,
  '42501', null, 'anon no ejecuta private.precio_linea_venta');
-- otra organización
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select throws_ok(format($$select public.guardar_lineas_comprobante(%L, '[]'::jsonb, now())$$, pg_temp.id_de('e1')),
  'P0002', null, 'otra organización no opera un comprobante ajeno');
reset role;
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'mostrador' and seccion = 'productos';

-- ============================================================================
-- Claves precio_referencia / promocion_id dentro de p_lineas: se ignoran
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('inyec', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select is(pg_temp.guardar_res('inyec', jsonb_build_array(pg_temp.l(12, 1) || jsonb_build_object(
    'precio_referencia', 5000, 'promocion_id', 'e1000000-0000-0000-0000-000000000001', 'precio_unitario', 1, 'descuento_pct', 50))),
  '1000.00|-|0.00|x1|false', 'inyectar referencia, promoción, precio o descuento en p_lineas no cambia nada (sin promoción)');
select is(pg_temp.promo('inyec'), null::uuid, 'la promoción inyectada no se guarda');
select is(pg_temp.guardar_res('inyec', jsonb_build_array(pg_temp.l(1, 1) || jsonb_build_object(
    'precio_referencia', 5000, 'promocion_id', 'e1000000-0000-0000-0000-000000000002'))),
  '900.00|1000.00|0.00|x1|false', 'con promoción real, las claves inyectadas no pisan el snapshot (referencia 1000)');
select is(pg_temp.promo('inyec'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'la promoción guardada es la real, no la inyectada (otra tienda)');

-- ============================================================================
-- obtener_comprobante: expone precio_referencia y NO promocion_id (FR-015)
-- ============================================================================

select pg_temp.guardar('inyec', jsonb_build_array(pg_temp.l(1, 1), pg_temp.l(12, 1)));
select is((public.obtener_comprobante(pg_temp.id_de('inyec')) -> 'lineas' -> 0 ->> 'precio_referencia')::numeric, 1000.00,
  'obtener_comprobante devuelve precio_referencia de la línea en promoción');
select is(public.obtener_comprobante(pg_temp.id_de('inyec')) -> 'lineas' -> 1 -> 'precio_referencia', 'null'::jsonb,
  'la línea sin promoción devuelve precio_referencia null');
select is((public.obtener_comprobante(pg_temp.id_de('inyec')) -> 'lineas' -> 0) ? 'promocion_id', false,
  'obtener_comprobante NO expone promocion_id');
select ok((public.obtener_comprobante(pg_temp.id_de('inyec')) -> 'lineas' -> 0) ?& array['id', 'orden', 'precio_unitario', 'escala', 'precio_manual', 'descuento_pct', 'sin_stock', 'subtotal_sin_iva', 'iva'],
  'obtener_comprobante conserva las claves existentes de cada línea');

-- ============================================================================
-- Snapshot inmutable: cambiar, anular o vencer la promoción tras confirmar (FR-007, SC-003)
-- ============================================================================

select pg_temp.crear('fact1', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('fact1', jsonb_build_array(pg_temp.l(1, 2)));
select is(pg_temp.res('fact1'), '900.00|1000.00|0.00|x1|false', 'la factura a confirmar quedó con la promoción');
select lives_ok(format($$select public.confirmar_comprobante(%L)$$, pg_temp.id_de('fact1')), 'se confirma la factura promocional');
select is((select c.estado from dominio.comprobantes_venta c where c.id = pg_temp.id_de('fact1')), 'confirmada', 'la factura quedó confirmada');
select is(pg_temp.total('fact1'), '1800.00/2178.00', 'total de la factura confirmada: 2 × 900 + IVA 21 %');
reset role;
update dominio.promociones_precio set precio_promocional = 500 where id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.res('fact1'), '900.00|1000.00|0.00|x1|false', 'editar el precio de la promoción no cambia la línea emitida');
update dominio.promociones_precio set anulada_at = now() where id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.res('fact1'), '900.00|1000.00|0.00|x1|false', 'anular la promoción no cambia la línea emitida');
update dominio.promociones_precio set anulada_at = null, desde = now() - interval '3 days', hasta = now() - interval '2 days' where id = 'e1000000-0000-0000-0000-000000000001';
select is(pg_temp.res('fact1'), '900.00|1000.00|0.00|x1|false', 'vencer la promoción no cambia la línea emitida');
select is(pg_temp.total('fact1'), '1800.00/2178.00', 'ni el total de la factura emitida cambia');
select is(pg_temp.promo('fact1'), 'e1000000-0000-0000-0000-000000000001'::uuid, 'la trazabilidad a la promoción se conserva');
-- CHECK de la línea (M-B): referencia y promoción van juntas, y la referencia nunca es menor al precio cobrado.
select ok(exists (select 1 from pg_constraint where conname = 'comprobantes_venta_lineas_promocion_juntas_chk' and contype = 'c'),
  'existe el check «referencia y promoción van juntas»');
select ok(exists (select 1 from pg_constraint where conname = 'comprobantes_venta_lineas_precio_referencia_chk' and contype = 'c'),
  'existe el check «referencia >= precio cobrado»');
select throws_ok(format($$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, precio_referencia)
    select organizacion_id, comprobante_id, 99, producto_id, 'x', 1, 5, 'x1', deposito_id, 5, 0, 9 from dominio.comprobantes_venta_lineas where comprobante_id = %L limit 1$$, pg_temp.id_de('fact1')),
  '23514', 'new row for relation "comprobantes_venta_lineas" violates check constraint "comprobantes_venta_lineas_promocion_juntas_chk"',
  'check: una referencia sin promoción se rechaza (23514)');
select throws_ok(format($$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, precio_referencia, promocion_id)
    select organizacion_id, comprobante_id, 99, producto_id, 'x', 1, 5, 'x1', deposito_id, 5, 0, 1, 'e1000000-0000-0000-0000-000000000001' from dominio.comprobantes_venta_lineas where comprobante_id = %L limit 1$$, pg_temp.id_de('fact1')),
  '23514', 'new row for relation "comprobantes_venta_lineas" violates check constraint "comprobantes_venta_lineas_precio_referencia_chk"',
  'check: una referencia menor al precio cobrado se rechaza (23514)');
select throws_ok(format($$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, promocion_id)
    select organizacion_id, comprobante_id, 99, producto_id, 'x', 1, 5, 'x1', deposito_id, 5, 0, 'e1000000-0000-0000-0000-000000000001' from dominio.comprobantes_venta_lineas where comprobante_id = %L limit 1$$, pg_temp.id_de('fact1')),
  '23514', null, 'check: una promoción sin referencia se rechaza (23514)');
select lives_ok(format($$insert into dominio.comprobantes_venta_lineas (organizacion_id, comprobante_id, orden, producto_id, descripcion, cantidad, precio_unitario, escala, deposito_id, subtotal_sin_iva, iva, precio_referencia, promocion_id)
    select organizacion_id, comprobante_id, 99, producto_id, 'x', 1, 5, 'x1', deposito_id, 5, 0, 5, 'e1000000-0000-0000-0000-000000000001' from dominio.comprobantes_venta_lineas where comprobante_id = %L limit 1$$, pg_temp.id_de('fact1')),
  'check: referencia igual al precio cobrado con su promoción es válida (la función solo la guarda si es mayor)');
delete from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('fact1') and orden = 99;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select throws_ok(format($$select public.guardar_lineas_comprobante(%L, %L::jsonb, %L)$$, pg_temp.id_de('fact1'),
    jsonb_build_array(pg_temp.l(1, 1))::text, pg_temp.upd('fact1')),
  '55000', null, 'la factura confirmada sigue rechazando el guardado de líneas');
-- Con la promoción vencida, un borrador nuevo ya cobra el precio normal
select pg_temp.crear('post', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select is(pg_temp.guardar_res('post', jsonb_build_array(pg_temp.l(1, 1))), '1000.00|-|0.00|x1|false', 'con la promoción vencida un borrador nuevo cobra 1000');
-- Se restaura la promoción para los siguientes bloques.
reset role;
update dominio.promociones_precio set precio_promocional = 900, desde = now() - interval '1 day', hasta = now() + interval '1 day'
 where id = 'e1000000-0000-0000-0000-000000000001';

-- ============================================================================
-- Copiar presupuesto (FR-010): misma función, SIN descuento del cliente, manual conservado
-- ============================================================================

select pg_temp.bandera(false);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('pres', 'presupuesto', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003');
select pg_temp.guardar('pres', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(4, 1, 640)));
select is((select string_agg(l.precio_unitario::text || ':' || l.descuento_pct::text, ' ' order by l.orden) from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = pg_temp.id_de('pres')), '950.00:5.00 640.00:0.00', 'presupuesto original (bandera apagada): descuento 5 % y un manual');
create temp table copias (clave text primary key, id uuid);
grant select, insert on copias to public;
insert into copias select 'apagada', c.id from public.copiar_presupuesto(pg_temp.id_de('pres')) c;
select is((select string_agg(l.precio_unitario::text || ':' || l.descuento_pct::text || ':' || coalesce(l.precio_referencia::text, '-'), ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from copias where clave = 'apagada')),
  '1000.00:0.00:- 640.00:0.00:-', 'copiar con bandera apagada: igual que hoy (lista sin descuento del cliente, manual conservado, sin referencia)');
select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into copias select 'encendida', c.id from public.copiar_presupuesto(pg_temp.id_de('pres')) c;
select is((select string_agg(l.precio_unitario::text || ':' || l.descuento_pct::text || ':' || coalesce(l.precio_referencia::text, '-'), ' ' order by l.orden)
             from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from copias where clave = 'encendida')),
  '900.00:0.00:1000.00 640.00:0.00:-', 'copiar con bandera encendida: promoción 900 (referencia 1000 sin descuento del cliente) y el manual conservado');
select is((select l.promocion_id from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = (select id from copias where clave = 'encendida') order by l.orden limit 1),
  'e1000000-0000-0000-0000-000000000001'::uuid, 'la copia guarda la promoción aplicada');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('pres') and promocion_id is not null), 0,
  'el presupuesto original no se modifica al copiarlo');

-- Reloj de copiar_presupuesto: clock_timestamp() y no el now() de la transacción (la promoción de P15 se reprograma 1,5 s adelante).
select pg_temp.crear('pres_reloj', 'presupuesto', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('pres_reloj', jsonb_build_array(pg_temp.l(15, 1)));
reset role;
update dominio.promociones_precio set desde = clock_timestamp() + interval '1.5 seconds' where id = 'e1000000-0000-0000-0000-000000000014';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
insert into copias select 'reloj1', c.id from public.copiar_presupuesto(pg_temp.id_de('pres_reloj')) c;
select is((select l.precio_unitario::text || ':' || coalesce(l.precio_referencia::text, '-') from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = (select id from copias where clave = 'reloj1')), '1000.00:-', 'copiar: antes de que empiece la promoción cobra 1000');
select pg_sleep(2);
insert into copias select 'reloj2', c.id from public.copiar_presupuesto(pg_temp.id_de('pres_reloj')) c;
select is((select l.precio_unitario::text || ':' || coalesce(l.precio_referencia::text, '-') from dominio.comprobantes_venta_lineas l
            where l.comprobante_id = (select id from copias where clave = 'reloj2')), '700.00:1000.00',
  'copiar: pasado `desde` (clock_timestamp, no now()) cobra la promoción');

-- ============================================================================
-- Notas de crédito: la devolución es al precio cobrado y hereda las columnas (FR-011)
-- ============================================================================

select pg_temp.crear('nc_total', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('nc_total', jsonb_build_array(pg_temp.l(1, 2), pg_temp.l(12, 1)));
select pg_temp.crear('nc_parcial', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
select pg_temp.guardar('nc_parcial', jsonb_build_array(pg_temp.l(1, 3)));
select public.confirmar_comprobante(pg_temp.id_de('nc_total'));
select public.confirmar_comprobante(pg_temp.id_de('nc_parcial'));
select pg_temp.como('f1000000-0000-0000-0000-000000000001');
create function pg_temp.linea_de(p_clave text, p_orden integer) returns uuid language sql security definer as $$
  select l.id from dominio.comprobantes_venta_lineas l where l.comprobante_id = (select id from comps where clave = p_clave) and l.orden = p_orden $$;
grant execute on function pg_temp.linea_de(text, integer) to public;

select lives_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('nc_total'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('nc_total', 1), 'cantidad', 2), jsonb_build_object('linea_id', pg_temp.linea_de('nc_total', 2), 'cantidad', 1))::text),
  'nota de crédito total sobre una factura con una línea promocional');
select is((select l.precio_unitario::text || '|' || l.precio_referencia::text || '|' || (l.promocion_id = 'e1000000-0000-0000-0000-000000000001')::text
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc_total') and l.orden = 1),
  '900.00|1000.00|true', 'la nota devuelve al precio cobrado (900) y hereda precio_referencia y promocion_id');
select is((select l.precio_referencia is null and l.promocion_id is null
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc_total') and l.orden = 2), true,
  'la línea sin promoción de la nota queda sin referencia ni promoción');
select is((select n.total_sin_iva from dominio.comprobantes_venta n where n.comprobante_origen_id = pg_temp.id_de('nc_total')),
  2800.00, 'la nota total acredita 2 × 900 + 1000 sin IVA (el importe cobrado)');
select lives_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('nc_parcial'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('nc_parcial', 1), 'cantidad', 1))::text), 'primera nota parcial (1 de 3)');
select lives_ok(format($$select public.emitir_nota_credito(%L, 'devolucion_productos', %L::jsonb, null)$$, pg_temp.id_de('nc_parcial'),
    jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea_de('nc_parcial', 1), 'cantidad', 2))::text), 'segunda nota parcial (los 2 restantes)');
select is((select array_agg(l.precio_unitario::text || '|' || l.precio_referencia::text || '|' || l.cantidad::text order by l.cantidad)
             from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.comprobante_origen_id = pg_temp.id_de('nc_parcial')), array['900.00|1000.00|1', '900.00|1000.00|2'],
  'las notas parciales heredan precio cobrado y referencia');
select is((select sum(n.total_sin_iva) from dominio.comprobantes_venta n where n.comprobante_origen_id = pg_temp.id_de('nc_parcial')),
  (select f.total_sin_iva from dominio.comprobantes_venta f where f.id = pg_temp.id_de('nc_parcial')),
  'las notas parciales suman exactamente el neto cobrado (sin deriva)');
select is((select count(*)::int from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta n on n.id = l.comprobante_id
            where n.tipo = 'nota_credito' and (l.precio_referencia is null) <> (l.promocion_id is null)), 0,
  'ninguna línea de nota queda con una sola de las dos columnas');

-- ============================================================================
-- Baja de una organización con una línea promocional (FK no action, R3e)
-- ============================================================================

select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select pg_temp.crear('org2', 'factura', 'a2000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000009');
select is(pg_temp.guardar_res('org2', jsonb_build_array(jsonb_build_object('producto_id', 'b2000000-0000-0000-0000-000000000011', 'cantidad', 1))),
  '400.00|500.00|0.00|x1|false', 'la organización dos cobra su propia promoción (400) y no la de la uno');
reset role;
select is((select count(*)::int from dominio.comprobantes_venta_lineas where organizacion_id = '22222222-2222-2222-2222-222222222222' and promocion_id is not null),
  1, 'hay una línea promocional en la organización dos');
-- La baja la hace el equipo técnico (sin sesión de usuario: los disparadores de actividad no registran).
select set_config('request.jwt.claims', '', true);
-- Nota: con la FK en RESTRICT esta baja TAMBIÉN pasa (probado: la cascada borra línea y promoción en la misma
-- sentencia), así que la aserción de comportamiento no discrimina; el contrato de esquema (`confdeltype = 'a'`, arriba)
-- es la que fija `no action`. Esta aserción cubre que la baja funciona con una línea promocional.
select lives_ok($$delete from public.organizaciones where id = '22222222-2222-2222-2222-222222222222'$$,
  'la baja de una organización con una línea promocional funciona (el contrato de esquema no action se afirma arriba)');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where organizacion_id = '22222222-2222-2222-2222-222222222222')
        + (select count(*)::int from dominio.promociones_precio where organizacion_id = '22222222-2222-2222-2222-222222222222'), 0,
  'la baja se llevó las líneas y las promociones de la organización');

-- ============================================================================
-- Rendimiento: 200 líneas con una promoción en cada producto, bandera apagada contra encendida (FR-024)
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.crear('masivo', 'factura', 'a1000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
create temp table medidas (bandera boolean, ms numeric);
grant select, insert on medidas to public;
create temp table lineas200 as
  select jsonb_agg(jsonb_build_object('producto_id', p.id, 'cantidad', 1) order by p.sku) as lineas
    from dominio.productos p where p.sku like 'M-%';
grant select on lineas200 to public;
create function pg_temp.medir(p_bandera boolean) returns void language plpgsql as $$
declare v_t timestamptz;
begin
  v_t := clock_timestamp();
  perform pg_temp.guardar('masivo', (select lineas from lineas200));
  insert into medidas values (p_bandera, extract(epoch from clock_timestamp() - v_t) * 1000);
end $$;
select pg_temp.medir(true);   -- calentamiento (no cuenta)
delete from medidas;
select pg_temp.medir(true); select pg_temp.medir(true); select pg_temp.medir(true); select pg_temp.medir(true); select pg_temp.medir(true);
select pg_temp.bandera(false);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.medir(false); select pg_temp.medir(false); select pg_temp.medir(false); select pg_temp.medir(false); select pg_temp.medir(false);
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('masivo')), 200, 'el comprobante masivo guardó 200 líneas');
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('masivo') and promocion_id is not null), 0,
  'con la bandera apagada ninguna de las 200 líneas lleva promoción');
select pg_temp.bandera(true);
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.guardar('masivo', (select lineas from lineas200));
select is((select count(*)::int from dominio.comprobantes_venta_lineas where comprobante_id = pg_temp.id_de('masivo') and promocion_id is not null), 200,
  'con la bandera encendida las 200 líneas llevan su promoción');
select diag(format('FR-024: 200 líneas, mediana de 5 corridas: apagada = %s ms, encendida = %s ms, razón = %s',
  (select round(percentile_cont(0.5) within group (order by ms)::numeric, 1) from medidas where not bandera), (select round(percentile_cont(0.5) within group (order by ms)::numeric, 1) from medidas where bandera),
  (select round((select percentile_cont(0.5) within group (order by ms) from medidas where bandera)::numeric
               / (select percentile_cont(0.5) within group (order by ms) from medidas where not bandera)::numeric, 2))));
select ok((select percentile_cont(0.5) within group (order by ms) from medidas where bandera) < 1.5 * (select percentile_cont(0.5) within group (order by ms) from medidas where not bandera),
  'FR-024: guardar 200 líneas con la bandera encendida tarda menos de 1,5× que con la apagada');

select * from finish();
rollback;
