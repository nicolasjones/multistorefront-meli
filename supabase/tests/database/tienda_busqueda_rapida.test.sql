-- MSF-846 (parte A): ramas de la reescritura de publico.busqueda_pagina_por_dominio (20270305100000: precio solo
-- de la página, salvo con precio máximo u orden por precio) y equivalencia de private.precio_vigente_empresa
-- tras pasarla a plpgsql (20270305100300): mismo precio y precio_anterior con y sin promoción vigente.
-- Fixture propio: 28 «Cable N» ($ 100·N, ARS), «Cable dólar» (USD sin cotización: precio no calculable, null)
-- y «Cable con promo» ($ 5.000 con promoción vigente de $ 3.000). Stock solo en «Cable 3» y «Cable 5».
begin;

select plan(23);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'br-a.ejemplo.com');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('a1000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       '11111111-1111-1111-1111-111111111111', 'Cable ' || n, 'BR-' || n, 100 * n, 'ARS', true
  from generate_series(1, 28) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo) values
  ('a1000000-0000-0000-0000-000000000201', '11111111-1111-1111-1111-111111111111', 'Cable dólar', 'BR-USD', 10, 'USD', true),
  ('a1000000-0000-0000-0000-000000000202', '11111111-1111-1111-1111-111111111111', 'Cable con promo', 'BR-PROMO', 5000, 'ARS', true);

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';

update dominio.existencias set cantidad = 2
 where producto_id in ('a1000000-0000-0000-0000-000000000103', 'a1000000-0000-0000-0000-000000000105');

create function pg_temp.nombres(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(p ->> 'nombre' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'productos') with ordinality t(p, o);
$$;
create function pg_temp.reiniciar() returns void language sql as $$ delete from public.limite_pedidos_publicos; $$;

-- Sin promoción vigente (bandera apagada por defecto): precio ≡ precio_final_publico y precio_anterior null.
select is(
  (select count(*)::int from dominio.productos p
    cross join lateral private.precio_vigente_empresa(p.id, 'e1000000-0000-0000-0000-000000000001') v
   where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
     and (v.precio is distinct from private.precio_final_publico(p.id, 'e1000000-0000-0000-0000-000000000001')
          or v.precio_anterior is not null)),
  0, 'sin promoción vigente: precio = precio_final_publico y precio_anterior null en todos los productos'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000201', 'e1000000-0000-0000-0000-000000000001')),
  null::numeric, 'USD sin cotización: precio null'
);
select is(
  (select count(*)::int from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000201', 'e1000000-0000-0000-0000-000000000001')),
  1, 'siempre devuelve una fila (también con precio null)'
);
select is(
  (select count(*)::int from private.precio_vigente_empresa('ffffffff-ffff-ffff-ffff-ffffffffffff', 'e1000000-0000-0000-0000-000000000001')),
  1, 'producto inexistente: una fila con precio null'
);

-- Con promoción vigente: precio = promocional con la regla de IVA; precio_anterior = precio normal.
update public.banderas_plataforma set activa = true where clave = 'promociones_precio';
insert into dominio.promociones_precio (organizacion_id, empresa_id, producto_id, precio_promocional, desde, hasta) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000202', 3000, now() - interval '1 hour', now() + interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000101', 50, now() + interval '1 day', now() + interval '2 days');

select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000202', 'e1000000-0000-0000-0000-000000000001')),
  private.precio_con_iva_visible('a1000000-0000-0000-0000-000000000202', 'e1000000-0000-0000-0000-000000000001', 3000),
  'con promoción vigente: precio = promocional con alícuota e interruptor de IVA'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000202', 'e1000000-0000-0000-0000-000000000001')),
  private.precio_final_publico('a1000000-0000-0000-0000-000000000202', 'e1000000-0000-0000-0000-000000000001'),
  'con promoción vigente: precio_anterior = precio normal'
);
select ok(
  (select precio < precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000202', 'e1000000-0000-0000-0000-000000000001')),
  'la promoción baja el precio respecto del anterior'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000101', 'e1000000-0000-0000-0000-000000000001')),
  null::numeric, 'promoción futura: no rige (precio_anterior null)'
);
select is(
  (select precio from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000101', 'e1000000-0000-0000-0000-000000000001',
                                                     now() + interval '36 hours')),
  private.precio_con_iva_visible('a1000000-0000-0000-0000-000000000101', 'e1000000-0000-0000-0000-000000000001', 50),
  'p_ahora se respeta: dentro de la ventana de la promoción futura rige'
);
select is(
  (select precio_anterior from private.precio_vigente_empresa('a1000000-0000-0000-0000-000000000201', 'e1000000-0000-0000-0000-000000000001')),
  null::numeric, 'precio normal no calculable: precio_anterior null'
);
select is(
  (select p.provolatile::text || p.prosecdef::text from pg_proc p where p.oid = 'private.precio_vigente_empresa(uuid, uuid, timestamptz)'::regprocedure),
  'strue', 'sigue stable y security definer'
);
select is(
  has_function_privilege('anon', 'private.precio_vigente_empresa(uuid, uuid, timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'private.precio_vigente_empresa(uuid, uuid, timestamptz)', 'execute'),
  false, 'anon y authenticated siguen sin ejecutarla'
);

-- Ramas de la búsqueda (como postgres: las funciones son SECURITY DEFINER)
select pg_temp.reiniciar();

-- Rama precio_max: precio de todas las coincidencias; el sin precio (USD) queda fuera.
select is(
  (publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, 1000) ->> 'total')::int, 10,
  'precio_max 1000: Cable 1 a Cable 10, sin el producto sin precio'
);
select is(
  (publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, 1000, 'precio_desc') -> 'productos' -> 0 ->> 'nombre'),
  'Cable 10', 'precio_max con precio_desc: el más caro dentro del tope primero'
);

