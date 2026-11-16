-- MSF-847/MSF-848: la baja de una organización con reparaciones completa; el 23503 diferido se traduce a error de negocio.
begin;

select plan(4);

select is(
  (select condeferred and condeferrable from pg_constraint
    where conrelid = 'dominio.reparaciones'::regclass and contype = 'f'
      and confrelid = 'dominio.empresas'::regclass),
  true, 'reparaciones → empresas es diferible y diferida');

insert into public.organizaciones (id, nombre) values ('00000000-0000-0000-0000-0000000084a1', 'Baja con reparaciones');
insert into dominio.empresas (id, organizacion_id, nombre, activa)
  values ('00000000-0000-0000-0000-0000000084a2', '00000000-0000-0000-0000-0000000084a1', 'Empresa', true);
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit)
  values ('00000000-0000-0000-0000-0000000084a3', '00000000-0000-0000-0000-0000000084a1', 'Proveedor', '20123456786');
insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista, proveedor_id)
  values ('00000000-0000-0000-0000-0000000084a4', '00000000-0000-0000-0000-0000000084a1', 'Producto', 'ARS', 10,
          '00000000-0000-0000-0000-0000000084a3');

-- MSF-848: borrar un proveedor usado se traduce a un error de negocio explícito (P0001), no a un 23503 en el COMMIT.
select throws_ok(
  $t$do $b$ begin
      delete from dominio.proveedores where id = '00000000-0000-0000-0000-0000000084a3';
      perform private.confirmar_claves_diferidas();
    end $b$$t$,
  'P0001', 'No se puede borrar: el registro está en uso por otros datos.',
  'el 23503 diferido se traduce a un error de negocio');

select lives_ok(
  $t$do $b$ begin
      delete from dominio.productos where id = '00000000-0000-0000-0000-0000000084a4';
      delete from dominio.proveedores where id = '00000000-0000-0000-0000-0000000084a3';
      perform private.confirmar_claves_diferidas();
    end $b$$t$,
  'sin referencias, la confirmación no falla');

select lives_ok(
  $t$delete from public.organizaciones where id = '00000000-0000-0000-0000-0000000084a1'$t$,
  'la baja de una organización con empresa se completa');

select * from finish();
rollback;
