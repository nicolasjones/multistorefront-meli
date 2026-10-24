-- F-TDA-10 (MSF-399, épica MSF-191): destacados públicos de la home. Verifica FR-001, FR-006
-- (`hay_productos`), FR-008, FR-060 y SC-001: solo destacados efectivamente visibles del host, tope de 8,
-- precio final de la empresa (paridad con private.precio_final_publico), `disponible` booleano, mismo
-- `null` para host desconocido y empresa desactivada, lista blanca, `anon` ejecuta la función y `publico`
-- sigue sin tablas. Las llamadas públicas se hacen como `anon`; las verificaciones corren como postgres.
begin;

select plan(22);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('33333333-3333-3333-3333-333333333333', 'Organización Tres'),
  ('44444444-4444-4444-4444-444444444444', 'Organización Cuatro');

-- Org 1: tienda A (+10 % y precios con IVA), tienda B (sin regla, sin IVA) y una apagada. Org 3: 10 destacados.
-- Org 4: tienda activa sin ningún producto.
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda B', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda apagada', false),
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tienda Masiva', true),
  ('e4000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Tienda Vacía', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'di-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'di-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'di-apagada.ejemplo.com'),
  ('33333333-3333-3333-3333-333333333333', 'e3000000-0000-0000-0000-000000000001', 'di-masiva.ejemplo.com'),
  ('44444444-4444-4444-4444-444444444444', 'e4000000-0000-0000-0000-000000000001', 'di-vacia.ejemplo.com');

insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central_ajuste', 10, true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'central', 0, false);

insert into dominio.categorias (id, organizacion_id, nombre, posicion) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joysticks', 1);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'DI-1', 1000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'DI-2', 3000, 'ARS', true, 'ca000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gama', 'DI-3', 500, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Oculto destacado', 'DI-4', 100, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Inactivo destacado', 'DI-5', 100, 'ARS', false, null),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Solo en apagada', 'DI-6', 100, 'ARS', true, null);

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
select ('c3000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '33333333-3333-3333-3333-333333333333', 'D ' || lpad(n::text, 2, '0'), 'DM-' || n, 100 + n, 'ARS', true
  from generate_series(1, 10) n;

insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, e.id, '11111111-1111-1111-1111-111111111111'
  from dominio.productos p
  cross join (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e1000000-0000-0000-0000-000000000002'::uuid)) e(id)
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
   and p.id <> 'a1000000-0000-0000-0000-000000000006';
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id) values
  ('a1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333'
  from dominio.productos p where p.organizacion_id = '33333333-3333-3333-3333-333333333333';

-- Tienda A destaca Alfa, Beta, Oculto, Inactivo (y oculta «Oculto destacado»); Gama no es destacado.
-- Tienda B destaca solo Gama. La apagada destaca «Solo en apagada». La masiva destaca sus 10.
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', false, true),
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', true, true),
  ('e1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', true, true);
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado)
select 'e3000000-0000-0000-0000-000000000001', p.id, '33333333-3333-3333-3333-333333333333', true, true
  from dominio.productos p where p.organizacion_id = '33333333-3333-3333-3333-333333333333';

update dominio.existencias set cantidad = 5 where producto_id = 'a1000000-0000-0000-0000-000000000001';
update dominio.existencias set cantidad = 0 where producto_id = 'a1000000-0000-0000-0000-000000000002';

insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/segunda.png'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png');

create function pg_temp.nombres(j jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(p ->> 'nombre' order by o), '[]'::jsonb)
    from jsonb_array_elements(j -> 'productos') with ordinality t(p, o);
$$;

-- Privilegios y estructura
select is(has_function_privilege('anon', 'publico.destacados_por_dominio(text)', 'execute'), true, 'anon ejecuta la función pública');
select is(has_function_privilege('authenticated', 'publico.destacados_por_dominio(text)', 'execute'), true, 'authenticated ejecuta la función pública');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'publico' and c.relkind in ('r', 'p')),
  0, 'publico sigue sin tablas'
);

