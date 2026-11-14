-- MSF-816 / F-4 · T020 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-020):
-- paridad tienda ↔ local del precio con promoción.
--
-- Compara, para un conjunto de productos, tiendas e instantes, el neto unitario que cobra el local
-- (`private.precio_linea_venta`: minorista, cantidad 1, sin descuento) contra el `precio` que muestra la tienda
-- (`private.precio_vigente_empresa`), con la bandera `promociones_precio` encendida:
--   · tienda A, «Sin IVA»: el neto del local es IGUAL al precio de la tienda (FR-020);
--   · tienda B, «Con IVA incluido»: la tienda redondea al peso entero por UNIDAD (`private.aplicar_iva`) y el local
--     devuelve el neto; el precio con IVA del local (neto × (1 + alícuota)) difiere de la tienda en menos de $1 por
--     unidad (el límite es por unidad, no por línea; el redondeo de la línea completa es de otra naturaleza y no se
--     acota acá);
--   · la tienda `precio_anterior` coincide con la `precio_referencia` del local cuando la promoción gana;
--   · EXCLUIDOS de la comparación general y probados aparte: una promoción mayor o igual al precio normal (desde S5 =
--     MSF-936 la tienda y el local la ignoran por igual; se afirma abajo que coinciden) y un producto no publicado en la tienda de la
--     empresa (`precio_final_publico` es null sin `producto_empresa`, el local sí tiene precio).
-- Una aserción de cobertura impide que el conjunto comparado quede vacío o sin promociones ganadoras, y la bandera
-- apagada comprueba que el local vuelve al precio normal (la tienda también).
-- El fixture corre como postgres; `precio_linea_venta` es `security invoker` y se llama con una sesión de
-- administrador (sin cambiar de rol: la función no tiene `execute` para `authenticated`).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'administrador@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');

-- A: «Sin IVA», regla central −5 % con redondeo a 10; B: «Con IVA incluido», sin ajuste; C: otra organización.
insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, redondeo_pesos, mostrar_con_iva) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', -5, 10, false),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, 10, true);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks');

-- Cotización general para el producto en dólares.
insert into dominio.cotizacion_inicial (organizacion_id, valor) values
  ('11111111-1111-1111-1111-111111111111', 1200);

-- Productos (categoría con IVA 21 %), n = 1…12:
--   1 lista 1000 · 2 lista 1234,56 · 3 precio propio de la tienda A (950) · 4 lista 880 · 5 en dólares (2 USD)
--   6 exento · 7 sin promoción · 8 promoción = normal (excluido) · 9 promoción > normal (excluido)
--   10 NO publicado en la tienda A (excluido) · 11 promoción solo en B · 12 bordes de vigencia
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'P-' || n,
       case when n = 5 then 'USD' else 'ARS' end,
       case n when 2 then 1234.56 when 4 then 880 when 5 then 2 else 1000 end,
       'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 12) n;
update dominio.productos
   set alicuota_iva_id = (select a.id from dominio.alicuotas_iva a
                           where a.organizacion_id = '11111111-1111-1111-1111-111111111111' and a.nombre = 'Exento')
 where id = 'b1000000-0000-0000-0000-000000000006';
insert into dominio.precios_propios_empresa (producto_id, empresa_id, organizacion_id, moneda, importe) values
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ARS', 950);

-- Publicación: todos en A y en B, salvo el 10 que se retira de A.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, p.organizacion_id
  from dominio.productos p
  join dominio.empresas e on e.organizacion_id = p.organizacion_id and e.nombre in ('Tienda A', 'Tienda B')
on conflict do nothing;
delete from dominio.producto_empresa
 where producto_id = 'b1000000-0000-0000-0000-000000000010' and empresa_id = 'a1000000-0000-0000-0000-000000000001';

-- Promociones (vigentes en [hoy − 1 día, hoy + 1 día) salvo indicación). Precios con y sin decimales.
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta)
select '11111111-1111-1111-1111-111111111111', e, ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, precio,
       now() - interval '1 day', now() + interval '1 day'
  from (values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 1, 900.40::numeric),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 1, 850::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 2, 999.99::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 3, 700::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 4, 500::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 5, 1000::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 6, 300.5::numeric),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 6, 300.5::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 9, 5000::numeric),
    ('a1000000-0000-0000-0000-000000000001'::uuid, 10, 400::numeric),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 11, 123.45::numeric)
  ) v(e, n, precio);
