-- F-TDA-20 (MSF-263, épica MSF-149): productos relacionados de la ficha pública. Verifica FR-010 y SC-004:
-- misma categoría, exclusión del actual, tope de 4, orden (destacados primero, luego nombre), ocultos e
-- inactivos fuera, aislamiento entre dos tiendas, mismo `null` para host desconocido / empresa desactivada /
-- producto ajeno, oculto, inactivo o inexistente, lista blanca y `anon` ejecuta la función.
begin;

select plan(16);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'rel-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'rel-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'rel-apagada.ejemplo.com');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', 1),
  ('ca000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cables', 2);

-- Categoría Joysticks: Actual, Alfa, Beta, Cima (destacado), Delta, Eco, Oculto, Inactivo. Cables: Cable, Cable 2.
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Actual', 'R-1', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Alfa', 'R-2', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Beta', 'R-3', 3000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Cima', 'R-4', 500, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Delta', 'R-5', 500, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Eco', 'R-6', 500, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Oculto', 'R-7', 500, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Inactivo', 'R-8', 500, 'ARS', false, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Cable', 'R-9', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000002'),
  ('a1000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Solo B', 'R-10', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Sin categoría', 'R-11', 100, 'ARS', true, null),
  ('a1000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Solo apagada', 'R-12', 100, 'ARS', true, 'ca000000-0000-0000-0000-000000000002');

-- A tiene todos menos «Solo B» y «Solo apagada»; B solo tiene Actual, Alfa y Solo B; la apagada, uno.
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', p.organizacion_id
  from dominio.productos p
 where p.id not in ('a1000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000c');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
  ('a1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');

insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', false, true);

update dominio.existencias set cantidad = 5 where producto_id = 'a1000000-0000-0000-0000-000000000002';
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000003';

insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/segunda.png'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/primera.png');

create function pg_temp.nombres(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(p ->> 'nombre' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'productos') with ordinality t(p, o);
$$;

select is(has_function_privilege('anon', 'publico.relacionados_por_dominio(text, uuid)', 'execute'), true, 'anon ejecuta la función pública');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('a', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('a_host', publico.relacionados_por_dominio('  REL-A.Ejemplo.com.:8080 ', 'a1000000-0000-0000-0000-000000000001')),
  ('b', publico.relacionados_por_dominio('rel-b.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('cable', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000009')),
  ('sin_cat', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-00000000000b')),
  ('desconocido', publico.relacionados_por_dominio('no-existe.ejemplo.com', 'a1000000-0000-0000-0000-000000000001')),
  ('apagada', publico.relacionados_por_dominio('rel-apagada.ejemplo.com', 'a1000000-0000-0000-0000-00000000000c')),
  ('oculto', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000007')),
  ('inactivo', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-000000000008')),
  ('ajeno', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'a1000000-0000-0000-0000-00000000000a')),
  ('inexistente', publico.relacionados_por_dominio('rel-a.ejemplo.com', 'ffffffff-ffff-ffff-ffff-ffffffffffff')),
  ('nulo', publico.relacionados_por_dominio('rel-a.ejemplo.com', null));

reset role;

-- Categoría, exclusión del actual, tope 4 y orden: Cima (destacado) primero, luego Alfa, Beta, Delta (Eco queda fuera por el tope).
select is(pg_temp.nombres((select j from res where clave = 'a')), '["Cima", "Alfa", "Beta", "Delta"]'::jsonb, 'misma categoría, sin el actual, tope 4, destacados primero y luego por nombre');
select is(jsonb_array_length((select j -> 'productos' from res where clave = 'a')), 4, 'el tope es de 4');
select is((select j from res where clave = 'a_host'), (select j from res where clave = 'a'), 'el host se normaliza');
select ok(not ((select j::text from res where clave = 'a') like '%Oculto%' or (select j::text from res where clave = 'a') like '%Inactivo%' or (select j::text from res where clave = 'a') like '%Cable%'), 'ocultos, inactivos y otras categorías quedan fuera');

-- Aislamiento entre tiendas: B solo ve lo asignado a B
select is(pg_temp.nombres((select j from res where clave = 'b')), '["Alfa", "Solo B"]'::jsonb, 'tienda B: solo sus productos, nunca los de A');
select is(pg_temp.nombres((select j from res where clave = 'cable')), '[]'::jsonb, 'categoría sin otros productos: lista vacía');
select is((select j from res where clave = 'sin_cat'), '{"productos": []}'::jsonb, 'producto visible sin categoría: lista vacía');

-- Precio final y disponibilidad
select is(
  (select (p ->> 'precio')::numeric from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' = 'Alfa'),
  private.precio_final_publico('a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001'),
  'el precio es el final de la empresa'
);
select is(
  (select jsonb_agg(p -> 'disponible' order by p ->> 'nombre') from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' in ('Alfa', 'Beta')),
  '[true, false]'::jsonb, 'disponible es booleano: Alfa con stock, Beta sin stock'
);
select is(
  (select p ->> 'imagen' from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' = 'Alfa'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000002/primera.png',
  'la imagen es la primera por posición'
);

-- Mismo null en todos los casos no visibles
select is(
  (select count(*)::int from res where clave in ('desconocido', 'apagada', 'oculto', 'inactivo', 'ajeno', 'inexistente', 'nulo') and j is null),
  7, 'null idéntico: host desconocido, empresa desactivada, producto oculto, inactivo, ajeno, inexistente o nulo'
);

-- Lista blanca
select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(p) k from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p) s),
  array['categoria_id', 'disponible', 'id', 'imagen', 'nombre', 'precio'],
  'cada producto expone solo la lista blanca (sin costos, existencias, proveedor ni organizacion_id)'
);
select is(
  (select array_agg(k order by k) from (select jsonb_object_keys(j) k from res where clave = 'a') s),
  array['productos'], 'la respuesta expone solo productos'
);
select ok(not ((select j::text from res where clave = 'a') like '%organizacion%'), 'no aparece organizacion_id');

select * from finish();
rollback;
