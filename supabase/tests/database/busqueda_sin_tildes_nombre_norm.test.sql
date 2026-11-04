-- MSF-722: columnas calculadas `nombre_norm` (migración 20270203120000). Cubre que existan para las tres
-- relaciones que PostgREST filtra (public.v_productos_listado, public.stock_estados, dominio.productos),
-- que normalicen tildes y mayúsculas, que `authenticated` pueda ejecutarlas y que `anon` no.
begin;

select plan(10);

select has_function('public', 'nombre_norm', array['v_productos_listado'], 'public.nombre_norm(v_productos_listado)');
select has_function('public', 'nombre_norm', array['stock_estados'], 'public.nombre_norm(stock_estados)');
select has_function('dominio', 'nombre_norm', array['productos'], 'dominio.nombre_norm(productos)');

select is(private.normalizar_busqueda('Cámara'), private.normalizar_busqueda('camara'),
  'la normalización ignora tildes y mayúsculas');

select ok(has_function_privilege('authenticated', 'public.nombre_norm(public.v_productos_listado)', 'execute'), 'authenticated ejecuta nombre_norm de v_productos_listado');
select ok(has_function_privilege('authenticated', 'public.nombre_norm(public.stock_estados)', 'execute'), 'authenticated ejecuta nombre_norm de stock_estados');
select ok(has_function_privilege('authenticated', 'dominio.nombre_norm(dominio.productos)', 'execute'), 'authenticated ejecuta nombre_norm de dominio.productos');

select ok(not has_function_privilege('anon', 'public.nombre_norm(public.v_productos_listado)', 'execute'), 'anon no ejecuta nombre_norm de v_productos_listado');
select ok(not has_function_privilege('anon', 'public.nombre_norm(public.stock_estados)', 'execute'), 'anon no ejecuta nombre_norm de stock_estados');
select ok(not has_function_privilege('anon', 'dominio.nombre_norm(dominio.productos)', 'execute'), 'anon no ejecuta nombre_norm de dominio.productos');

select * from finish();
rollback;
