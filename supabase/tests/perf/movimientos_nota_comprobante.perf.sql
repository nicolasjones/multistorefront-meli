-- Medición de `public.listar_movimientos_stock` con volumen (MSF-621). No es una prueba pgTAP: no corre en CI.
-- Cómo correrla, en una base descartable con las migraciones aplicadas y como superusuario:
--   psql -U postgres -d <base> -At -f supabase/tests/perf/movimientos_nota_comprobante.perf.sql
-- Siembra 50.000 movimientos de una organización (la mitad con referencia a uno de 5.000 comprobantes) y analiza
-- las tablas sembradas. Todo queda dentro de una transacción que termina en `rollback`. Se mira «Execution Time»
-- de cada plan. Mide tres cosas, sobre una página de 25:
--   1. La función entregada (pagina primero y cruza después), como superusuario y como `authenticated`.
--   2. Una comparación que mide solo el cruce del comprobante (no la función completa: no incluye los joins a
--      productos, motivos y depósitos) aplicado a todas las filas antes de paginar, en los dos roles.
--   3. Una variante descartada (pagina primero, pero busca el comprobante con un join común), solo con RLS y con
--      `EXPLAIN (ANALYZE, BUFFERS)`.
-- Los tiempos son mediciones del autor y varían con la máquina y la carga.
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

-- Cada medición va dos veces: como superusuario (sin RLS) y como `authenticated` con un administrador de la
-- organización sembrada (RLS aplicada por fila), que es lo que ve la aplicación.

-- La función entregada: pagina primero y cruza después.
explain (analyze, costs off, timing off) select * from public.listar_movimientos_stock(null, 25, 0);

-- Comparación (mide el cruce del comprobante, no la función completa): la misma expresión de la función (regexp_match del UUID, búsqueda del comprobante y
-- regexp_replace con el escape de la barra) aplicada a todas las filas antes de paginar, que es la forma descartada.
-- Las tablas sembradas se analizan antes de medir: sin estadísticas el planificador elige planes muy distintos entre corridas.
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

-- La función entregada, con RLS: pagina primero y cruza después.
explain (analyze, costs off, timing off) select * from public.listar_movimientos_stock(null, 25, 0);

-- Comparación, con RLS (mide el cruce del comprobante, no la función completa): la misma expresión de la función (regexp_match del UUID, búsqueda del comprobante y
-- regexp_replace con el escape de la barra) aplicada a todas las filas antes de paginar, que es la forma descartada.
-- Las tablas sembradas se analizan antes de medir: sin estadísticas el planificador elige planes muy distintos entre corridas.
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

-- Variante descartada: pagina primero pero busca el comprobante con un join común, con RLS y `buffers`.
-- Observado por el autor en una corrida (pg15 descartable, máquina cargada): el plan hace un `Hash Left Join` con
-- `Seq Scan on comprobantes_venta` de las 5.000 filas de la organización sembrada (la estimación del plan era de 50
-- filas); con 300.000 comprobantes el seq scan fue de 300.000 filas. La función entregada, con la subconsulta por
-- fila, usó `Index Scan using comprobantes_venta_id_organizacion_id_key` en esa prueba.
-- Observado también, con una versión anterior de este script en la que el cruce antes de paginar usaba un join
-- común: corridas atípicas de 13 a 17 s; la de unos 17 s mostró un nested loop con `Rows Removed by Join Filter:
-- 187475000`. Con esa versión, sin `analyze` de `comprobantes_venta`, los planes variaron mucho entre corridas.
-- Causa observada en esas corridas; no se probaron otras.
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
