-- MSF-176 · Tienda compra y cuentas, historia B2, T051 (SC-003; decisión D-17): PARIDAD del cálculo de precio sin sesión.
--
-- La migración 20270322100000 extrae de `private.precio_para` y `private.precio_linea_venta` (MSF-816) su cálculo a
-- `private.precio_para_calculo` y `private.precio_linea_venta_calculo` (sin sesión de panel, acotadas por la organización de la
-- empresa) y deja las dos originales como envoltorios con su compuerta. Este test prueba, contra una COPIA LITERAL de los cuerpos
-- originales (`20270213200002` y `20270310100100`, creadas aquí como funciones temporales), que:
--   A. el refactor da EXACTAMENTE el mismo resultado que la función original, columna por columna, para una grilla grande
--      (escalas, tipos de cliente, cantidades, descuentos, listas de precios con y sin regla, monedas, precio propio, alícuotas
--      21 %/10,5 %/exenta/ninguna, promociones que ganan, empatan, pierden, vencidas, futuras, anuladas, bandera apagada);
--   B. el cálculo con un CLIENTE WEB (sin membresía de panel) da el mismo resultado que con la sesión de panel, con IVA y precio
--      propio correctos: los dos fallos silenciosos que motivaron D-17 (la copia sin compuerta de la función original los
--      reproduce: este bloque FALLA si se revierte la extracción);
--   C. los envoltorios conservan la compuerta (sin permiso de panel no hay precio) y el aislamiento por organización;
--   D. el refactor no abre superficie: ninguna de las funciones nuevas es ejecutable por `anon`, `authenticated`, `service_role` ni
--      `public`, y los envoltorios conservan sus grants.
-- El fixture corre como `postgres` con la sesión de un administrador (los llamadores reales de producción son funciones `security
-- definer`); el bloque C usa los roles `authenticated` y `anon` de verdad.
begin;

select plan(127);

-- ============================================================================
-- Copias LITERALES de las funciones originales (para comparar). No se tocan: si cambia la fórmula de producción, este test avisa.
-- ============================================================================

