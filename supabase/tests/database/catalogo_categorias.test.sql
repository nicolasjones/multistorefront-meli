-- F-CAT-08 (MSF-298, épica MSF-160): categorías y su visibilidad por tienda. Cubre SC-004 / SC-005 y
-- FR-015…FR-024: máximo 2 niveles garantizado por la base, nombre único por nivel (sin distinguir
-- mayúsculas ni espacios extremos), RLS por organización y por la sección `categorias` (Administrador y
-- Operador editan, Consulta lee, Mostrador no accede, anon nada), reordenado atómico con candado asesor
-- por organización, eliminación (productos sin categoría y subcategorías a raíz, rechazo por choque de
-- nombre), asignación de categoría a un producto con su evento, y la vista `v_productos_listado` con la
-- categoría al final (contrato para MSF-179/202).
-- `rls_en_toda_tabla` (global) recorre `public` + `dominio`: acá se verifica además la RLS de cada tabla.
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated".
begin;

select plan(87);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'administrador@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'consulta@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'mostrador@example.com'),
  ('c2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('c1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('c1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'mostrador', 'activo'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Mundo JC'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick', 'JOY-1', 49.90),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cable', 'CAB-1', 10),
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos', 'DOS-1', 5);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura, esquema (Principio VII) y privilegios
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'dominio.categorias'::regclass),
  true, 'categorias (dominio) tiene RLS'
);
select is(
  (select relrowsecurity from pg_class where oid = 'dominio.categorias_empresa'::regclass),
  true, 'categorias_empresa (dominio) tiene RLS'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.categorias'::regclass),
  'dominio', 'categorias vive en el esquema dominio (no en public)'
);
select is(
  (select n.nspname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = 'dominio.categorias_empresa'::regclass),
  'dominio', 'categorias_empresa vive en el esquema dominio (no en public)'
);
select is(has_table_privilege('anon', 'dominio.categorias', 'SELECT'), false, 'anon no lee categorias');
select is(has_table_privilege('anon', 'dominio.categorias_empresa', 'INSERT'), false, 'anon no inserta en categorias_empresa');
select is(has_table_privilege('anon', 'dominio.categorias_empresa', 'UPDATE'), false, 'nadie actualiza categorias_empresa (sin UPDATE)');
select is(
  has_function_privilege('anon', 'public.guardar_categoria(uuid, text, uuid, uuid[])', 'EXECUTE'),
  false, 'anon no ejecuta guardar_categoria'
);
select is(
  has_function_privilege('authenticated', 'public.guardar_categoria(uuid, text, uuid, uuid[])', 'EXECUTE'),
  true, 'authenticated ejecuta guardar_categoria'
);
select is(
  (select attname::text from pg_attribute
    where attrelid = 'public.v_productos_listado'::regclass and attnum > 0 and not attisdropped
    order by attnum desc limit 1),
  'codigo_barras', 'codigo_barras es la última columna de la vista (F-CAT-14)'
);
select is(has_table_privilege('anon', 'public.v_categorias_productos', 'SELECT'), false, 'anon no lee v_categorias_productos');
select is(has_table_privilege('authenticated', 'public.v_categorias_productos', 'SELECT'), true, 'authenticated lee v_categorias_productos');