-- Producto 8: promoción igual al neto que cobra la tienda A (1000 − 5 % redondeado a 10 = 950).
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000008', 950,
   now() - interval '1 day', now() + interval '1 day');
-- Producto 12: vigente en [2027-03-09 00:00-03, 2027-03-10 00:00-03), en la tienda A y en la B.
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000012', 600.7, '2027-03-09 00:00:00-03', '2027-03-10 00:00:00-03'),
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000012', 600.7, '2027-03-09 00:00:00-03', '2027-03-10 00:00:00-03');
-- Una promoción anulada y otra ya vencida sobre el producto 7 (no deben regir en ningún instante de la grilla de hoy).
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta, anulada_at) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 100, now() - interval '1 day', now() + interval '1 day', now());
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000007', 100, now() - interval '5 days', now() - interval '4 days');

-- Sesión de administrador sin cambiar de rol (precio_linea_venta no tiene execute para authenticated).
select set_config('request.jwt.claims',
  json_build_object('sub', 'f1000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

-- Conjunto de casos: producto × tienda × instante. Los instantes de hoy caen dentro de la ventana de las promociones
-- de «now() ± 1 día»; los del producto 12 recorren sus bordes (incluido el instante exacto de `desde` y de `hasta`).
create temp table casos on commit drop as
select c.n, c.empresa, i.ahora, i.etiqueta
  from (select n, e as empresa
          from generate_series(1, 12) n
         cross join (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000002'::uuid)) t(e)
       ) c
  join (values
    (now(), 'ahora'),
    (now() - interval '6 hours', 'ayer'),
    (now() + interval '6 hours', 'mañana'),
    (now() + interval '2 days', 'pasado mañana (todas vencidas)'),
    (now() - interval '10 days', 'antes de todo')
  ) i(ahora, etiqueta) on c.n < 12
union all
select 12, c.e, i.ahora, i.etiqueta
  from (values ('a1000000-0000-0000-0000-000000000001'::uuid), ('a1000000-0000-0000-0000-000000000002'::uuid)) c(e)
  cross join (values
    ('2027-03-08 23:59:59-03'::timestamptz, 'un segundo antes de desde'),
    ('2027-03-09 00:00:00-03'::timestamptz, 'desde exacto'),
    ('2027-03-09 12:00:00-03'::timestamptz, 'a mitad'),
    ('2027-03-09 23:59:59-03'::timestamptz, 'un segundo antes de hasta'),
    ('2027-03-10 00:00:00-03'::timestamptz, 'hasta exacto (excluido)')
  ) i(ahora, etiqueta);

-- Resultado de cada lado, calculado una sola vez, con la bandera ENCENDIDA.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';

create temp table cmp on commit drop as
select c.n, c.empresa, c.ahora, c.etiqueta,
       tienda.precio as t_precio, tienda.precio_anterior as t_anterior,
       local.neto_unitario as l_neto, local.precio_referencia as l_ref, local.promocion_id as l_promo,
       local.alicuota_porcentaje as alic, coalesce(local.alicuota_exenta, false) as exenta,
       (r.mostrar_con_iva) as con_iva,
       -- Excluidos POR DATO: promoción vigente >= precio normal (la tienda la muestra y el local la ignora: S5) y
       -- producto no publicado en la tienda (sin producto_empresa).
       exists (select 1 from dominio.promociones_precio x
                where x.producto_id = ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid
                  and x.empresa_id = c.empresa and x.anulada_at is null and x.desde <= c.ahora and c.ahora < x.hasta
                  and x.precio_promocional >= (select pp.neto from private.precio_para(
                        ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, 'x1') pp)) as excl_promo_mayor,
       not exists (select 1 from dominio.producto_empresa pe
                    where pe.producto_id = ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid
                      and pe.empresa_id = c.empresa) as excl_no_publicado
  from casos c
  cross join lateral private.precio_vigente_empresa(
         ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, c.ahora) tienda
  left join lateral private.precio_linea_venta(
         ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, 'minorista', 1, 0, c.ahora, true) local on true
  left join dominio.precios_empresa r on r.empresa_id = c.empresa;

-- ============================================================================
-- Cobertura: el conjunto comparado no es vacío ni trivial
-- ============================================================================

select cmp_ok((select count(*) from cmp where not excl_promo_mayor and not excl_no_publicado)::int, '>=', 90,
  'el conjunto comparado tiene al menos 90 combinaciones producto/tienda/instante');
select cmp_ok((select count(*) from cmp where not excl_promo_mayor and not excl_no_publicado and l_promo is not null)::int, '>=', 15,
  'al menos 15 combinaciones comparadas tienen una promoción ganadora en el local');
select cmp_ok((select count(*) from cmp where not excl_promo_mayor and not excl_no_publicado and t_anterior is not null)::int, '>=', 15,
  'al menos 15 combinaciones comparadas tienen una promoción visible en la tienda');
select cmp_ok((select count(*) from cmp where not excl_promo_mayor and not excl_no_publicado and l_promo is null)::int, '>=', 40,
  'y al menos 40 sin promoción (precio normal) para comparar también el caso base');
select cmp_ok((select count(distinct n) from cmp where l_promo is not null)::int, '>=', 7,
  'las promociones ganadoras cubren al menos 7 productos distintos (lista, regla, propio, USD, exento y bordes)');
select cmp_ok((select count(distinct empresa) from cmp where l_promo is not null)::int, '=', 2,
  'las promociones ganadoras cubren las dos tiendas');

-- ============================================================================
-- Tienda A (Sin IVA): el neto del local es IGUAL al precio de la tienda
-- ============================================================================

select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000001' and not con_iva
              and not excl_promo_mayor and not excl_no_publicado
              and l_neto is distinct from t_precio), 0,
  'tienda A (sin IVA): el neto del local es igual al precio de la tienda en todos los casos comparados');
select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000001' and not con_iva
              and not excl_promo_mayor and not excl_no_publicado
              and l_ref is distinct from t_anterior), 0,
  'tienda A: la referencia del local (el tachado) es el precio_anterior de la tienda');
