-- Medición de `public.listar_movimientos_stock` con volumen (MSF-621). No es una prueba pgTAP: no corre en CI.
-- Cómo correrla, en una base descartable con las migraciones aplicadas y como superusuario:
--   psql -U postgres -d <base> -At -f supabase/tests/perf/movimientos_nota_comprobante.perf.sql
-- Siembra, en una organización nueva con un administrador, 5.000 comprobantes y 50.000 movimientos (la mitad con
-- referencia a un comprobante); analiza `movimientos_stock`, `comprobantes_venta`, `productos` y `clientes` y
-- mide con `EXPLAIN ANALYZE` (se mira «Execution Time»). Todo queda dentro de una transacción que termina en
-- `rollback`. En todas las variantes la consulta es la primera página: orden `creado_en desc, id desc`, límite 25,
-- sin filtro de producto.
--
-- Variantes (cada una con su nombre en el resto del script):
--   V1  función entregada `listar_movimientos_stock(null, 25, 0)`: pagina primero (con `count(*) over ()` y
--       `limit 25`) y recién después cruza productos, motivos, depósitos y el comprobante (subconsulta por fila de
--       la página). Se mide como superusuario (sin RLS) y como `authenticated` con el administrador (con RLS).
--   V2  comparación: aplica el cruce del comprobante (el mismo regexp_match, la subconsulta por fila y el
--       regexp_replace de la función) ANTES del `limit 25`, así que corre sobre todas las filas de la organización
--       (el `count(*) over ()` las recorre de todos modos). Mide solo el cruce, no la función completa: no hace
--       los joins a productos, motivos ni depósitos. Sin RLS y con RLS.
--   V3  join común contra `comprobantes_venta` en lugar de la subconsulta por fila, paginando primero (CTE con
--       `limit 25`, sin `count(*) over ()` ni joins a productos, motivos o depósitos). Solo con RLS y con
--       `EXPLAIN (ANALYZE, BUFFERS)`.
--
-- El script imprime el plan y el «Execution Time» de cada variante. Los tiempos y la relación entre roles y
-- variantes varían entre corridas y máquinas; el script imprime los tiempos de cada una.
--
-- Cifra de referencia (observada por el autor en pg15 descartable, máquina cargada; otras corridas varían): V1 con
-- RLS, entre 109 y 189 ms.
--
-- Observaciones cualitativas puntuales, observadas por el autor. «Migración vigente» es `20270507290000` tal como
-- estaba en `08a4ebced4f2` (desde entonces solo cambiaron comentarios):
--   - V3, migración vigente: en una corrida con RLS y 5.000 comprobantes, el plan fue un `Hash Left Join` con
--     `Seq Scan on comprobantes_venta` de 5.000 filas (el plan estimaba 50).
--   - Una corrida con RLS y 300.000 comprobantes (se cambió `generate_series(1, 5000)` por 300000 para esa prueba),
--     con una versión intermedia de la migración, sin commitear, sobre `b46d47c6044e`, que usaba un join lateral en
--     lugar de la subconsulta: `Seq Scan` de 300.000 filas. La migración vigente (V1) en esa misma siembra usó
--     `Index Scan using comprobantes_venta_id_organizacion_id_key`.
--   - Con versiones del script anteriores a `08a4ebced4f2` (la de `ee70034e76dd` y la edición posterior que agregó
--     `authenticated`), cuya comparación hacía el cruce antes de paginar con join común y que analizaban solo
--     `movimientos_stock`: una corrida con RLS, de unos 17 s, mostró un plan nested loop con
--     `Rows Removed by Join Filter: 187475000`. Causa no verificada; no se probó si influyó que no se analizara
--     `comprobantes_venta`.
begin;
set search_path = public, extensions;

