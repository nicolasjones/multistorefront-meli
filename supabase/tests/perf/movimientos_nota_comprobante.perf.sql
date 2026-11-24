-- Medición de `public.listar_movimientos_stock` con volumen (MSF-621). No es una prueba pgTAP: no corre en CI.
-- Cómo correrla, en una base descartable con las migraciones aplicadas y como superusuario:
--   psql -U postgres -d <base> -At -f supabase/tests/perf/movimientos_nota_comprobante.perf.sql
-- Siembra 50.000 movimientos de una organización (la mitad con referencia a uno de 5.000 comprobantes), mide una
-- página de 25 con la función y, para comparar, el cruce hecho antes de paginar. Todo queda dentro de una
-- transacción que termina en `rollback`. Se mira «Execution Time» de cada plan.
begin;
set search_path = public, extensions;

insert into organizaciones (id, nombre) values ('77777777-7777-7777-7777-777777777777', 'Perf');
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

-- La función: pagina primero y cruza después.
explain (analyze, costs off, timing off) select * from public.listar_movimientos_stock(null, 25, 0);

-- Comparación: el mismo cruce antes de paginar (la forma que se descartó).
explain (analyze, costs off, timing off)
select m.id,
       case when ref.texto is not null and cv.numero is not null then replace(m.nota, ref.texto, cv.numero) else m.nota end,
       count(*) over ()
from dominio.movimientos_stock m
left join lateral (
  select (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])(comprobante:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::linea:[0-9]+)?)', 'i'))[1] as texto,
         (regexp_match(m.nota, '(?:^|[^a-zA-Z0-9_])comprobante:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'))[1]::uuid as comprobante_id
) ref on true
left join dominio.comprobantes_venta cv on cv.id = ref.comprobante_id and cv.organizacion_id = m.organizacion_id
order by m.creado_en desc, m.id desc limit 25;

rollback;