select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000001' and not con_iva
              and not excl_promo_mayor and not excl_no_publicado
              and (l_promo is not null) is distinct from (t_anterior is not null)), 0,
  'tienda A: el local aplica una promoción si y solo si la tienda muestra una');
select cmp_ok((select count(*) from cmp where empresa = 'a1000000-0000-0000-0000-000000000001'
                  and not excl_promo_mayor and not excl_no_publicado and l_neto is null)::int, '=', 0,
  'tienda A: todos los casos comparados tienen precio en el local');

-- Casos puntuales con valores a mano (no solo comparaciones entre funciones).
select is((select l_neto from cmp where n = 1 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 900.40::numeric,
  'producto 1 en A: 900,40 (la promoción con decimales gana al 950 de la regla)');
select is((select t_precio from cmp where n = 1 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 900.40::numeric,
  'producto 1 en A: la tienda muestra 900,40');
select is((select l_neto from cmp where n = 1 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'pasado mañana (todas vencidas)'), 950::numeric,
  'producto 1 en A con la promoción vencida: 950 (1000 − 5 %)');
select is((select l_neto from cmp where n = 3 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 700::numeric,
  'producto 3 (precio propio 950) con promoción 700: 700 en el local');
select is((select t_precio from cmp where n = 3 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 700::numeric,
  'producto 3: 700 en la tienda');
select is((select l_neto from cmp where n = 3 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'antes de todo'), 950::numeric,
  'producto 3 sin promoción vigente: el precio propio 950 (local)');
select is((select l_neto from cmp where n = 5 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 1000::numeric,
  'producto en dólares (2 USD × 1200 = 2400, 2280 con la regla): la promoción 1000 gana');
select is((select l_neto from cmp where n = 5 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'antes de todo'), 2280::numeric,
  'producto en dólares sin promoción: 2 USD × 1200 = 2400 − 5 % = 2280 en el local');
select is((select t_precio from cmp where n = 5 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'antes de todo'), 2280::numeric,
  'producto en dólares sin promoción: 2280 en la tienda');
select is((select l_neto from cmp where n = 7 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 950::numeric,
  'producto 7: una promoción anulada y una vencida no rigen (950)');
select is((select l_neto from cmp where n = 12 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'desde exacto'), 600.7::numeric,
  'producto 12 en el instante exacto de desde: rige (600,70)');
select is((select l_neto from cmp where n = 12 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'un segundo antes de hasta'), 600.7::numeric,
  'producto 12 un segundo antes de hasta: rige');
select is((select l_neto from cmp where n = 12 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'hasta exacto (excluido)'), 950::numeric,
  'producto 12 en el instante exacto de hasta: no rige (950)');
select is((select l_neto from cmp where n = 12 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'un segundo antes de desde'), 950::numeric,
  'producto 12 un segundo antes de desde: no rige (950)');

-- ============================================================================
-- Tienda B (Con IVA incluido): cota < $1 por unidad
-- ============================================================================

select is((select count(*)::int from cmp where empresa = 'a1000000-0000-0000-0000-000000000002' and con_iva), (select count(*)::int from cmp where empresa = 'a1000000-0000-0000-0000-000000000002'),
  'la tienda B muestra precios con IVA en toda la grilla (fixture)');
select cmp_ok((select count(*) from cmp where empresa = 'a1000000-0000-0000-0000-000000000002'
                  and not excl_promo_mayor and not excl_no_publicado and l_neto is not null and t_precio is not null)::int, '>=', 50,
  'tienda B: al menos 50 combinaciones comparadas con precio en AMBOS lados');
select is((select count(*)::int from cmp where empresa = 'a1000000-0000-0000-0000-000000000002'
              and not excl_promo_mayor and not excl_no_publicado and (l_neto is null or t_precio is null)), 0,
  'tienda B: ningún caso comparado tiene precio nulo en el local ni en la tienda');
select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000002' and con_iva
              and not excl_promo_mayor and not excl_no_publicado
              and not (abs(case when exenta then l_neto else l_neto * (1 + coalesce(alic, 0) / 100) end - t_precio) < 1)), 0,
  'tienda B (con IVA): |neto × (1 + alícuota) − precio de la tienda| < $1 por unidad en todos los casos comparados');
select cmp_ok((select max(abs(case when exenta then l_neto else l_neto * (1 + coalesce(alic, 0) / 100) end - t_precio))
                 from cmp where empresa = 'a1000000-0000-0000-0000-000000000002' and not excl_promo_mayor and not excl_no_publicado
                  and l_neto is not null and t_precio is not null), '<=', 0.5::numeric,
  'tienda B: la diferencia máxima observada es la del redondeo al peso (<= 0,50)');
-- La referencia (el tachado) también se compara en B: nula o no nula en ambos lados y, con IVA, a menos de $1.
select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000002'
              and not excl_promo_mayor and not excl_no_publicado
              and ((l_ref is null) is distinct from (t_anterior is null)
                   or (l_ref is not null and not (abs(case when exenta then l_ref else l_ref * (1 + coalesce(alic, 0) / 100) end - t_anterior) < 1)))), 0,
  'tienda B: la referencia del local coincide con el precio_anterior de la tienda (con IVA, a menos de $1)');
select cmp_ok((select count(*) from cmp where empresa = 'a1000000-0000-0000-0000-000000000002'
                  and not excl_promo_mayor and not excl_no_publicado and l_ref is not null and t_anterior is not null)::int, '>=', 10,
  'tienda B: al menos 10 combinaciones comparan una referencia real (no nula) en ambos lados');
select cmp_ok((select count(*) from cmp where empresa = 'a1000000-0000-0000-0000-000000000002'
                  and not excl_promo_mayor and not excl_no_publicado and l_promo is not null
                  and abs(l_neto * (1 + alic / 100) - t_precio) > 0)::int, '>=', 1,
  'tienda B: hay al menos un caso con promoción donde el redondeo al peso produce una diferencia (la cota no es trivial)');
select is((select count(*)::int from cmp
            where empresa = 'a1000000-0000-0000-0000-000000000002'
              and not excl_promo_mayor and not excl_no_publicado
              and (l_promo is not null) is distinct from (t_anterior is not null)), 0,
  'tienda B: el local aplica una promoción si y solo si la tienda muestra una');
select is((select l_neto from cmp where n = 1 and empresa = 'a1000000-0000-0000-0000-000000000002' and etiqueta = 'ahora'), 850::numeric,
  'producto 1 en B: el local cobra 850 neto');
select is((select t_precio from cmp where n = 1 and empresa = 'a1000000-0000-0000-0000-000000000002' and etiqueta = 'ahora'), 1029::numeric,
  'producto 1 en B: la tienda muestra 850 × 1,21 = 1.028,50 → 1.029 (al peso entero)');
select is((select t_precio from cmp where n = 11 and empresa = 'a1000000-0000-0000-0000-000000000002' and etiqueta = 'ahora'), 149::numeric,
  'producto 11 en B: 123,45 × 1,21 = 149,37 → 149');
select is((select t_precio from cmp where n = 6 and empresa = 'a1000000-0000-0000-0000-000000000002' and etiqueta = 'ahora'), 300.5::numeric,
  'producto exento en B: sin IVA el final es el neto (300,50)');
-- Producto 11: promoción solo en B; en A no hay promoción en ninguno de los dos lados.
select is((select l_promo is null and t_anterior is null from cmp where n = 11 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), true,
  'producto 11 en A (promoción solo en B): ni la tienda ni el local la aplican');

-- ============================================================================
-- Divergencias conocidas, EXCLUIDAS de la comparación (se prueban para que la exclusión sea explícita)
-- ============================================================================

select is((select t_precio from cmp where n = 8 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 950::numeric,
  'promoción igual al normal (950): la tienda muestra el precio normal...');
select is((select l_promo is null and l_ref is null from cmp where n = 8 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), true,
  '... y el local la ignora (sin promoción ni referencia): tienda y local coinciden (S5, MSF-936)');
select is((select t_precio from cmp where n = 9 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 950::numeric,
  'promoción mayor al normal (5000 contra 950): la tienda ya NO muestra 5000 (un precio más alto que el normal): muestra 950 (S5, MSF-936)');
select is((select l_neto from cmp where n = 9 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 950::numeric,
  '... y el local cobra el precio normal 950 (nunca más que el normal): tienda y local coinciden');
select is((select count(*)::int from cmp where empresa = 'a1000000-0000-0000-0000-000000000001' and excl_promo_mayor
              and (t_anterior is not null or l_promo is not null or t_precio is distinct from l_neto)), 0,
  'tienda A: en TODO caso con promoción mayor o igual al normal la tienda y el local coinciden (sin tachado ni promoción; S5)');
select cmp_ok((select count(*) from cmp where empresa = 'a1000000-0000-0000-0000-000000000001' and excl_promo_mayor)::int, '>=', 5,
  'tienda A: hay al menos 5 combinaciones con promoción mayor o igual al normal (la afirmación anterior no es vacía)');
select is((select t_precio from cmp where n = 10 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), null::numeric,
  'producto no publicado en la tienda A: la tienda no tiene precio (null)');
select is((select l_neto from cmp where n = 10 and empresa = 'a1000000-0000-0000-0000-000000000001' and etiqueta = 'ahora'), 400::numeric,
  '... y el local sí lo cobra (con su promoción 400), porque el mostrador no depende de la publicación');
select is((select t_precio is not null from cmp where n = 10 and empresa = 'a1000000-0000-0000-0000-000000000002' and etiqueta = 'antes de todo'), true,
  'el mismo producto sí está publicado en la tienda B (la exclusión es solo de A)');

-- ============================================================================
-- Bandera APAGADA: el local vuelve al precio normal y la tienda también (ambos ignoran la promoción)
-- ============================================================================

update public.banderas_plataforma set activa = false where clave = 'promociones_precio';

-- Lado local: sin promoción ni referencia y con el neto normal (A: igual al de la tienda; B: con IVA, a menos de $1).
select is((select count(*)::int
             from cmp c
             cross join lateral private.precio_linea_venta(
                    ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, 'minorista', 1, 0, c.ahora, true) l
            where not c.excl_no_publicado
              and (l.promocion_id is not null or l.precio_referencia is not null or l.neto_unitario is null)), 0,
  'bandera apagada: el local no aplica ninguna promoción ni referencia en ningún caso (tiendas A y B)');
-- Lado tienda: sin precio anterior y con el precio normal (precio_final_publico), en A y en B.
select is((select count(*)::int
             from cmp c
             cross join lateral private.precio_vigente_empresa(
                    ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, c.ahora) t
            where not c.excl_no_publicado
              and (t.precio_anterior is not null
                   or t.precio is distinct from private.precio_final_publico(
                        ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa))), 0,
  'bandera apagada: la tienda tampoco muestra promoción (sin precio anterior y con el precio normal), tiendas A y B');
select is((select count(*)::int
             from cmp c
             cross join lateral private.precio_linea_venta(
                    ('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa, 'minorista', 1, 0, c.ahora, true) l
            where not c.excl_no_publicado
              and not (abs(case when l.alicuota_exenta or c.empresa = 'a1000000-0000-0000-0000-000000000001' then l.neto_unitario
                               else l.neto_unitario * (1 + coalesce(l.alicuota_porcentaje, 0) / 100) end
                           - private.precio_final_publico(('b1000000-0000-0000-0000-' || lpad(c.n::text, 12, '0'))::uuid, c.empresa)) < 1)), 0,
  'bandera apagada: el neto del local coincide con el precio normal de la tienda (A exacto, B con IVA a menos de $1)');

select * from finish();
rollback;
