-- F-PRV-04 (MSF-383, épica MSF-219): base de las tablas del ingreso de mercadería.
-- Verifica esquema, RLS, privilegios y siembra del motivo de anulación.
begin;

select plan(9);

insert into organizaciones (id, nombre) values
  ('33333333-3333-3333-3333-333333333333', 'Organización Nueva');

insert into auth.users (id, email) values
  ('d3000000-0000-0000-0000-000000000001', 'admin-nueva@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'administrador');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tienda Nueva', true);

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('f3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Proveedor Nuevo', '30700000040', true);

select isnt(to_regclass('dominio.ingresos_mercaderia'), null, 'la cabecera vive en dominio');
select isnt(to_regclass('dominio.ingresos_mercaderia_lineas'), null, 'las líneas viven en dominio');

select is((select relrowsecurity from pg_class where oid = 'dominio.ingresos_mercaderia'::regclass), true, 'la cabecera tiene RLS');
select is((select relrowsecurity from pg_class where oid = 'dominio.ingresos_mercaderia_lineas'::regclass), true, 'las líneas tienen RLS');

select is(has_table_privilege('authenticated', 'dominio.ingresos_mercaderia', 'select'), true, 'authenticated puede leer la cabecera');
select is(has_table_privilege('authenticated', 'dominio.ingresos_mercaderia', 'insert'), false, 'authenticated no puede insertar la cabecera directo');
select is(has_table_privilege('anon', 'dominio.ingresos_mercaderia', 'select'), false, 'anon no puede leer la cabecera');

select is(
  (select count(*)::int from dominio.motivos_movimiento where organizacion_id = '33333333-3333-3333-3333-333333333333'),
  7, 'una organización nueva nace con los 7 motivos (incluye anulación y toma de inventario)'
);
select is(
  (select count(*)::int from dominio.motivos_movimiento
    where organizacion_id = '33333333-3333-3333-3333-333333333333'
      and lower(btrim(nombre)) = 'anulación de ingreso de mercadería'
      and 'salida' = any (aplica_a)),
  1, 'el motivo de anulación aplica a salida'
);

select * from finish();
rollback;