-- Lectura anónima
create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('a', publico.destacados_por_dominio('di-a.ejemplo.com')),
  ('b', publico.destacados_por_dominio('di-b.ejemplo.com')),
  ('a_host', publico.destacados_por_dominio('  DI-A.Ejemplo.com.:8080 ')),
  ('masiva', publico.destacados_por_dominio('di-masiva.ejemplo.com')),
  ('vacia', publico.destacados_por_dominio('di-vacia.ejemplo.com')),
  ('desconocido', publico.destacados_por_dominio('no-existe.ejemplo.com')),
  ('apagada', publico.destacados_por_dominio('di-apagada.ejemplo.com')),
  ('vacio', publico.destacados_por_dominio(''));

reset role;

-- FR-001 · solo destacados efectivamente visibles del host
select is(pg_temp.nombres((select j from res where clave = 'a')), '["Alfa", "Beta"]'::jsonb, 'tienda A: solo sus destacados visibles (sin oculto, inactivo ni no destacado)');
select is(pg_temp.nombres((select j from res where clave = 'b')), '["Gama"]'::jsonb, 'tienda B: solo su destacado, nunca los de A (aislamiento)');
select is((select j from res where clave = 'a_host'), (select j from res where clave = 'a'), 'el host se normaliza (mayúsculas, espacios, punto final y puerto)');
select is(jsonb_array_length((select j -> 'productos' from res where clave = 'masiva')), 8, 'el tope es de 8 destacados');
select is(pg_temp.nombres((select j from res where clave = 'masiva')) -> 0, '"D 01"'::jsonb, 'con más de 8, quedan los primeros por nombre (orden estable)');

-- Precio final de la empresa (paridad con private.precio_final_publico) y disponibilidad booleana
select is(
  (select (p ->> 'precio')::numeric from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' = 'Alfa'),
  private.precio_final_publico('a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
  'tienda A: el precio es el final de la empresa (paridad con precio_final_publico)'
);
select isnt(
  (select (p ->> 'precio')::numeric from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' = 'Alfa'),
  1000::numeric, 'tienda A: el precio no es el precio_lista'
);
select is(
  (select (p ->> 'precio')::numeric from jsonb_array_elements((select j -> 'productos' from res where clave = 'b')) p where p ->> 'nombre' = 'Gama'),
  private.precio_final_publico('a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002'),
  'tienda B: el precio es el de su propia empresa'
);
select is(
  (select jsonb_agg(p -> 'disponible' order by p ->> 'nombre') from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p),
  '[true, false]'::jsonb, 'disponible es booleano: Alfa con stock, Beta sin stock'
);
select is(
  (select p ->> 'imagen' from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p where p ->> 'nombre' = 'Alfa'),
  '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/primera.png',
  'la imagen es la primera por posición'
);

-- hay_productos (FR-006)
select is((select j -> 'hay_productos' from res where clave = 'a'), 'true'::jsonb, 'tienda con productos visibles: hay_productos = true');
select is((select j -> 'hay_productos' from res where clave = 'b'), 'true'::jsonb, 'tienda B: hay_productos = true');
select is((select j from res where clave = 'vacia'), '{"hay_productos": false, "productos": []}'::jsonb, 'tienda activa sin productos: hay_productos = false y lista vacía');

-- Mismo null para host desconocido, empresa desactivada y host vacío (FR-008)
select is((select j from res where clave = 'desconocido'), null::jsonb, 'host desconocido: null');
select is((select j from res where clave = 'apagada'), null::jsonb, 'empresa desactivada: null, idéntico al desconocido');
select is((select j from res where clave = 'vacio'), null::jsonb, 'host vacío: null');

-- Lista blanca (FR-060)
select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(p) k from jsonb_array_elements((select j -> 'productos' from res where clave = 'a')) p) s),
  array['categoria_id', 'disponible', 'id', 'imagen', 'nombre', 'precio'],
  'cada producto expone solo la lista blanca (sin costos, existencias, proveedor ni organizacion_id)'
);
select is(
  (select array_agg(k order by k) from (select jsonb_object_keys(j) k from res where clave = 'a') s),
  array['hay_productos', 'productos'],
  'la respuesta expone solo hay_productos y productos'
);
select ok(not ((select j::text from res where clave = 'a') like '%organizacion%'), 'no aparece organizacion_id en ninguna parte');

select * from finish();
rollback;
