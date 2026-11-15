-- Medición de `publico.catalogo_pagina_por_dominio` con un catálogo grande (MSF-552 · T071/SC-010 de MSF-167).
--
-- Qué mide: la RPC pública del catálogo en los modos que usa la pantalla del catálogo (relevancia, orden por
-- precio ascendente y descendente, filtro de precio máximo y filtro «solo con stock») sobre una tienda con
-- N productos (la mitad con existencias). Imprime un NOTICE por modo con los milisegundos de cada llamada y
-- la mediana. Sirve para contrastar el tamaño de página 24 (D3) y el costo de la consulta por precio.
--
-- Uso (SOLO en una base LOCAL o de pruebas con todas las migraciones aplicadas; NUNCA contra dev, staging ni producción):
--   psql -X -q -v N=500 -f scripts/medir-tienda-catalogo.sql <base-local>
-- Crea una organización, una tienda con N productos y mide la RPC; todo va en una transacción que termina en
-- ROLLBACK: no deja datos. La medición es local (sin carga concurrente ni red): sirve para comparar órdenes de
-- magnitud, no como SLA. Las cifras de referencia están en `docs/tiendas-online.md` («Rendimiento en celular»).
begin;

insert into organizaciones (id, nombre) values ('99999999-9999-9999-9999-999999999999','Medicion');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('e9000000-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','T',true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values ('99999999-9999-9999-9999-999999999999','e9000000-0000-0000-0000-000000000001','med.ejemplo.com');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
 select ('b9000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'99999999-9999-9999-9999-999999999999','P'||n,'S'||n,100+n,'ARS',true from generate_series(1,:N) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
 select id,'e9000000-0000-0000-0000-000000000001',organizacion_id from dominio.productos where organizacion_id='99999999-9999-9999-9999-999999999999';
-- La fila de existencias nace con el producto (trigger) en 0: la mitad queda con stock para el filtro «solo con stock».
update dominio.existencias set cantidad = 5
 where producto_id in (select id from dominio.productos where organizacion_id='99999999-9999-9999-9999-999999999999' and right(id::text,12)::bigint % 2 = 0);

do $$ declare
  modo text;
  i int;
  t0 timestamptz;
  r jsonb;
  tiempos numeric[] := '{}';
begin
  foreach modo in array array['relevancia','precio_asc','precio_desc','precio_max','solo_stock'] loop
    tiempos := '{}';
    for i in 1..5 loop
      t0 := clock_timestamp();
      r := publico.catalogo_pagina_por_dominio(
        'med.ejemplo.com',
        null,
        (modo = 'solo_stock'),
        (case when modo = 'precio_max' then 300 else null end),
        (case when modo in ('precio_asc','precio_desc') then modo else 'relevancia' end),
        1
      );
      tiempos := array_append(tiempos, round(extract(epoch from clock_timestamp()-t0)*1000));
    end loop;
    raise notice 'catalogo % -> mediana % ms · corridas % · productos en la pagina % · total %',
      modo,
      (select percentile_cont(0.5) within group (order by t) from unnest(tiempos) t),
      tiempos,
      jsonb_array_length(r->'productos'),
      r->>'total';
  end loop;
end $$;

rollback;
