-- Medición de `public.listar_movimientos_stock` con volumen (MSF-621). No es una prueba pgTAP: no corre en CI.
-- Cómo correrla, en una base descartable con las migraciones aplicadas y como superusuario:
--   psql -U postgres -d <base> -At -f supabase/tests/perf/movimientos_nota_comprobante.perf.sql
-- Siembra 50.000 movimientos de una organización (la mitad con referencia a uno de 5.000 comprobantes), analiza
-- todas las tablas sembradas y mide una página de 25 con `EXPLAIN ANALYZE`; se mira «Execution Time». Todo queda
-- dentro de una transacción que termina en `rollback`.
--
-- Variantes (cada una con su nombre en el resto del script):
--   V1  función entregada: pagina primero y cruza solo la página (subconsulta por fila). Se mide como
--       superusuario (sin RLS) y como `authenticated` con un administrador de la organización (con RLS).
--   V2  comparación: el cruce del comprobante con subconsulta por fila SIN paginar (todas las filas, antes del
--       límite). Mide solo el cruce, no la función completa: no incluye los joins a productos, motivos y
--       depósitos. Sin RLS y con RLS.
--   V3  join común contra `comprobantes_venta`, paginando primero. Solo con RLS y con `EXPLAIN (ANALYZE, BUFFERS)`.
--
-- Observado por el autor (pg15 descartable, máquina cargada, load 12-17; los tiempos varían con la carga):
--   - V1, versión actual: seis corridas, entre 109 y 189 ms con RLS y entre 168 y 380 ms sin RLS.
--   - V2, versión actual: seis corridas, entre 1,2 y 1,9 s con RLS y entre 3,6 y 5,4 s sin RLS.
--   - Sin RLS salió más lento que con RLS en V1 y en V2; no se investigó la causa.
--   - V3, versión actual, una corrida con RLS y 5.000 comprobantes: `Hash Left Join` con `Seq Scan on
--     comprobantes_venta` de 5.000 filas (el plan estimaba 50).
--   - Una corrida con RLS y 300.000 comprobantes, con una versión intermedia de la migración que usaba un join
--     lateral en lugar de la subconsulta: `Seq Scan` de 300.000 filas, 152 ms. La versión actual (V1) en esa misma
--     siembra usó `Index Scan using comprobantes_venta_id_organizacion_id_key`, 110 ms.
--   - Con una versión anterior de este script (V2 con join común, y `analyze` solo de `movimientos_stock`):
--     sin RLS, dos de tres corridas de 14 a 15 s; con RLS, cuatro corridas de 13 a 17 s; en la de 16,8 s el plan fue
--     un nested loop con `Rows Removed by Join Filter: 187475000`. Causa no verificada; no se probó si influyó
--     que no se analizara `comprobantes_venta`.
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