-- ============================================================================
-- Alta y máximo de 2 niveles (FR-015, FR-016)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$select public.guardar_categoria(null, '  Joysticks  ',
      null, array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[])$$,
  'administrador: crea la categoría Joysticks visible en las dos tiendas'
);
select is(
  (select nombre from dominio.categorias where lower(btrim(nombre)) = 'joysticks' and padre_id is null),
  'Joysticks', 'el nombre se guarda recortado'
);
select is(
  (select posicion from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  0, 'la primera raíz queda en la posición 0'
);
select lives_ok(
  $$select public.guardar_categoria(null, 'Cableados',
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
      array['e1000000-0000-0000-0000-000000000002']::uuid[])$$,
  'administrador: crea la subcategoría Cableados'
);
select is(
  (select padre_id from dominio.categorias where nombre = 'Cableados' and padre_id is not null),
  (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  'la subcategoría cuelga de la raíz'
);
select throws_ok(
  $$select public.guardar_categoria(null, 'Tercer nivel',
      (select id from dominio.categorias where nombre = 'Cableados' and padre_id is not null), '{}'::uuid[])$$,
  '23514', null, 'la base rechaza un tercer nivel (máximo 2)'
);
select throws_ok(
  $$select public.guardar_categoria(null, '  joysticks  ', null, '{}'::uuid[])$$,
  '23505', null, 'el nombre es único por nivel sin distinguir mayúsculas ni espacios extremos'
);
select lives_ok(
  $$select public.guardar_categoria(null, 'Cableados', null, '{}'::uuid[])$$,
  'el mismo nombre en otro nivel (raíz) se admite'
);
select throws_ok(
  $$select public.guardar_categoria(null, '   ', null, '{}'::uuid[])$$,
  '22023', null, 'un nombre vacío se rechaza'
);
select throws_ok(
  $$select public.guardar_categoria(
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
      'Joysticks',
      (select id from dominio.categorias where nombre = 'Cableados' and padre_id is null),
      '{}'::uuid[])$$,
  '23514', null, 'una categoría con subcategorías no puede pasar a ser subcategoría'
);
select throws_ok(
  $$select public.guardar_categoria(
      'a9000000-0000-0000-0000-000000000009',
      'Fundas', (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null), '{}'::uuid[])$$,
  'P0002', null, 'editar una categoría inexistente devuelve P0002 (sin crear nada)'
);
select lives_ok(
  $$select public.guardar_categoria(null, 'Fundas', null, '{}'::uuid[])$$,
  'administrador: crea la raíz Fundas'
);
select throws_ok(
  $$select public.guardar_categoria(
      (select id from dominio.categorias where nombre = 'Fundas' and padre_id is null),
      'Fundas',
      (select id from dominio.categorias where nombre = 'Fundas' and padre_id is null),
      '{}'::uuid[])$$,
  '23514', null, 'una categoría no puede ser su propia categoría padre (sin ciclos)'
);
select is(
  (select array_agg(empresa_id order by empresa_id) from dominio.categorias_empresa ce
    join dominio.categorias c on c.id = ce.categoria_id
   where c.nombre = 'Joysticks' and c.padre_id is null),
  array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002']::uuid[],
  'la categoría queda visible en las tiendas elegidas'
);
select is(
  (select array_agg(empresa_id order by empresa_id) from dominio.categorias_empresa ce
    join dominio.categorias c on c.id = ce.categoria_id
   where c.nombre = 'Cableados' and c.padre_id is not null),
  array['e1000000-0000-0000-0000-000000000002']::uuid[],
  'la subcategoría respeta su propia visibilidad'
);
select throws_ok(
  $$select public.guardar_categoria(null, 'Ajena',
      null, array['e2000000-0000-0000-0000-000000000001']::uuid[])$$,
  '22023', null, 'una empresa de otra organización se rechaza'
);
select throws_ok(
  $$insert into dominio.categorias_empresa (categoria_id, empresa_id, organizacion_id) values
      ((select id from dominio.categorias where nombre = 'Fundas' and padre_id is null),
       'e2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '23503', null, 'la FK compuesta impide asociar una empresa de otra organización'
);

-- ============================================================================
-- Actividad de alta y edición (FR-023)
-- ============================================================================

reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'categoria.creada'),
  4, 'cada alta real deja categoria.creada (no la empresa ajena rechazada)'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'categoria.creada' and detalle = 'Creó la categoría Joysticks'),
  1, 'el detalle de una raíz nombra la categoría'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'categoria.creada' and detalle = 'Creó la subcategoría Joysticks > Cableados'),
  1, 'el detalle de una subcategoría incluye la ruta'

);
select is(
  (select count(*)::int from registro_actividad where tipo = 'categoria.editada'),
  0, 'crear no deja eventos de edición'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_categoria(
      (select id from dominio.categorias where nombre = 'Cableados' and padre_id is not null),
      'Teclados',
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
      array['e1000000-0000-0000-0000-000000000002']::uuid[])$$,
  'administrador: renombra la subcategoría a Teclados'
);
reset role;
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'categoria.editada' and detalle = 'Editó la categoría Joysticks > Teclados'),
  1, 'la edición real deja categoria.editada con la ruta nueva'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$select public.guardar_categoria(
      (select id from dominio.categorias where nombre = 'Teclados' and padre_id is not null),
      'Teclados',
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
      array['e1000000-0000-0000-0000-000000000002']::uuid[])$$,
  'guardar sin cambios reales es válido'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'categoria.editada'),
  1, 'guardar sin cambios reales no duplica el evento'
);

