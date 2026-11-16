-- F-CLI-21 (MSF-453, spec 20270327-100000-listas-de-precios-por-cliente, Fase 3, T015 y T018): motor de precio con la lista del cliente.
-- Dueño de RF-CLI-21-4 y SC-001. Dos bloques:
--   1. PARIDAD (CA-CLI-21-6, D13): contra una COPIA CONGELADA del cálculo anterior (`20270322100000`, embebida abajo como funciones
--      temporales `old_para` / `old_linea`), sobre una matriz de productos (central, precio propio, escala, promoción, USD, exento),
--      tiendas (con ajuste y sin ajuste), clientes (minorista, mayorista, con descuento personal, con lista), tipos y cantidades:
--        · con la bandera `listas_precios` APAGADA, el resultado es idéntico para TODOS los clientes, aun con lista asignada;
--        · con la bandera encendida, idéntico para los clientes SIN lista;
--        · con y sin la bandera `promociones_precio`.
--   2. PRECEDENCIA (D3, D5, D6, D7): cada regla con valores calculados a mano.
-- El fixture corre como postgres; las funciones de cálculo no tienen `execute` para `authenticated`.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- A: regla central +30 % (redondeo 10); B: central sin ajuste; C: otra organización.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, redondeo_pesos) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 30, 10),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, 10);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1200);

-- Productos (n = 1…10), todos con la categoría de IVA 21 %:
--   1 central 1000 · 2 central 1234,56 · 3 precio propio de A (950) · 4 escalas x5 = 800 y x10 = 700 · 5 en dólares (2 USD)
--   6 exento · 7 promoción en A de 500 · 8 promoción en A igual a la lista (800) · 9 promoción en A de 900
--   10 precio propio de A (950) y escala x5 = 800
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'P-' || n,
       case when n = 5 then 'USD' else 'ARS' end,
       case n when 2 then 1234.56 when 5 then 2 else 1000 end,
       'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 10) n;
update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'b1000000-0000-0000-0000-000000000006';
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950),
  ('b1000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'x5', 800),
  ('b1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'x10', 700),
  ('b1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'x5', 800);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, p.organizacion_id
  from dominio.productos p
  join dominio.empresas e on e.organizacion_id = p.organizacion_id and e.nombre in ('Tienda A', 'Tienda B')
on conflict do nothing;

-- Promociones vigentes ahora (± 1 día) en la tienda A.
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 500, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000008', 800, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000009', 900, now() - interval '1 day', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1250, now() - interval '1 day', now() + interval '1 day');

-- Listas: L1 Revendedores −20 %, L2 Recargo +10 %, L3 Cero 0 %, y una de la otra organización.
insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Revendedores', -20),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Recargo', 10),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cero', 0),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajena', -50);

-- Clientes (k): 1 minorista sin lista · 2 mayorista sin lista · 3 minorista con descuento 10 % sin lista
--   4 minorista con L1 · 5 mayorista con L1 · 6 minorista con L1 y descuento 10 % · 7 minorista con L2 · 8 minorista con L3
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, descuento)
select ('c1000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111', 100 + k, 'Cliente ' || k,
       case when k in (2, 5) then 'mayorista' else 'minorista' end,
       case when k in (3, 6) then 10 else 0 end
  from generate_series(1, 8) k;
update dominio.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000001' where id in
  ('c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000006');
update dominio.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000002' where id = 'c1000000-0000-0000-0000-000000000007';
update dominio.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000003' where id = 'c1000000-0000-0000-0000-000000000008';

-- ============================================================================
-- Copia congelada del cálculo ANTERIOR (cuerpos de 20270322100000, sin tocar)
-- ============================================================================

create or replace function pg_temp.old_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  left join dominio.precios_propios_empresa pp
    on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
  left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
  left join dominio.alicuotas_iva al
    on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null)
          then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  where p.id = p_producto;
end;
$$;