insert into organizaciones (id, nombre) values ('77777777-7777-7777-7777-777777777777', 'Perf');
insert into auth.users (id, email) values ('d7000000-0000-0000-0000-000000000001', 'perf@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id)
  values ('d7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'administrador');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista)
  values ('a7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'P', 'PERF-1', 1);
insert into dominio.clientes (id, organizacion_id, numero, nombre, tipo)
  values ('c7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 90001, 'C', 'minorista');
insert into dominio.comprobantes_venta (id, organizacion_id, cliente_id, tipo, numero, fecha, estado, total_sin_iva, total_con_iva)
select ('e7000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '77777777-7777-7777-7777-777777777777',
       'c7000000-0000-0000-0000-000000000001', 'factura', 'FAC-' || g, current_date, 'emitida', 1, 1
from generate_series(1, 5000) g;
insert into dominio.movimientos_stock (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha, actor_nombre, creado_en, nota)
select '77777777-7777-7777-7777-777777777777', 'a7000000-0000-0000-0000-000000000001', 'salida', 1, -1, 0,
       (select id from dominio.motivos_movimiento where organizacion_id = '77777777-7777-7777-7777-777777777777' limit 1),
       current_date, 'x', now() - (g || ' seconds')::interval,
       case when g % 2 = 0 then 'Reserva comprobante:e7000000-0000-0000-0000-' || lpad((1 + g % 5000)::text, 12, '0') || ':linea:1' else 'Conteo' end
from generate_series(1, 50000) g;
analyze dominio.movimientos_stock;
analyze dominio.comprobantes_venta;
analyze dominio.productos;
analyze dominio.clientes;

-- Sin RLS (superusuario) y con RLS (`authenticated`).

-- V1, sin RLS.
explain (analyze, costs off, timing off) select * from public.listar_movimientos_stock(null, 25, 0);

-- V2, sin RLS.
explain (analyze, costs off, timing off)
select m.id,
       case when cv.numero is not null then regexp_replace(
         m.nota,
         '(^|[^a-zA-Z0-9_])comprobante:' || cv.id::text || '(?::linea:[0-9]+)?',
         '\1' || replace(cv.numero, '\', '\\'),
         'gi')
       else m.nota end,
       count(*) over ()
from dominio.movimientos_stock m
left join lateral (
  select (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])comprobante:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'))[1]::uuid as comprobante_id
) ref on true
left join lateral (
  select ref.comprobante_id as id,
         (select c.numero from dominio.comprobantes_venta c
           where c.id = ref.comprobante_id and c.organizacion_id = m.organizacion_id) as numero
) cv on true
order by m.creado_en desc, m.id desc limit 25;

-- ===== Como authenticated (con RLS) =====
select set_config('request.jwt.claims', json_build_object('sub', 'd7000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- V1, con RLS.
explain (analyze, costs off, timing off) select * from public.listar_movimientos_stock(null, 25, 0);

-- V2, con RLS.
explain (analyze, costs off, timing off)
select m.id,
       case when cv.numero is not null then regexp_replace(
         m.nota,
         '(^|[^a-zA-Z0-9_])comprobante:' || cv.id::text || '(?::linea:[0-9]+)?',
         '\1' || replace(cv.numero, '\', '\\'),
         'gi')
       else m.nota end,
       count(*) over ()
from dominio.movimientos_stock m
left join lateral (
  select (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])comprobante:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'))[1]::uuid as comprobante_id
) ref on true
left join lateral (
  select ref.comprobante_id as id,
         (select c.numero from dominio.comprobantes_venta c
           where c.id = ref.comprobante_id and c.organizacion_id = m.organizacion_id) as numero
) cv on true
order by m.creado_en desc, m.id desc limit 25;

-- V3: join común contra `comprobantes_venta`, paginando primero (solo con RLS).
explain (analyze, buffers, timing off)
with pagina as (
  select m.*
  from dominio.movimientos_stock m
  order by m.creado_en desc, m.id desc
  limit 25
)
select m.id,
       case when cv.numero is not null then regexp_replace(
         m.nota,
         '(^|[^a-zA-Z0-9_])comprobante:' || cv.id::text || '(?::linea:[0-9]+)?',
         '\1' || replace(cv.numero, '\', '\\'),
         'gi')
       else m.nota end
from pagina m
left join lateral (
  select (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])comprobante:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'))[1]::uuid as comprobante_id
) ref on true
left join dominio.comprobantes_venta cv on cv.id = ref.comprobante_id and cv.organizacion_id = m.organizacion_id;

reset role;

rollback;
