-- MSF-847/MSF-848: prueba real con una reparación creada dentro de la transacción.
-- Con reparación referenciada, bajar la empresa da el error de negocio P0001 (no un 23503 en el COMMIT);
-- sin referencias la baja de la empresa y de la organización se completa.
begin;

select plan(4);

insert into public.organizaciones (id, nombre) values ('00000000-0000-0000-0000-0000000085a1', 'Baja real con reparación');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('00000000-0000-0000-0000-0000000085a2', '00000000-0000-0000-0000-0000000085a1', 'Empresa con reparación', true),
  ('00000000-0000-0000-0000-0000000085a3', '00000000-0000-0000-0000-0000000085a1', 'Empresa sin reparación', true);
insert into public.clientes (id, organizacion_id, nombre, tipo)
  values ('00000000-0000-0000-0000-0000000085a4', '00000000-0000-0000-0000-0000000085a1', 'Cliente', 'minorista');
insert into dominio.modelos_equipo (id, organizacion_id, equipo, modelo)
  values ('00000000-0000-0000-0000-0000000085a5', '00000000-0000-0000-0000-0000000085a1', 'Celular', 'X1');
insert into dominio.estados_reparacion (id, organizacion_id, nombre, orden)
  values ('00000000-0000-0000-0000-0000000085a6', '00000000-0000-0000-0000-0000000085a1', 'Ingresada', 1);
insert into dominio.reparaciones (id, organizacion_id, empresa_id, numero, cliente_id, modelo_id, estado_id, ingreso_en)
  values ('00000000-0000-0000-0000-0000000085a7', '00000000-0000-0000-0000-0000000085a1',
          '00000000-0000-0000-0000-0000000085a2', 1, '00000000-0000-0000-0000-0000000085a4',
          '00000000-0000-0000-0000-0000000085a5', '00000000-0000-0000-0000-0000000085a6', current_date);

select throws_ok(
  $t$do $b$ begin
      delete from dominio.empresas where id = '00000000-0000-0000-0000-0000000085a2';
      perform private.confirmar_claves_diferidas();
    end $b$$t$,
  'P0001', 'No se puede borrar: el registro está en uso por otros datos.',
  'empresa con reparación: error de negocio P0001, no 23503 en el COMMIT');

select lives_ok(
  $t$do $b$ begin
      delete from dominio.empresas where id = '00000000-0000-0000-0000-0000000085a3';
      perform private.confirmar_claves_diferidas();
    end $b$$t$,
  'empresa sin reparaciones: la baja se completa');

select lives_ok(
  $t$delete from public.organizaciones where id = '00000000-0000-0000-0000-0000000085a1'$t$,
  'la baja de la organización con reparaciones se completa (la cascada las borra)');

select is(
  (select count(*)::int from dominio.reparaciones where id = '00000000-0000-0000-0000-0000000085a7'),
  0, 'la reparación se borró con la organización');

select * from finish();
rollback;