-- ============================================================================
-- Reordenado (FR-019): atómico, con candado por organización y 2 niveles
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.reordenar_categorias(jsonb_build_array(
    jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Fundas' and padre_id is null), 'padre_id', null, 'posicion', 0),
    jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null), 'padre_id', null, 'posicion', 1),
    jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Cableados' and padre_id is null), 'padre_id', null, 'posicion', 2),
    jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Teclados' and padre_id is not null), 'padre_id', (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null), 'posicion', 0)
  )),
  3, 'reordenar persiste solo las filas que cambian'
);
select is(
  (select posicion from dominio.categorias where nombre = 'Fundas' and padre_id is null),
  0, 'la posición nueva queda persistida'
);
select isnt(
  (select posicion from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  0, 'la raíz movida deja de estar en la posición 0'
);
select cmp_ok(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()),
  '>=', 1, 'el reordenado toma el candado asesor por organización (serializa la concurrencia)'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'categoria.reordenada' and detalle = 'Reordenó las categorías (3 cambios)'),
  1, 'el reordenado deja un único evento con la cantidad de cambios'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.reordenar_categorias(jsonb_build_array(
    jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Fundas' and padre_id is null),
      'padre_id', (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null), 'posicion', 1)
  )),
  1, 'mover una raíz sin subcategorías a otra raíz persiste el padre'
);
select is(
  (select padre_id from dominio.categorias where nombre = 'Fundas'),
  (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  'el padre nuevo quedó persistido'
);
select lives_ok(
  $$select public.reordenar_categorias(jsonb_build_array(
      jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Fundas'),
        'padre_id', null, 'posicion', 0)))$$,
  'la raíz puede volver a ser raíz (sin hijos)'
);
select throws_ok(
  $$select public.reordenar_categorias(jsonb_build_array(
      jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
        'padre_id', (select id from dominio.categorias where nombre = 'Cableados' and padre_id is null), 'posicion', 0)))$$,
  '23514', null, 'mover bajo otra una categoría con subcategorías se rechaza'
);
select throws_ok(
  $$select public.reordenar_categorias(jsonb_build_array(
      jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Cableados' and padre_id is null), 'padre_id', null, 'posicion', 0),
      jsonb_build_object('id', (select id from dominio.categorias where nombre = 'Cableados' and padre_id is null), 'padre_id', null, 'posicion', 1)))$$,
  '22023', null, 'un orden con categorías repetidas se rechaza'
);

-- ============================================================================
-- Permisos por sección (FR-024): Consulta lee, Mostrador no accede, anon nada
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from dominio.categorias), 4, 'consulta: lee las categorías de su organización'
);
select throws_ok(
  $$select public.guardar_categoria(null, 'Prohibida', null, '{}'::uuid[])$$,
  '42501', null, 'consulta: no puede guardar categorías'
);
select throws_ok(
  $$select public.reordenar_categorias('[]'::jsonb)$$,
  '42501', null, 'consulta: no puede reordenar'
);
select throws_ok(
  $$select public.eliminar_categoria((select id from dominio.categorias limit 1))$$,
  '42501', null, 'consulta: no puede eliminar'
);
select throws_ok(
  $$insert into dominio.categorias (organizacion_id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Directa')$$,
  '42501', null, 'consulta: no puede insertar por llamada directa'
);
update dominio.categorias set nombre = 'Cambiada' where nombre = 'Fundas';
select is(
  (select count(*)::int from dominio.categorias where nombre = 'Cambiada'),
  0, 'consulta: el UPDATE directo no cambia filas (RLS)'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from dominio.categorias), 0, 'mostrador (sin acceso a Categorías) no ve el árbol'
);
select throws_ok(
  $$select public.guardar_categoria(null, 'Prohibida', null, '{}'::uuid[])$$,
  '42501', null, 'mostrador: la RPC rechaza la falta de acceso'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.guardar_categoria(null, 'Operador', null, '{}'::uuid[])$$,
  'operador: puede crear categorías (edición en Categorías)'
);

-- ============================================================================
-- Aislamiento entre organizaciones
-- ============================================================================

-- Copia el id en una variable de sesión: una subselect bajo RLS ajena devolvería NULL y la RPC
-- interpretaría NULL como alta.
reset role;
select set_config('test.cat_uno',
  (select id::text from dominio.categorias where nombre = 'Fundas' and padre_id is null), false);

select pg_temp.como('c2000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from dominio.categorias), 0, 'otra organización no ve categorías ajenas'
);
select is(
  (select count(*)::int from dominio.categorias_empresa), 0, 'otra organización no ve la visibilidad ajena'
);
select throws_ok(
  $$select public.guardar_categoria(
      current_setting('test.cat_uno')::uuid, 'Fundas', null, '{}'::uuid[])$$,
  'P0002', null, 'la categoría de otra organización se ve como inexistente'
);
select lives_ok(
  $$select public.guardar_categoria(null, 'Solo Dos', null, '{}'::uuid[])$$,
  'la otra organización crea su propia categoría'
);

reset role;
select set_config('test.cat_dos', (select id::text from dominio.categorias where nombre = 'Solo Dos'), false);