-- Rama orden por precio con un producto sin precio: va último en ambos sentidos.
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'precio_asc')) -> 0,
  '"Cable 1"'::jsonb, 'precio_asc: el más barato primero'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'precio_asc')) -> 23,
  '"Cable 24"'::jsonb, 'precio_asc: la página 1 trae 24 y llega hasta Cable 24'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'precio_asc', 2)) -> 5,
  '"Cable dólar"'::jsonb, 'precio_asc página 2: el producto sin precio queda al final'
);
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'precio_desc', 2)) -> 5,
  '"Cable dólar"'::jsonb, 'precio_desc página 2: el producto sin precio también queda al final'
);
select is(
  (select p -> 'precio' from jsonb_array_elements(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'precio_asc', 2) -> 'productos') p
    where p ->> 'nombre' = 'Cable dólar'),
  'null'::jsonb, 'el producto sin precio sale con precio null (no se inventa uno)'
);

-- Rama solo_con_stock
select is(
  pg_temp.nombres(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, true)),
  '["Cable 3", "Cable 5"]'::jsonb, 'solo con stock: únicamente los dos con existencia'
);
select is(
  (publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, true, 400) ->> 'total')::int, 1,
  'solo con stock y precio máximo 400: solo Cable 3'
);

-- Página 2 por relevancia: 30 coincidencias -> 24 + 6, sin repetir ni perder.
select is(
  (select count(distinct n)::int from (
     select jsonb_array_elements(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'relevancia', 1) -> 'productos') ->> 'id' n
     union all
     select jsonb_array_elements(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'relevancia', 2) -> 'productos') ->> 'id') s),
  30, 'relevancia: páginas 1 y 2 cubren las 30 coincidencias sin repetir'
);
select is(
  jsonb_array_length(publico.busqueda_pagina_por_dominio('br-a.ejemplo.com', 'cable', null, false, null, 'relevancia', 2) -> 'productos'),
  6, 'la página 2 trae las 6 restantes'
);

select * from finish();
rollback;