create or replace function pg_temp.old_linea(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_pr_id uuid;
  v_pr_precio numeric;
  v_d numeric;
  v_normal numeric;
begin
  select * into v_p
    from pg_temp.old_para(p_producto, p_empresa, private.escala_para_linea(p_tipo_cliente, p_cantidad));
  if not found then
    return;
  end if;

  -- Precio normal de la línea: la misma expresión de `precio_linea_venta` (y, antes, de guardar_lineas_comprobante).
  v_d := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_p.neto * (1 - v_d / 100), 2);

  -- La promoción solo se consulta cuando el precio normal existe (una sola búsqueda indexada por línea).
  if v_normal is not null then
    select f.promocion_id, f.precio into v_pr_id, v_pr_precio
      from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora) f;
  end if;

  if v_normal is not null and v_pr_precio is not null and v_pr_precio < v_normal then
    return query select v_p.escala_usada, v_pr_precio, v_normal, v_pr_id, 0::numeric,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  else
    return query select v_p.escala_usada, v_normal, null::numeric, null::uuid, v_d,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  end if;
end;
$$;

-- ============================================================================
-- Bloque 1: PARIDAD con el cálculo anterior
-- ============================================================================

create temp table casos on commit drop as
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid as producto, e.empresa,
       ('c1000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid as cliente, c.tipo, c.descuento, c.lista_precio_id, q.cantidad
  from generate_series(1, 10) n
 cross join (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000002'::uuid)) e(empresa)
 cross join generate_series(1, 8) k
  join dominio.clientes c on c.id = ('c1000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid
 cross join (values (1), (4), (5), (9), (10), (49), (50), (100)) q(cantidad);

select cmp_ok((select count(*) from casos)::int, '=', 1280, 'la matriz tiene 10 productos x 2 tiendas x 8 clientes x 8 cantidades');

-- Un instante fijo para todos los cálculos.
create function pg_temp.dif(p_solo_sin_lista boolean) returns integer language sql as $$
  with viejo as (
    select c.producto, c.empresa, c.cliente, c.cantidad,
           o.escala_usada, o.neto_unitario, o.precio_referencia, o.promocion_id, o.descuento_aplicado, o.alicuota_id,
           o.alicuota_porcentaje, o.alicuota_exenta
      from casos c
      cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o
     where not p_solo_sin_lista or c.lista_precio_id is null
  ), nuevo as (
    select c.producto, c.empresa, c.cliente, c.cantidad,
           n.escala_usada, n.neto_unitario, n.precio_referencia, n.promocion_id, n.descuento_aplicado, n.alicuota_id,
           n.alicuota_porcentaje, n.alicuota_exenta
      from casos c
      cross join lateral private.precio_linea_venta_calculo(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true, c.cliente) n
     where not p_solo_sin_lista or c.lista_precio_id is null
  )
  select ((select count(*) from (select * from viejo except select * from nuevo) a)
        + (select count(*) from (select * from nuevo except select * from viejo) b))::integer
$$;

create function pg_temp.dif_para(p_solo_sin_lista boolean) returns integer language sql as $$
  with viejo as (
    select c.producto, c.empresa, c.cantidad, o.escala_usada, o.neto, o.alicuota_id, o.alicuota_nombre, o.alicuota_porcentaje, o.alicuota_exenta, o.final
      from casos c
      cross join lateral pg_temp.old_para(c.producto, c.empresa, private.escala_para_linea(c.tipo, c.cantidad)) o
     where not p_solo_sin_lista or c.lista_precio_id is null
  ), nuevo as (
    select c.producto, c.empresa, c.cantidad, n.escala_usada, n.neto, n.alicuota_id, n.alicuota_nombre, n.alicuota_porcentaje, n.alicuota_exenta, n.final
      from casos c
      cross join lateral private.precio_para_calculo(c.producto, c.empresa, private.escala_para_linea(c.tipo, c.cantidad), c.cliente) n
     where not p_solo_sin_lista or c.lista_precio_id is null
  )
  select ((select count(*) from (select * from viejo except select * from nuevo) a)
        + (select count(*) from (select * from nuevo except select * from viejo) b))::integer
$$;

-- 1a. Bandera listas_precios APAGADA (estado de nacimiento): idéntico para TODOS los clientes, también con promociones apagadas y encendidas.
select is((select active from (select activa as active from public.banderas_plataforma where clave = 'listas_precios') x), false, 'la bandera listas_precios nace apagada');

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select is(pg_temp.dif(false), 0, 'PARIDAD con la bandera listas_precios apagada y promociones encendidas: precio de línea idéntico para los 1280 casos (clientes con lista incluidos)');
select is(pg_temp.dif_para(false), 0, 'PARIDAD con la bandera apagada: precio_para_calculo idéntico (neto, alícuota y final) para los 1280 casos');
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select is(pg_temp.dif(false), 0, 'PARIDAD con la bandera apagada y promociones apagadas: idéntico para los 1280 casos');

-- Cobertura de la matriz: no es trivial.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select cmp_ok((select count(*) from casos c cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o where o.promocion_id is not null)::int, '>=', 100,
  'cobertura: al menos 100 casos de la matriz terminan con una promoción ganadora');
select cmp_ok((select count(*) from casos c cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o where o.escala_usada <> 'x1')::int, '>=', 20,
  'cobertura: al menos 20 casos usan una escala x5, x10 o x50');
select cmp_ok((select count(*) from casos c cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o where o.descuento_aplicado > 0)::int, '>=', 100,
  'cobertura: al menos 100 casos aplican el descuento personal');
select cmp_ok((select count(*) from casos c cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o where o.alicuota_exenta)::int, '>=', 50,
  'cobertura: al menos 50 casos son de un producto exento');
select cmp_ok((select count(*) from casos c cross join lateral pg_temp.old_linea(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true) o where c.producto = 'b1000000-0000-0000-0000-000000000005' and o.neto_unitario is not null)::int, '>=', 100,
  'cobertura: el producto en dólares tiene precio en la matriz');

-- La bandera apagada tampoco deja huella en las columnas nuevas.
select is((select count(*)::int from casos c cross join lateral private.precio_linea_venta_calculo(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true, c.cliente) n
            where n.lista_precio_id is not null or n.lista_ajuste_pct is not null), 0,
  'con la bandera apagada ninguna línea devuelve lista (lista_precio_id y lista_ajuste_pct nulos)');
select is((select count(*)::int from casos c cross join lateral private.lista_precios_cliente(c.cliente, '11111111-1111-1111-1111-111111111111') l), 0,
  'con la bandera apagada private.lista_precios_cliente no devuelve filas ni para un cliente con lista');

-- 1b. Bandera ENCENDIDA: idéntico para los clientes SIN lista (promociones encendidas y apagadas).
update public.banderas_plataforma set activa = true where clave = 'listas_precios';
select is(pg_temp.dif(true), 0, 'PARIDAD con la bandera encendida: los clientes sin lista tienen el mismo precio de línea que antes (promociones encendidas)');
select is(pg_temp.dif_para(true), 0, 'PARIDAD con la bandera encendida: precio_para_calculo de los clientes sin lista idéntico');
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select is(pg_temp.dif(true), 0, 'PARIDAD con la bandera encendida y promociones apagadas: los clientes sin lista idénticos');
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
select cmp_ok((select count(*) from casos where lista_precio_id is null)::int, '=', 480, 'la comparación sin lista cubre 480 casos (3 clientes)');
select is((select count(*)::int from casos c cross join lateral private.precio_linea_venta_calculo(c.producto, c.empresa, c.tipo, c.cantidad, c.descuento, now(), true, c.cliente) n
            where c.lista_precio_id is null and (n.lista_precio_id is not null or n.lista_ajuste_pct is not null)), 0,
  'un cliente sin lista nunca devuelve lista, ni con la bandera encendida');
select is((select count(*)::int from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true, null)), 1,
  'sin cliente (null) el motor responde igual que antes');

-- ============================================================================
-- Bloque 2: PRECEDENCIA (bandera listas_precios encendida)
-- ============================================================================

create function pg_temp.lin(p_n integer, p_tienda text, p_k integer, p_cant integer default 1)
returns table (escala_usada text, neto_unitario numeric, precio_referencia numeric, promocion_id uuid, descuento_aplicado numeric,
               alicuota_id uuid, alicuota_porcentaje numeric, alicuota_exenta boolean, lista_precio_id uuid, lista_ajuste_pct numeric)
language sql as $$
  select n.*
    from dominio.clientes c
   cross join lateral private.precio_linea_venta_calculo(
         ('b1000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid,
         case p_tienda when 'A' then 'a1000000-0000-0000-0000-000000000001'::uuid else 'a1000000-0000-0000-0000-000000000002'::uuid end,
         c.tipo, p_cant, coalesce(c.descuento, 0), now(), true, c.id) n
   where c.id = ('c1000000-0000-0000-0000-' || lpad(p_k::text, 12, '0'))::uuid
$$;

-- D3: la lista REEMPLAZA el ajuste de la tienda: central × (1 + ajuste), redondeo de la tienda, sin IVA.
select is((select neto_unitario from pg_temp.lin(1, 'A', 4)), 800::numeric, 'D3 · lista −20 % sobre central 1000 en la tienda A (+30 %): 800, no 1040 ni 1300');
select is((select neto_unitario from pg_temp.lin(1, 'B', 4)), 800::numeric, 'D3 · la misma lista en la tienda B (sin ajuste): 800');

select is((select neto_unitario from pg_temp.lin(2, 'B', 4)), 990::numeric, 'D3 · redondeo de la tienda: 1234,56 × 0,80 = 987,648 se redondea a 990');
select is((select neto_unitario from pg_temp.lin(2, 'B', 1)), 1234.56::numeric, 'sin lista la tienda B (central) conserva los centavos: 1234,56');
select is((select lista_precio_id from pg_temp.lin(1, 'A', 4)), 'd1000000-0000-0000-0000-000000000001'::uuid, 'la línea devuelve la lista que fijó el precio');
select is((select lista_ajuste_pct from pg_temp.lin(1, 'A', 4)), -20::numeric, 'y su porcentaje (snapshot)');
select is((select neto_unitario from pg_temp.lin(1, 'A', 7)), 1100::numeric, 'lista con recargo +10 %: 1100 (promoción de 1250 no gana)');
select is((select neto_unitario from pg_temp.lin(1, 'A', 8)), 1000::numeric, 'lista de 0 %: el central puro, 1000, SIN el +30 % de la tienda');
select is((select neto_unitario from pg_temp.lin(1, 'B', 8)), 1000::numeric, 'lista de 0 % en la tienda B: 1000');
select is((select neto_unitario from pg_temp.lin(5, 'A', 4)), 1920::numeric, 'USD: 2 USD × 1200 = 2400 en pesos, × 0,80 = 1920 con la lista');
select is((select neto_unitario from pg_temp.lin(5, 'A', 1)), 3120::numeric, 'USD sin lista en la tienda A (+30 %): 3120');
select is((select neto_unitario from pg_temp.lin(6, 'B', 4)), 800::numeric, 'producto exento con lista: 800 sin IVA');
select is((select alicuota_exenta from pg_temp.lin(6, 'B', 4)), true, 'y sigue marcado exento');
select is((select alicuota_porcentaje from pg_temp.lin(1, 'B', 4)), 21::numeric, 'la alícuota sigue saliendo del producto (21 %): el IVA se aplica después y la lista es sin IVA');
select is((select final from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'x1', 'c1000000-0000-0000-0000-000000000004')), 968::numeric,
  'precio_para_calculo con la lista: final = 800 + 21 % de IVA = 968');

-- D5: precio propio y escala cargada ganan a la lista.
select is((select neto_unitario from pg_temp.lin(3, 'A', 4)), 950::numeric, 'D5 · precio propio de la tienda A: 950, la lista no rige');
select is((select lista_precio_id from pg_temp.lin(3, 'A', 4)), null::uuid, 'D5 · y la línea no guarda lista');
select is((select neto_unitario from pg_temp.lin(3, 'B', 4)), 800::numeric, 'D5 · el mismo producto en la tienda B (sin precio propio): la lista rige, 800');
select is((select neto_unitario from pg_temp.lin(4, 'B', 5, 5)), 800::numeric, 'D5 · mayorista con lista que compra 5 con escala x5 cargada (800): rige la escala');
select is((select escala_usada from pg_temp.lin(4, 'B', 5, 5)), 'x5', 'D5 · y la escala usada es x5');
select is((select lista_precio_id from pg_temp.lin(4, 'B', 5, 5)), null::uuid, 'D5 · la línea con escala no guarda lista');
select is((select neto_unitario from pg_temp.lin(4, 'B', 5, 10)), 700::numeric, 'D5 · x10 cargada: 700 (la lista de 800 no rige)');
select is((select neto_unitario from pg_temp.lin(4, 'A', 5, 5)), 1040::numeric, 'D5 · escala x5 en la tienda A: 800 con el +30 % de la tienda = 1040 (la lista no la reemplaza)');
select is((select neto_unitario from pg_temp.lin(4, 'B', 5, 50)), 800::numeric, 'D5 · cantidad 50 sin x50 cargada: cae a x1 y rige la lista (800)');
select is((select escala_usada from pg_temp.lin(4, 'B', 5, 50)), 'x1', 'D5 · escala usada x1 cuando la x50 no está cargada');
select is((select neto_unitario from pg_temp.lin(4, 'B', 5, 1)), 800::numeric, 'D5 · el mayorista que compra 1 unidad paga la lista (800)');
select is((select neto_unitario from pg_temp.lin(4, 'B', 4, 10)), 800::numeric, 'D8 · el minorista nunca usa escalas: con la lista paga 800 aunque compre 10');
select is((select neto_unitario from pg_temp.lin(10, 'A', 5, 1)), 950::numeric, 'D5 · precio propio y escala en el mismo producto: con 1 unidad rige el precio propio (950)');
select is((select neto_unitario from pg_temp.lin(10, 'A', 5, 5)), 1040::numeric, 'D5 · y con 5 unidades rige la escala (800 + 30 %), no el precio propio ni la lista');

-- D6: la lista y el descuento personal no se acumulan.
select is((select neto_unitario from pg_temp.lin(1, 'B', 6)), 800::numeric, 'D6 · cliente con lista y descuento del 10 %: 800, el descuento no se aplica');
select is((select descuento_aplicado from pg_temp.lin(1, 'B', 6)), 0::numeric, 'D6 · y descuento_aplicado es 0');
select is((select neto_unitario from pg_temp.lin(1, 'B', 3)), 900::numeric, 'D6 · sin lista el descuento personal rige como antes: 1000 − 10 % = 900');
select is((select descuento_aplicado from pg_temp.lin(1, 'B', 3)), 10::numeric, 'D6 · con descuento_aplicado = 10');
select is((select neto_unitario from pg_temp.lin(3, 'A', 6)), 855::numeric, 'D6 · en una línea con precio propio (950) el descuento personal SÍ rige: 855');
select is((select descuento_aplicado from pg_temp.lin(3, 'A', 6)), 10::numeric, 'D6 · y se informa 10');

-- D7: frente a una promoción gana el más bajo, sin acumular; la referencia es el precio de lista.
select is((select neto_unitario from pg_temp.lin(7, 'A', 4)), 500::numeric, 'D7 · promoción de 500 contra lista de 800: gana la promoción');
select is((select precio_referencia from pg_temp.lin(7, 'A', 4)), 800::numeric, 'D7 · la referencia es el precio de la lista (800)');
select ok((select promocion_id from pg_temp.lin(7, 'A', 4)) is not null, 'D7 · la línea trae la promoción');
select is((select lista_precio_id from pg_temp.lin(7, 'A', 4)), 'd1000000-0000-0000-0000-000000000001'::uuid, 'D7 · y conserva la lista que fijó la referencia');
select is((select neto_unitario from pg_temp.lin(8, 'A', 4)), 800::numeric, 'D7 · promoción IGUAL al precio de lista: rige la lista');
select ok((select promocion_id from pg_temp.lin(8, 'A', 4)) is null, 'D7 · sin promoción en la línea (la comparación es estricta)');
select is((select neto_unitario from pg_temp.lin(9, 'A', 4)), 800::numeric, 'D7 · promoción de 900 MAYOR que la lista: rige la lista (800)');
select is((select neto_unitario from pg_temp.lin(9, 'A', 1)), 900::numeric, 'D7 · el cliente sin lista de la misma tienda SÍ se queda con la promoción de 900 (la regla da 1300)');
select is((select precio_referencia from pg_temp.lin(9, 'A', 1)), 1300::numeric, 'D7 · y su referencia es 1300');
select is((select neto_unitario from pg_temp.lin(1, 'A', 1)), 1250::numeric, 'D7 · promoción 1250 contra la regla 1300 sin lista: 1250');
select is((select neto_unitario from pg_temp.lin(7, 'A', 7)), 500::numeric, 'D7 · lista con recargo (1100) y promoción de 500: gana la promoción');
select is((select precio_referencia from pg_temp.lin(7, 'A', 7)), 1100::numeric, 'D7 · y la referencia es el precio con recargo (1100)');
select is((select neto_unitario from pg_temp.lin(7, 'A', 6)), 500::numeric, 'D7 · la promoción tampoco acumula con el descuento personal: 500');
select is((select descuento_aplicado from pg_temp.lin(7, 'A', 6)), 0::numeric, 'D7 · descuento_aplicado 0 cuando gana la promoción');
update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
select is((select neto_unitario from pg_temp.lin(7, 'A', 4)), 800::numeric, 'con la bandera de promociones apagada la lista rige igual (800)');
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

-- Extremos de la lista: -90 % y +100 % (los topes del contrato), sin precio negativo ni cero.
insert into dominio.listas_precios (id, organizacion_id, nombre, ajuste_pct) values
  ('d1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Mínimo', -90),
  ('d1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Máximo', 100);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo, descuento, lista_precio_id) values
  ('c1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 109, 'Cliente 9', 'minorista', 0, 'd1000000-0000-0000-0000-000000000004'),
  ('c1000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 110, 'Cliente 10', 'minorista', 0, 'd1000000-0000-0000-0000-000000000005');
select is((select neto_unitario from pg_temp.lin(1, 'B', 9)), 100::numeric, 'extremo -90 %: 1000 × 0,10 = 100 (tienda B)');
select is((select neto_unitario from pg_temp.lin(1, 'A', 9)), 100::numeric, 'extremo -90 %: la tienda A (+30 %) no entra: 100');
select is((select neto_unitario from pg_temp.lin(2, 'B', 9)), 120::numeric, 'extremo -90 %: 1234,56 × 0,10 = 123,456 se redondea a 120');
select is((select lista_ajuste_pct from pg_temp.lin(1, 'B', 9)), -90::numeric, 'extremo -90 %: el snapshot guarda -90');
select is((select neto_unitario from pg_temp.lin(1, 'B', 10)), 2000::numeric, 'extremo +100 %: 1000 × 2 = 2000');
select is((select neto_unitario from pg_temp.lin(2, 'A', 10)), 2470::numeric, 'extremo +100 %: 1234,56 × 2 = 2469,12 se redondea a 2470');
select is((select lista_ajuste_pct from pg_temp.lin(1, 'B', 10)), 100::numeric, 'extremo +100 %: el snapshot guarda 100');
select is((select count(*)::int from pg_temp.lin(1, 'B', 9) where neto_unitario <= 0), 0, 'ningún extremo da precio cero ni negativo en productos normales');

-- D13 y casos borde de la lista.
update public.banderas_plataforma set activa = false where clave = 'listas_precios';
select is((select neto_unitario from pg_temp.lin(2, 'B', 4)), 1234.56::numeric, 'D13 · apagar la bandera devuelve al cliente con lista al precio normal al instante');
select is((select lista_precio_id from pg_temp.lin(2, 'B', 4)), null::uuid, 'D13 · y sin snapshot');
update public.banderas_plataforma set activa = true where clave = 'listas_precios';

update dominio.listas_precios set archivada_en = now() where id = 'd1000000-0000-0000-0000-000000000003';
select is((select neto_unitario from pg_temp.lin(1, 'B', 8)), 1000::numeric, 'una lista archivada que quedó asignada no rige (precio normal de la tienda B: 1000)');
select is((select neto_unitario from pg_temp.lin(1, 'A', 8)), 1250::numeric, 'una lista archivada: en A vuelve a la regla y a la promoción (1250)');
update dominio.listas_precios set archivada_en = null where id = 'd1000000-0000-0000-0000-000000000003';

select is((select count(*)::int from private.lista_precios_cliente('c1000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222')), 0,
  'un cliente no tiene lista si se pregunta desde otra organización');
select is((select count(*)::int from private.lista_precios_cliente('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111')), 1,
  'y sí con la suya');
select is((select count(*)::int from private.lista_precios_cliente(null, '11111111-1111-1111-1111-111111111111')), 0, 'sin cliente no hay lista');

alter table dominio.clientes disable trigger user;
update dominio.clientes set lista_precio_id = 'd1000000-0000-0000-0000-000000000001'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and es_consumidor_final;
alter table dominio.clientes enable trigger user;
select is((select count(*)::int from dominio.clientes c cross join lateral private.lista_precios_cliente(c.id, c.organizacion_id) l
            where c.es_consumidor_final and c.organizacion_id = '11111111-1111-1111-1111-111111111111'), 0,
  'el Consumidor final no recibe lista aunque una escritura directa se la haya puesto');

-- ============================================================================
-- Envoltorio de la sesión de panel y permisos
-- ============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is((select neto_unitario from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'minorista', 1, 0, now(), true, 'c1000000-0000-0000-0000-000000000004')),
  800::numeric, 'el envoltorio de la sesión de panel pasa el cliente y devuelve el precio de la lista');
select is((select neto_unitario from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'minorista', 1, 0, now(), true)),
  1000::numeric, 'y sin cliente devuelve el precio de siempre');
select is((select neto from private.precio_para('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'x1')), 1300::numeric,
  'private.precio_para (3 argumentos) no cambia: 1300 con la regla de la tienda A');
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'minorista', 1, 0, now(), true, 'c1000000-0000-0000-0000-000000000004')), 0,
  'el envoltorio sigue sin devolver filas para una tienda de otra organización');

