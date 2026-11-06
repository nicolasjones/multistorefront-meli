-- MSF-748 (bug): `dominio.comprobantes_venta.contacto_id` debe ser legible por `authenticated` (privilegio por
-- columna desde 20270112140500) y no por `anon`; `origen_tipo`/`origen_id` siguen sin conceder a propósito.
begin;

select plan(4);

select ok(
  has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'contacto_id', 'SELECT'),
  'authenticated puede leer comprobantes_venta.contacto_id'
);
select ok(
  not has_column_privilege('anon', 'dominio.comprobantes_venta', 'contacto_id', 'SELECT'),
  'anon no puede leer comprobantes_venta.contacto_id'
);
select ok(
  not has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'contacto_id', 'INSERT')
  and not has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'contacto_id', 'UPDATE'),
  'authenticated no escribe contacto_id directamente'
);
select ok(
  not has_column_privilege('authenticated', 'dominio.comprobantes_venta', 'origen_id', 'SELECT'),
  'origen_id sigue sin concederse'
);

select * from finish();
rollback;