-- ============================================================================
-- Asignación de categoría al producto (FR-022) y su evento (FR-023)
-- ============================================================================

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001',
    (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null)),
  (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  'administrador: asigna la categoría raíz al producto'
);
select is(
  (select categoria_ruta from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  'Joysticks', 'la vista expone la ruta de la categoría'
);
select is(
  (select categoria_ids from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  array[(select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null)]::uuid[],
  'la vista expone [categoría, padre] para el filtro de una raíz'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.categoria_asignada'),
  1, 'la asignación real deja producto.categoria_asignada'
);
select is(
  (select detalle from registro_actividad where tipo = 'producto.categoria_asignada'),
  'Asignó la categoría Joysticks al producto Joystick (SKU JOY-1)',
  'el detalle de la asignación nombra la ruta, el producto y el SKU'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001',
    (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null)),
  (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  'repetir la misma categoría es idempotente'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.categoria_asignada'),
  1, 'la asignación repetida no duplica el evento'
);
select is(
  public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001',
    (select id from dominio.categorias where nombre = 'Teclados' and padre_id is not null)),
  (select id from dominio.categorias where nombre = 'Teclados' and padre_id is not null),
  'administrador: asigna una subcategoría'
);
select is(
  (select categoria_ruta from public.v_productos_listado where id = 'a1000000-0000-0000-0000-000000000001'),
  'Joysticks > Teclados', 'la vista arma la ruta «Padre > Hija»'
);
select throws_ok(
  $$select public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001',
      current_setting('test.cat_dos')::uuid)$$,
  'P0002', null, 'asignar una categoría de otra organización se rechaza'
);
select throws_ok(
  $$select public.asignar_categoria_producto('b2000000-0000-0000-0000-000000000001',
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null))$$,
  'P0002', null, 'asignar a un producto de otra organización se rechaza'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select throws_ok(
  $$select public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000001',
      (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null))$$,
  '42501', null, 'consulta: no puede asignar categorías (sin edición en Productos)'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.asignar_categoria_producto('a1000000-0000-0000-0000-000000000002',
    (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null)),
  (select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null),
  'administrador: asigna la raíz al segundo producto'
);
select is(
  (select productos from public.v_categorias_productos
    where categoria_id = (select id from dominio.categorias where nombre = 'Teclados' and padre_id is not null)),
  1, 'v_categorias_productos cuenta los productos asignados a la subcategoría'
);

-- ============================================================================
-- Eliminar (FR-021, SC-005): productos sin categoría y subcategorías a raíz
-- ============================================================================

select lives_ok(
  $$select public.guardar_categoria(null, 'Ropa', null, '{}'::uuid[])$$,
  'administrador: crea Ropa para probar el choque de nombres'
);
select lives_ok(
  $$select public.guardar_categoria(null, 'Fundas',
      (select id from dominio.categorias where nombre = 'Ropa' and padre_id is null), '{}'::uuid[])$$,
  'administrador: crea la subcategoría Fundas bajo Ropa'
);
reset role;
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.categoria_asignada'),
  3, 'las asignaciones reales dejan tres eventos'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.eliminar_categoria((select id from dominio.categorias where nombre = 'Ropa' and padre_id is null))$$,
  '23505', null, 'eliminar se rechaza si una subcategoría choca con una raíz del mismo nombre'
);
reset role;
select is(
  (select count(*)::int from dominio.categorias where nombre = 'Ropa'), 1, 'el rechazo no eliminó nada'
);

select pg_temp.como('c1000000-0000-0000-0000-000000000001');
select is(
  public.eliminar_categoria((select id from dominio.categorias where nombre = 'Joysticks' and padre_id is null)),
  '{"productos": 1, "subcategorias": 1}'::jsonb, 'eliminar devuelve los productos y subcategorías afectados'
);
reset role;
select is(
  (select categoria_id from dominio.productos where id = 'a1000000-0000-0000-0000-000000000002'),
  null, 'el producto de la categoría eliminada queda sin categoría'
);
select is(
  (select categoria_id from dominio.productos where id = 'a1000000-0000-0000-0000-000000000001'),
  (select id from dominio.categorias where nombre = 'Teclados'),
  'el producto de la subcategoría conserva su categoría (que ahora es raíz)'
);
select is(
  (select padre_id from dominio.categorias where nombre = 'Teclados'),
  null, 'la subcategoría subió a raíz'
);
select is(
  (select count(*)::int from dominio.categorias
    where nombre = 'Joysticks' and padre_id is null),
  0, 'la categoría eliminada ya no existe'
);
select is(
  (select count(*)::int from registro_actividad
    where tipo = 'categoria.eliminada'
      and detalle = 'Eliminó la categoría Joysticks: 1 producto quedó sin categoría; 1 subcategoría subió a raíz'),
  1, 'la eliminación deja un evento con el detalle del prototipo'
);
select is(
  (select count(*)::int from registro_actividad where tipo = 'producto.categoria_asignada'),
  3, 'el null en cascada de los productos no agrega eventos de asignación'
);
select throws_ok(
  $$select public.eliminar_categoria('a9000000-0000-0000-0000-000000000009')$$,
  'P0002', null, 'eliminar una categoría inexistente devuelve P0002'
);

select * from finish();
rollback;