select is(has_function_privilege('authenticated', 'private.precio_para(uuid, uuid, text)', 'execute'), true, 'precio_para conserva el execute de authenticated');
select is(has_function_privilege('authenticated', 'private.precio_para_calculo(uuid, uuid, text, uuid)', 'execute'), false, 'authenticated no ejecuta precio_para_calculo');
select is(has_function_privilege('service_role', 'private.precio_para_calculo(uuid, uuid, text, uuid)', 'execute'), false, 'service_role no ejecuta precio_para_calculo');
select is(has_function_privilege('anon', 'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)', 'execute'), false, 'anon no ejecuta precio_linea_venta_calculo');
select is(has_function_privilege('authenticated', 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)', 'execute'), false, 'authenticated no ejecuta precio_linea_venta');
select is(has_function_privilege('authenticated', 'private.lista_precios_cliente(uuid, uuid)', 'execute'), false, 'authenticated no ejecuta lista_precios_cliente');
select is(has_function_privilege('service_role', 'private.lista_precios_cliente(uuid, uuid)', 'execute'), false, 'service_role no ejecuta lista_precios_cliente');
select is((select count(*)::int from pg_proc where pronamespace = 'private'::regnamespace and proname in ('precio_para_calculo', 'precio_linea_venta_calculo', 'precio_linea_venta')), 3,
  'no quedan sobrecargas viejas: una sola firma por función');
select is((select count(*)::int from pg_proc p where p.oid in (
    'private.precio_para_calculo(uuid, uuid, text, uuid)'::regprocedure,
    'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)'::regprocedure,
    'private.lista_precios_cliente(uuid, uuid)'::regprocedure) and p.prosecdef and p.proconfig @> array['search_path=""']), 3,
  'las funciones del motor son security definer con search_path vacío');

select * from finish();
rollback;