-- private.precio_para de 20270213200002_precio_propio_tienda_y_lineas.sql (security invoker, con su compuerta).
create function pg_temp.precio_para_original(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
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
security invoker
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;
  if (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion')
     and (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    return;
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.alicuota_id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  left join lateral private.precio_propio_empresa(p.id, e.id) pp on true
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null) then pp.neto_ars
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
end;
$$;

-- La misma función SIN la compuerta de sesión: lo que haría un cliente web si se llamara la original tal cual (D-17).
create function pg_temp.precio_para_original_sin_compuerta(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
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
  return query
  select
    x.usada,
    x.neto,
    al.alicuota_id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  left join lateral private.precio_propio_empresa(p.id, e.id) pp on true
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null) then pp.neto_ars
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
end;
$$;

-- private.precio_linea_venta de 20270310100100_precio_linea_venta.sql (security invoker), sobre la copia de precio_para.
create function pg_temp.precio_linea_venta_original(
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
security invoker
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
    from pg_temp.precio_para_original(p_producto, p_empresa, private.escala_para_linea(p_tipo_cliente, p_cantidad));
  if not found then
    return;
  end if;

  v_d := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_p.neto * (1 - v_d / 100), 2);

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
-- Fixture
-- ============================================================================

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'administrador@example.com'),  -- panel, org 1, todo
  ('d1000000-0000-0000-0000-000000000002', 'vendedor@example.com'),       -- panel, org 1, solo ventas
  ('d1000000-0000-0000-0000-000000000003', 'sinpermiso@example.com'),     -- panel, org 1, sin ventas ni empresas
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com'),      -- panel, org 2
  ('d9000000-0000-0000-0000-000000000009', 'cliente-web@example.com');    -- cuenta de la tienda: NO es miembro de ninguna organización

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

-- El vendedor solo tiene ventas; el usuario sin permiso no tiene ni ventas ni empresas (la compuerta de precio_para).
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion = 'ventas';
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'operador' and seccion in ('empresas', 'productos');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion in ('ventas', 'empresas');

-- EA: regla central +12,345 % (redondeo a 10) · EB: sin regla (central tal cual) · EC: regla −7,5 % · E2: otra organización.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Tienda C'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, redondeo_pesos, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 12.345, 10, false),
  ('e1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -7.5, 10, true);

-- Cotización solo en la organización 1: un producto en dólares de la organización 2 queda SIN precio (neto nulo).
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1234.5);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con IVA 21 por categoría'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Categoría dos');
insert into dominio.alicuotas_iva (id, organizacion_id, nombre, porcentaje, exento) values
  ('a1000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'IVA 10,5 % de prueba', 10.5, false);

-- Productos de la organización 1 (n = 1…12):
--   1 lista 1000, alícuota 21 % por categoría · 2 USD 10 · 3 lista 333,33, alícuota propia 10,5 % · 4 lista 880, exento
--   5 lista 1000 con escalas x5 900, x10 800, x50 700 · 6 lista 1000 solo con x10 750 · 7 precio propio ARS en A y B
--   8 precio propio USD en A, ARS en B y escala x10 600 · 9 sin categoría ni alícuota (sin IVA) · 10 lista 0,01
--   11 lista 123456,78 · 12 promociones de todo tipo (lista 500)
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'PS-' || n,
       case when n = 2 then 'USD' else 'ARS' end,
       case n when 2 then 10 when 3 then 333.33 when 4 then 880 when 10 then 0.01 when 11 then 123456.78 when 12 then 500 else 1000 end,
       case when n = 9 then null else 'c1000000-0000-0000-0000-000000000001'::uuid end
  from generate_series(1, 12) n;
update dominio.productos set alicuota_iva_id = 'a1000000-0000-0000-0000-0000000000a5'
 where id = 'b1000000-0000-0000-0000-000000000003';
update dominio.productos set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                                                 where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'b1000000-0000-0000-0000-000000000004';
insert into dominio.producto_precios_escala (producto_id, organizacion_id, escala, precio) values
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'x5', 900),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'x10', 800),
  ('b1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'x50', 700),
  ('b1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'x10', 750),
  ('b1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'x10', 600);
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'ARS', 950),
  ('b1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'ARS', 1010.5),
  ('b1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'USD', 5),
  ('b1000000-0000-0000-0000-000000000008', 'e1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'ARS', 1100);

-- Productos de la organización 2: uno en pesos y uno en dólares (sin cotización: neto nulo).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id) values
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno ARS', 'PS-X1', 'ARS', 700, 'c2000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Ajeno USD', 'PS-X2', 'USD', 7, 'c2000000-0000-0000-0000-000000000001');

-- Promociones (la bandera `promociones_precio` se enciende más abajo):
--   P1/A 900,40 gana · P3/A 700 gana · P3/B 333,33 EMPATA con el normal (se ignora) · P4/A 5000 MAYOR (se ignora)
--   P5/A 100 VENCIDA · P6/A 100 FUTURA · P7/A 100 ANULADA · P8/A 100 gana también sobre el precio propio en dólares · P12 varias tiendas
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta, anulada_at)
select '11111111-1111-1111-1111-111111111111', e, ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, precio, desde, hasta, anulada
  from (values
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 1, 900.40::numeric, now() - interval '1 day', now() + interval '1 day', null::timestamptz),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 3, 700::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000b'::uuid, 3, 333.33::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 4, 5000::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 5, 100::numeric, now() - interval '5 days', now() - interval '4 days', null),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 6, 100::numeric, now() + interval '2 days', now() + interval '3 days', null),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 7, 100::numeric, now() - interval '1 day', now() + interval '1 day', now()),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 8, 100::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000a'::uuid, 12, 450::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000b'::uuid, 12, 499.99::numeric, now() - interval '1 day', now() + interval '1 day', null),
    ('e1000000-0000-0000-0000-00000000000c'::uuid, 12, 0.5::numeric, now() - interval '1 day', now() + interval '1 day', null)
  ) v(e, n, precio, desde, hasta, anulada);

-- ============================================================================
-- A. PARIDAD con la sesión de un administrador de panel (sin cambiar de rol: `precio_linea_venta` no tiene execute para authenticated)
-- ============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- A.1 precio_para: producto × tienda × escala (incluye escalas con y sin precio, precio propio y alícuotas).
create temp table grilla_para on commit drop as
select n, e.id as empresa, esc as escala,
       ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid as producto,
       (select to_jsonb(o) from pg_temp.precio_para_original(('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, e.id, esc) o) as original,
       (select to_jsonb(w) from private.precio_para(('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, e.id, esc) w) as envoltorio,
       (select to_jsonb(c) from private.precio_para_calculo(('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, e.id, esc) c) as calculo
  from generate_series(1, 12) n
 cross join (select id from dominio.empresas where organizacion_id = '11111111-1111-1111-1111-111111111111') e
 cross join (values ('x1'), ('x5'), ('x10'), ('x50')) t(esc);

select cmp_ok((select count(*) from grilla_para)::int, '=', 144, 'precio_para: la grilla tiene 12 productos × 3 tiendas × 4 escalas');
select is((select count(*)::int from grilla_para where original is null), 0, 'precio_para: la original devuelve fila en toda la grilla (sin vacíos)');
select is((select count(*)::int from grilla_para where envoltorio is distinct from original), 0,
  'precio_para: el ENVOLTORIO es idéntico a la función original, columna por columna, en toda la grilla');
select is((select count(*)::int from grilla_para where calculo is distinct from original), 0,
  'precio_para: el CÁLCULO sin sesión es idéntico a la función original, columna por columna, en toda la grilla');
select cmp_ok((select count(distinct original->>'escala_usada') from grilla_para)::int, '=', 4, 'cobertura: aparecen las cuatro escalas usadas (x1, x5, x10, x50)');
select cmp_ok((select count(distinct original->>'alicuota_porcentaje') from grilla_para where original->>'alicuota_porcentaje' is not null)::int, '>=', 3,
  'cobertura: alícuotas de 21 %, 10,5 % y exenta (0)');
select cmp_ok((select count(*) from grilla_para where original->>'alicuota_id' is null)::int, '>', 0, 'cobertura: producto sin alícuota (alícuota y final nulos)');
select cmp_ok((select count(*) from grilla_para where (original->>'alicuota_exenta')::boolean)::int, '>', 0, 'cobertura: producto exento');
select cmp_ok((select count(*) from grilla_para where n = 7 and (original->>'neto')::numeric in (950, 1010.5))::int, '=', 8,
  'cobertura: el precio propio en pesos reemplaza al de lista (producto 7 en A y B, cuatro escalas)');
select cmp_ok((select count(*) from grilla_para where n = 8 and original->>'escala_usada' = 'x10')::int, '=', 3,
  'cobertura: la escala cargada a mano (x10) manda sobre el precio propio (producto 8, las tres tiendas)');
select is((select (original->>'neto')::numeric from grilla_para where n = 8 and escala = 'x10' and empresa = 'e1000000-0000-0000-0000-00000000000b'),
  600::numeric, 'cobertura: producto 8 con x10 en la tienda B (sin regla) cuesta la escala (600), no el precio propio (1100)');
select is((select (original->>'neto')::numeric from grilla_para where n = 8 and escala = 'x1' and empresa = 'e1000000-0000-0000-0000-00000000000a'),
  6172.5, 'cobertura: el precio propio en dólares usa la cotización de la organización (5 × 1234,5)');
select is((select (original->>'neto')::numeric from grilla_para where n = 2 and escala = 'x1' and empresa = 'e1000000-0000-0000-0000-00000000000b'),
  12345.0, 'cobertura: producto en dólares a la cotización de la organización, sin regla (10 × 1234,5)');
select isnt((select (original->>'neto')::numeric from grilla_para where n = 11 and escala = 'x1' and empresa = 'e1000000-0000-0000-0000-00000000000a'),
  123456.78, 'cobertura: la regla de la tienda A (+12,345 % redondeado a 10) cambia el neto de lista');

-- A.2 precio_linea_venta: producto × tienda × (tipo, cantidad) × descuento × instante, con la bandera ENCENDIDA y APAGADA.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

create temp table casos on commit drop as
select n, e.id as empresa, tc.tipo, tc.cantidad, d.descuento, d.aplicar, i.ahora, i.etiqueta, b.bandera
  from generate_series(1, 12) n
 cross join (select id from dominio.empresas where organizacion_id = '11111111-1111-1111-1111-111111111111') e
 cross join (values ('minorista', 1), ('minorista', 50), ('mayorista', 1), ('mayorista', 4), ('mayorista', 5), ('mayorista', 9),
                    ('mayorista', 10), ('mayorista', 49), ('mayorista', 50), (null, 100), ('mayorista', 1000)) tc(tipo, cantidad)
 cross join (values (0::numeric, true), (7.5, true), (33.333, true), (7.5, false)) d(descuento, aplicar)
 cross join (values (now(), 'ahora'), (now() + interval '2.5 days', 'en dos días y medio (vencidas y una futura vigente)')) i(ahora, etiqueta)
 cross join (values (true), (false)) b(bandera)
 where b.bandera or i.etiqueta = 'ahora';

alter table casos add column original jsonb, add column envoltorio jsonb, add column calculo jsonb, add column web jsonb;

-- Se calcula una vez por bandera (el interruptor es una fila global).
update casos c set
  original = (select to_jsonb(o) from pg_temp.precio_linea_venta_original(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) o),
  envoltorio = (select to_jsonb(w) from private.precio_linea_venta(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) w),
  calculo = (select to_jsonb(k) from private.precio_linea_venta_calculo(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) k)
 where c.bandera;

update public.banderas_plataforma set activa = false where clave = 'promociones_precio';

update casos c set
  original = (select to_jsonb(o) from pg_temp.precio_linea_venta_original(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) o),
  envoltorio = (select to_jsonb(w) from private.precio_linea_venta(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) w),
  calculo = (select to_jsonb(k) from private.precio_linea_venta_calculo(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) k)
 where not c.bandera;

update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

select cmp_ok((select count(*) from casos)::int, '>=', 4000, 'precio_linea_venta: la grilla tiene más de 4.000 combinaciones');
select is((select count(*)::int from casos where original is null), 0, 'precio_linea_venta: la original devuelve fila en toda la grilla');
select is((select count(*)::int from casos where envoltorio is distinct from original), 0,
  'precio_linea_venta: el ENVOLTORIO es idéntico a la función original, columna por columna, en toda la grilla');
select is((select count(*)::int from casos where calculo is distinct from original), 0,
  'precio_linea_venta: el CÁLCULO sin sesión es idéntico a la función original, columna por columna, en toda la grilla');
select is((select count(*)::int from casos where bandera and envoltorio is distinct from original), 0,
  'precio_linea_venta: idéntico con la bandera promociones_precio ENCENDIDA');
select is((select count(*)::int from casos where not bandera and envoltorio is distinct from original), 0,
  'precio_linea_venta: idéntico con la bandera promociones_precio APAGADA');
select cmp_ok((select count(*) from casos where bandera and original->>'promocion_id' is not null)::int, '>=', 200,
  'cobertura: hay al menos 200 combinaciones donde GANA la promoción (con la bandera encendida)');
select cmp_ok((select count(*) from casos where bandera and original->>'promocion_id' is null and n in (3, 4, 5, 6, 7))::int, '>=', 100,
  'cobertura: promociones que empatan, son mayores, vencidas, futuras o anuladas se ignoran (productos 3 a 7)');
select is((select count(*)::int from casos where not bandera and original->>'promocion_id' is not null), 0,
  'cobertura: con la bandera apagada ninguna promoción gana');
select cmp_ok((select count(*) from casos where (original->>'descuento_aplicado')::numeric > 0)::int, '>=', 500,
  'cobertura: hay al menos 500 combinaciones con descuento del cliente aplicado');
select cmp_ok((select count(*) from casos where not aplicar and bandera and original->>'promocion_id' is null)::int, '>', 0,
  'cobertura: aplicar_descuento = false (descuento ignorado)');
select cmp_ok((select count(distinct original->>'escala_usada') from casos)::int, '=', 4, 'cobertura: las cuatro escalas aparecen en las líneas');
select cmp_ok((select count(distinct original->>'alicuota_porcentaje') from casos where original->>'alicuota_porcentaje' is not null)::int, '>=', 3,
  'cobertura: alícuotas de 21 %, 10,5 % y exenta en las líneas');
select cmp_ok((select count(*) from casos where original->>'neto_unitario' is not null and (original->>'neto_unitario')::numeric <> round((original->>'neto_unitario')::numeric))::int, '>', 0,
  'cobertura: netos con decimales (redondeo a 2 decimales con descuento)');
select cmp_ok((select count(*) from casos where n = 8 and original->>'promocion_id' is not null)::int, '>', 0,
  'cobertura: la promoción gana también sobre un precio propio en dólares (producto 8)');
select cmp_ok((select count(*) from casos where n = 12 and original->>'promocion_id' is not null and (original->>'neto_unitario')::numeric = 0.5)::int, '>', 0,
  'cobertura: promoción de 0,50 (la tienda C con un neto muy bajo)');

-- Resultado sin precio (neto nulo): organización 2, producto en dólares sin cotización. Sesión del administrador de la organización 2.
select set_config('request.jwt.claims',
  json_build_object('sub', 'd2000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select ok((select to_jsonb(o) from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'x1') o) is not null
          and (select neto from private.precio_para('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'x1')) is null,
  'sin precio: un producto en dólares sin cotización devuelve fila con neto nulo (la original y el envoltorio)');
select is((select to_jsonb(w) from private.precio_para('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'x1') w),
  (select to_jsonb(o) from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'x1') o),
  'sin precio: el envoltorio es idéntico a la original (neto, alícuota y final nulo)');
select is((select to_jsonb(k) from private.precio_linea_venta_calculo('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'mayorista', 10, 5) k),
  (select to_jsonb(o) from pg_temp.precio_linea_venta_original('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'mayorista', 10, 5) o),
  'sin precio: la línea sin precio es idéntica en el cálculo y en la original (neto_unitario nulo, sin promoción)');
select is((select neto_unitario from private.precio_linea_venta_calculo('b2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'minorista', 1)),
  null::numeric, 'sin precio: neto_unitario nulo (el llamador decide: la tienda responde sin_precio)');
select is((select to_jsonb(w) from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1') w),
  (select to_jsonb(o) from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1') o),
  'organización 2: el envoltorio es idéntico a la original para su propia sesión');

-- Escala inexistente: el mismo error (22023) en el envoltorio, el cálculo y la original, incluso sin permiso (se valida ANTES de la compuerta).
select throws_ok($$select * from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'precio_para (envoltorio): escala inexistente = 22023 con el mismo mensaje');
select throws_ok($$select * from private.precio_para_calculo('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'precio_para_calculo: escala inexistente = 22023 con el mismo mensaje');
select throws_ok($$select * from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'precio_para (original): escala inexistente = 22023 con el mismo mensaje');
select throws_ok($$select * from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', null)$$,
  '22023', 'La escala (vacía) no existe: usá x1, x5, x10 o x50', 'precio_para (envoltorio): escala nula = 22023');

-- ============================================================================
-- B. SIN SESIÓN DE PANEL: un cliente web (no es miembro de ninguna organización) obtiene el MISMO resultado
-- ============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', 'd9000000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);

select is((select private.organizacion_id()), null::uuid, 'cliente web: no tiene organización de panel (organizacion_id() nulo)');
select is((select private.nivel_seccion('ventas')), 'ninguno', 'cliente web: sin permiso de ventas');
select is((select private.nivel_seccion('empresas')), 'ninguno', 'cliente web: sin permiso de empresas');

update casos c set web = (select to_jsonb(k) from private.precio_linea_venta_calculo(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid,
                c.empresa, c.tipo, c.cantidad, c.descuento, c.ahora, c.aplicar) k)
 where c.bandera;

select is((select count(*)::int from casos where bandera and web is distinct from original), 0,
  'cliente web: precio_linea_venta_calculo da el MISMO resultado que la sesión de panel en toda la grilla (con promociones, IVA y precio propio)');
select cmp_ok((select count(*) from casos where bandera and web->>'alicuota_porcentaje' = '21.00')::int, '>', 0,
  'cliente web: el IVA de 21 % llega (no es 0 ni nulo)');
select is((select web->>'alicuota_porcentaje' from casos where bandera and n = 3 limit 1), '10.50',
  'cliente web: la alícuota propia del producto (10,5 %) llega');
select is((select web->>'alicuota_exenta' from casos where bandera and n = 4 limit 1), 'true', 'cliente web: el producto exento sale exento');
select is((select web->>'neto_unitario' from casos where bandera and n = 7 and empresa = 'e1000000-0000-0000-0000-00000000000a'
            and tipo = 'minorista' and cantidad = 1 and descuento = 0 and ahora < now() + interval '1 day' limit 1), '950.00',
  'cliente web: el precio propio de la tienda (950) se respeta');
alter table grilla_para add column web jsonb;
update grilla_para g set web = (select to_jsonb(c) from private.precio_para_calculo(g.producto, g.empresa, g.escala) c);
select is((select count(*)::int from grilla_para where web is distinct from original), 0,
  'cliente web: precio_para_calculo da el MISMO resultado que la sesión de panel en toda la grilla de escalas');

-- Los dos fallos silenciosos de D-17, reproducidos con la copia de la función original SIN compuerta: ESTA es la diferencia que
-- prueba que la extracción hace falta. Si se revierte la extracción, el cliente web recupera IVA nulo y precio propio ignorado.
select is((select alicuota_porcentaje from pg_temp.precio_para_original_sin_compuerta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x1')),
  null::numeric, 'D-17 (fallo 1): la función original, sin sesión de panel, devuelve alícuota NULA (IVA 0) sin error');
select isnt((select neto from pg_temp.precio_para_original_sin_compuerta('b1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-00000000000b', 'x1')),
  1010.5, 'D-17 (fallo 2): la función original, sin sesión de panel, IGNORA el precio propio (cobra otro precio) sin error');
select is((select alicuota_porcentaje from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x1')),
  21.00::numeric, 'el cálculo sin sesión devuelve el IVA de 21 % al cliente web');
select is((select neto from private.precio_para_calculo('b1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-00000000000b', 'x1')),
  1010.5::numeric, 'el cálculo sin sesión respeta el precio propio (1010,50) del cliente web');
select is((select final from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x1')),
  1210::numeric, 'el cálculo sin sesión devuelve el final con IVA (1000 × 1,21) al cliente web');

-- La compuerta de los envoltorios sigue cerrada para el cliente web (no hay precio sin permiso de panel).
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x1')), 0,
  'cliente web: el envoltorio precio_para devuelve vacío (compuerta de panel)');
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'minorista', 1)), 0,
  'cliente web: el envoltorio precio_linea_venta devuelve vacío (compuerta de panel)');
select is((select count(*)::int from pg_temp.precio_para_original('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x1')), 0,
  'cliente web: la original también devolvía vacío (comportamiento preservado)');
select is((select private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b')), false,
  'cliente web: precio_sesion_alcanza = false');

-- Aislamiento por la empresa (no por la sesión): producto de una organización con empresa de otra, producto inexistente.
select is((select count(*)::int from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')), 0,
  'cálculo: producto de la organización 1 con la empresa de la organización 2 = vacío');
select is((select count(*)::int from private.precio_para_calculo('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'cálculo: producto de la organización 2 con una empresa de la organización 1 = vacío');
select is((select count(*)::int from private.precio_para_calculo('b9999999-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'cálculo: producto inexistente = vacío');
select is((select count(*)::int from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'e9999999-0000-0000-0000-000000000000', 'x1')), 0,
  'cálculo: empresa inexistente = vacío');
select is((select count(*)::int from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'minorista', 1)), 0,
  'cálculo de línea: producto de la organización 1 con la empresa de la organización 2 = vacío');
select is((select count(*)::int from private.precio_linea_venta_calculo('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 0,
  'cálculo de línea: producto de la organización 2 con una empresa de la organización 1 = vacío');
-- Una promoción de la organización 1 no aparece en un precio de la organización 2 aunque se pase el mismo uuid de empresa ajena.
select is((select count(*)::int from private.promocion_vigente_fila('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001')), 0,
  'la promoción vigente no cruza de organización');

-- ============================================================================
-- C. Compuerta y aislamiento de los envoltorios con las sesiones de panel
-- ============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', 'd1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- Única diferencia deliberada (sesión de panel de una organización con producto y empresa de OTRA): la original, llamada sin RLS
-- (como lo hacen las funciones `security definer` de producción), devolvía el neto SIN alícuota y SIN precio propio (el fallo
-- silencioso); el envoltorio devuelve vacío.
select is((select count(*)::int from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')), 1,
  'diferencia deliberada 2 (antes): la original, sin RLS, devolvía fila para producto y empresa de otra organización');
select is((select alicuota_porcentaje from pg_temp.precio_para_original('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')),
  null::numeric, 'diferencia deliberada 2 (antes): y sin alícuota (el fallo silencioso)');
select is((select count(*)::int from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')), 0,
  'diferencia deliberada 2 (ahora): el envoltorio devuelve vacío para otra organización');
select is((select count(*)::int from private.precio_linea_venta('b2000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'minorista', 1)), 0,
  'diferencia deliberada 2 (ahora): el envoltorio de línea devuelve vacío para otra organización');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')), 0,
  'producto propio con empresa de otra organización = vacío');

-- Roles reales: `authenticated` ejecuta `precio_para` (grant vigente) y `precio_linea_venta` no.
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'administrador (authenticated): precio_para devuelve el precio de su organización');
select is((select final from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000b', 'x5')), 1210::numeric,
  'administrador: precio_para con IVA (1000 × 1,21)');
select is((select count(*)::int from private.precio_para('b2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'administrador: producto de otra organización = vacío');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'x1')), 0,
  'administrador: empresa de otra organización = vacío');
select throws_ok($$select * from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)$$,
  '42501', null, 'authenticated no ejecuta private.precio_linea_venta (sin cambios)');
select throws_ok($$select * from private.precio_para_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')$$,
  '42501', null, 'authenticated NO ejecuta private.precio_para_calculo');
select throws_ok($$select * from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)$$,
  '42501', null, 'authenticated NO ejecuta private.precio_linea_venta_calculo');
select throws_ok($$select private.precio_sesion_alcanza('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'authenticated NO ejecuta private.precio_sesion_alcanza');
reset role;

-- Compuerta: solo ventas basta (F-VTA-06); sin ventas ni empresas no hay precio.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'vendedor (solo ventas): la compuerta de precio_para lo deja pasar');
-- DIFERENCIA DELIBERADA 1 (S1 de la revisión T052): precio_para (security definer) PIERDE el requisito de sección de la RLS vieja
-- (productos y empresas en lectura/edición). Este vendedor tiene productos y empresas en «ninguno»: la RLS vieja le habría ocultado
-- el producto; ahora obtiene el precio CON la regla de la tienda A (+12,345 % redondeado a 10 = 1.120), como ya lo obtiene a través de
-- guardar_lineas_comprobante.
select is((select neto from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1120::numeric,
  'diferencia deliberada 1: precio_para ya no exige productos ni empresas en lectura (la RLS vieja sí): con solo ventas devuelve el precio con la regla de la tienda');
reset role;
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 1,
  'vendedor: la compuerta de precio_linea_venta (invocada como dueño, como hacen las RPC) lo deja pasar');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'usuario sin ventas ni empresas: precio_para devuelve vacío (compuerta)');
reset role;
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 0,
  'usuario sin ventas ni empresas: precio_linea_venta devuelve vacío (compuerta)');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'administrador de la organización 2: producto y empresa de la organización 1 = vacío');
reset role;

-- T1 (revisión T052): la compuerta acepta lectura o edición en CUALQUIERA de las dos secciones, y solo en esas. Un usuario con solo
-- `ventas = lectura`, otro con solo `empresas = lectura`, otro con solo `empresas = edicion` y uno sin ninguna. (Matan los mutantes
-- `in ('edicion')`, quitar la rama de empresas y quitar la rama de ventas.) El rol `consulta` arranca con ambas en «ninguno».
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'compuerta: solo ventas = lectura (sin empresas) deja pasar');
reset role;
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 1,
  'compuerta de la línea: solo ventas = lectura deja pasar');
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'ventas';
update public.permisos_rol set nivel = 'lectura'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'empresas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'compuerta: solo empresas = lectura (sin ventas) deja pasar');
reset role;
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 1,
  'compuerta de la línea: solo empresas = lectura deja pasar');
update public.permisos_rol set nivel = 'edicion'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'empresas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 1,
  'compuerta: solo empresas = edicion (sin ventas) deja pasar');
reset role;
update public.permisos_rol set nivel = 'ninguno'
 where organizacion_id = '11111111-1111-1111-1111-111111111111' and rol_id = 'consulta' and seccion = 'empresas';
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'compuerta: ni ventas ni empresas (las dos en «ninguno»): vacío');
reset role;

-- T3 (revisión T052): la escala inexistente se rechaza (22023) ANTES que la compuerta: también para quien no tiene permiso y para el cliente web.
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'escala inexistente = 22023 también para un usuario SIN permiso (se valida antes de la compuerta)');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', 'd9000000-0000-0000-0000-000000000009', 'role', 'authenticated')::text, true);
select throws_ok($$select * from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x7')$$,
  '22023', 'La escala x7 no existe: usá x1, x5, x10 o x50', 'escala inexistente = 22023 también para el cliente web (sin membresía)');

-- Sin sesión alguna (sin claims, como postgres): vacío.
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from private.precio_para('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'x1')), 0,
  'sin sesión: precio_para devuelve vacío');
select is((select count(*)::int from private.precio_linea_venta('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 0,
  'sin sesión: precio_linea_venta devuelve vacío');
select is((select count(*)::int from private.precio_linea_venta_calculo('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'minorista', 1)), 1,
  'sin sesión: el cálculo (sin sesión por definición) devuelve el precio de la empresa');

-- ============================================================================
-- D. Superficie: el refactor no abre nada para la API
-- ============================================================================

select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')), 3,
  'las tres funciones nuevas existen en el esquema private');

-- ni anon, ni authenticated, ni service_role, ni PUBLIC (grantee 0) pueden ejecutarlas.
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')
              and a.privilege_type = 'EXECUTE'
              and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))), 0,
  'las funciones nuevas no tienen execute para PUBLIC, anon, authenticated ni service_role');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')
              and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), 0,
  'las funciones nuevas solo las ejecuta su dueño');
select is(has_function_privilege('anon', 'private.precio_para_calculo(uuid, uuid, text)', 'EXECUTE'), false, 'anon no ejecuta precio_para_calculo');
select is(has_function_privilege('authenticated', 'private.precio_para_calculo(uuid, uuid, text)', 'EXECUTE'), false, 'authenticated no ejecuta precio_para_calculo');
select is(has_function_privilege('service_role', 'private.precio_para_calculo(uuid, uuid, text)', 'EXECUTE'), false, 'service_role no ejecuta precio_para_calculo');
select is(has_function_privilege('anon', 'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'anon no ejecuta precio_linea_venta_calculo');
select is(has_function_privilege('authenticated', 'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'authenticated no ejecuta precio_linea_venta_calculo');
select is(has_function_privilege('service_role', 'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'service_role no ejecuta precio_linea_venta_calculo');
select is(has_function_privilege('anon', 'private.precio_sesion_alcanza(uuid, uuid)', 'EXECUTE'), false, 'anon no ejecuta precio_sesion_alcanza');
select is(has_function_privilege('authenticated', 'private.precio_sesion_alcanza(uuid, uuid)', 'EXECUTE'), false, 'authenticated no ejecuta precio_sesion_alcanza');
select is(has_function_privilege('service_role', 'private.precio_sesion_alcanza(uuid, uuid)', 'EXECUTE'), false, 'service_role no ejecuta precio_sesion_alcanza');

-- Los envoltorios conservan sus grants EXACTOS.
select is(has_function_privilege('anon', 'private.precio_para(uuid, uuid, text)', 'EXECUTE'), false, 'anon no ejecuta precio_para (sin cambios)');
select is(has_function_privilege('authenticated', 'private.precio_para(uuid, uuid, text)', 'EXECUTE'), true, 'authenticated ejecuta precio_para (grant vigente, sin cambios)');
select is(has_function_privilege('anon', 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'anon no ejecuta precio_linea_venta (sin cambios)');
select is(has_function_privilege('authenticated', 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'authenticated no ejecuta precio_linea_venta (sin cambios)');
select is(has_function_privilege('service_role', 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)', 'EXECUTE'), false, 'service_role no ejecuta precio_linea_venta (sin cambios)');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a
            where p.oid = 'private.precio_para(uuid, uuid, text)'::regprocedure
              and a.privilege_type = 'EXECUTE' and a.grantee not in (p.proowner, (select oid from pg_roles where rolname = 'authenticated'))), 0,
  'precio_para: ningún grantee fuera de su dueño y authenticated');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a
            where p.oid = 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure
              and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), 0,
  'precio_linea_venta: solo la ejecuta su dueño');

-- Lista cerrada de lo ejecutable por anon / authenticated en el esquema private con nombre de precio o promoción (no crece).
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}')
             from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname ~ '^(precio|promocion)_'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['precio_central_ars', 'precio_neto_empresa', 'precio_para', 'precio_propio_empresa']::text[],
  'en private, lo ejecutable por authenticated con nombre precio_*/promocion_* es la lista de antes del refactor (precio_central_ars, precio_neto_empresa, precio_para y precio_propio_empresa): no crece');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname ~ '(_calculo$|^precio_|^promocion_)'
              and has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
  'anon no ejecuta nada de private con nombre de precio, promoción o cálculo');

-- Atributos de seguridad: `search_path` vacío en las cinco; el cálculo y la compuerta son `security definer`; precio_para pasa a
-- `security definer` (para llamar al cálculo, que no tiene execute para authenticated; documentado en la migración); precio_linea_venta
-- sigue `security invoker`.
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para', 'precio_linea_venta', 'precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')
              and array_to_string(p.proconfig, ',') = 'search_path=""'), 5, 'las cinco funciones tienen search_path vacío');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_para_calculo(uuid, uuid, text)'::regprocedure), true, 'precio_para_calculo es security definer');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure), true, 'precio_linea_venta_calculo es security definer');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_sesion_alcanza(uuid, uuid)'::regprocedure), true, 'precio_sesion_alcanza es security definer');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_para(uuid, uuid, text)'::regprocedure), true, 'precio_para (envoltorio) es security definer');
select is((select p.prosecdef from pg_proc p where p.oid = 'private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure), false,
  'precio_linea_venta (envoltorio) sigue security invoker');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para', 'precio_linea_venta', 'precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')
              and p.provolatile = 's'), 5, 'las cinco funciones son stable');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('precio_para_calculo', 'precio_linea_venta_calculo', 'precio_sesion_alcanza')
              and p.prosrc ~* '\mexecute\M'), 0, 'las funciones nuevas no usan SQL dinámico');

-- Estructura: las dos funciones de cálculo devuelven las mismas columnas y tipos que sus envoltorios.
select is((select pg_get_function_result('private.precio_para_calculo(uuid, uuid, text)'::regprocedure)),
  (select pg_get_function_result('private.precio_para(uuid, uuid, text)'::regprocedure)), 'precio_para_calculo devuelve las mismas columnas que precio_para');
select is((select pg_get_function_result('private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure)),
  (select pg_get_function_result('private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure)),
  'precio_linea_venta_calculo devuelve las mismas columnas que precio_linea_venta');
select is((select pg_get_function_arguments('private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure)),
  (select pg_get_function_arguments('private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)'::regprocedure)),
  'precio_linea_venta_calculo tiene la misma firma (y defaults) que precio_linea_venta');
select is((select pg_get_function_arguments('private.precio_para_calculo(uuid, uuid, text)'::regprocedure)),
  (select pg_get_function_arguments('private.precio_para(uuid, uuid, text)'::regprocedure)), 'precio_para_calculo tiene la misma firma (y defaults) que precio_para');

select * from finish();
rollback;
