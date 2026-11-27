-- Lote 95 (MSF-979; migración 20270513000100): comportamiento REAL de las políticas del bucket newsletter-imagenes (SELECT, INSERT, UPDATE y DELETE).
-- El DELETE se ejerce como `authenticated` con el opt-in de Storage (`storage.allow_delete_query`, lo que hace su API). Objetos reales y rol del CI.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-uno@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'lector@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda Dos', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'nlimg-a.ejemplo.com');
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'consulta');
insert into usuario_empresa_activa (user_id, empresa_id) values ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001');
insert into dominio.precios_empresa (empresa_id, organizacion_id, base, ajuste_pct, mostrar_con_iva) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'central', 0, false);
insert into dominio.cotizacion_inicial (organizacion_id, valor) values ('11111111-1111-1111-1111-111111111111', 1500);

-- Tres productos destacados: 1 con dos imágenes, 2 sin imágenes, 3 con una imagen.
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo)
select ('a1000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'Producto ' || n, 'NLI-' || n, '{}', 1000 * n, 'ARS', true
  from generate_series(1, 3) n;
insert into dominio.productos (id, organizacion_id, nombre, sku, compatible_con, precio_lista, moneda, activo) values
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ajeno', 'NLI-X', '{}', 500, 'ARS', true);
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select p.id, 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.productos_tienda (empresa_id, producto_id, organizacion_id, visible, destacado)
select 'e1000000-0000-0000-0000-000000000001', p.id, '11111111-1111-1111-1111-111111111111', true, true
  from dominio.productos p where p.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.producto_imagenes (id, producto_id, organizacion_id, posicion, ruta) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/frente.png'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000001/lateral.png'),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1,
   '11111111-1111-1111-1111-111111111111/a1000000-0000-0000-0000-000000000003/frente.webp');

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

update public.banderas_plataforma set activa = true where clave in ('newsletter', 'promociones_precio');
-- La API que atiende las llamadas (cabecera que pone el proxy): la dirección pública de la imagen debe ser de este host.
select set_config('request.headers', '{"host":"p.supabase.co"}', true);

-- Cuenta las copias registradas aunque la sesión sea de authenticated (la tabla interna no es legible por la API).
create function pg_temp.n_copias() returns integer language sql security definer as $$ select count(*)::int from private.newsletter_imagenes $$;

-- === PROPUESTA QA: comportamiento REAL de las políticas del bucket (DELETE con el GUC de Storage, UPDATE, INSERT, SELECT) ===
reset role;
-- Operador con edición en Contactos y acceso a la tienda, pero que NO es Administrador.
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda inactiva', false);
insert into storage.buckets (id, name, public) values ('otro-bucket', 'otro-bucket', false);
insert into storage.objects (bucket_id, name) values
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'),
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003.webp'),
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'),
  ('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.webp'),
  ('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'),
  ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/sub/a1000000-0000-0000-0000-000000000003.webp'),
  ('otro-bucket', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002.webp');
create function pg_temp.intentar(p_sql text) returns text language plpgsql as $$
declare v_n bigint;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  execute p_sql;
  get diagnostics v_n = row_count;
  return 'filas:' || v_n;
exception when others then
  return 'error:' || sqlstate;
end $$;
create function pg_temp.borrar(p_bucket text, p_nombre text) returns text language sql as $$
  select pg_temp.intentar(format($q$delete from storage.objects where bucket_id = %L and name = %L$q$, p_bucket, p_nombre)) $$;
create function pg_temp.n_visibles() returns integer language sql as $$ select count(*)::int from storage.objects where bucket_id = 'newsletter-imagenes' $$;
-- SELECT
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.n_visibles(), 4, 'SELECT: el Administrador ve solo las copias de la carpeta de su organización (4 de 6)');
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is(pg_temp.n_visibles(), 2, 'SELECT: el admin de la otra organización ve solo las suyas (2)');
select is((select count(*)::int from storage.objects where bucket_id = 'otro-bucket'), 0, 'SELECT: no ve otros buckets');
-- DELETE
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is(pg_temp.borrar('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'), 'filas:0', 'DELETE: consulta no borra');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(pg_temp.borrar('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'), 'filas:0', 'DELETE: un operador con edición y acceso a la tienda, pero sin ser Administrador, no borra');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is(pg_temp.borrar('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e2000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.webp'), 'filas:0', 'DELETE: no borra la copia de otra organización');
select is(pg_temp.borrar('newsletter-imagenes', '22222222-2222-2222-2222-222222222222/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'), 'filas:0', 'DELETE: no borra bajo la carpeta de otra organización aunque la tienda sea propia');
select is(pg_temp.borrar('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003.webp'), 'filas:0', 'DELETE: no borra la de una tienda no accesible');
select is(pg_temp.borrar('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/sub/a1000000-0000-0000-0000-000000000003.webp'), 'filas:0', 'DELETE: no borra una ruta con subcarpeta');
select is(pg_temp.borrar('otro-bucket', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002.webp'), 'filas:0', 'DELETE: la política no alcanza a otros buckets con una ruta parecida');
-- UPDATE
select is(pg_temp.intentar($$update storage.objects set name = name where bucket_id = 'newsletter-imagenes' and name like '22222222%'$$), 'filas:0', 'UPDATE: no toca copias de otra organización');
select is(pg_temp.intentar($$update storage.objects set bucket_id = 'newsletter-imagenes', name = '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000002.webp' where bucket_id = 'otro-bucket'$$), 'filas:0', 'UPDATE: no mueve objetos de otro bucket al bucket público');
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select is(pg_temp.intentar($$update storage.objects set name = name where bucket_id = 'newsletter-imagenes' and name like '11111111%'$$), 'filas:0', 'UPDATE: un operador no Administrador no actualiza');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000004.webp', 'd1000000-0000-0000-0000-000000000003')$$, '42501', null, 'INSERT: un operador con edición y acceso a la tienda, sin ser Administrador, no sube');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
-- el camino feliz
select is(pg_temp.borrar('newsletter-imagenes', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.webp'), 'filas:1', 'DELETE: el Administrador borra la copia de su tienda');
select is(pg_temp.n_visibles(), 3, 'y quedan las otras 3 de su carpeta');
select * from finish();
rollback;
