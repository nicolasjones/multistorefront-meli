-- F-STK-10 (MSF-407, épica MSF-131, FR-004, FR-008, SC-002): numeración e idempotencia del lote.
-- Un solo backend de pgTAP no puede simular dos transacciones simultáneas, así que acá se prueba el
-- contrato observable (números distintos y consecutivos; misma clave → un solo lote) y que la RPC
-- serializa por organización con un bloqueo de transacción tomado ANTES de leer la clave y el
-- máximo: es lo que hace que, con dos sesiones reales, la segunda espere y vea el lote de la primera.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000002', 'operador@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Producto 1', 'P-1', 10);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select ok(
  (select position('pg_advisory_xact_lock' in p.prosrc) > 0
      and position('pg_advisory_xact_lock' in p.prosrc) < position('clave_idempotencia = v_clave' in p.prosrc)
      and position('clave_idempotencia = v_clave' in p.prosrc) < position('max(l.numero)' in p.prosrc)
     from pg_proc p where p.oid = 'public.registrar_lote_stock(jsonb,uuid,text,date,uuid)'::regprocedure),
  'el bloqueo por organización se toma antes de leer la clave y de calcular el número'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select is(
  (public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
     (select id from ids where nombre = 'Compra a proveedor'), null, current_date,
     'c1000000-0000-0000-0000-000000000001') -> 'lote' ->> 'numero')::int,
  1, 'primer lote: número 1'
);
select is(
  (public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
     (select id from ids where nombre = 'Compra a proveedor'), null, current_date,
     'c1000000-0000-0000-0000-000000000002') -> 'lote' ->> 'numero')::int,
  2, 'segundo lote con otra clave: número 2, consecutivo'
);
select is(
  (public.registrar_lote_stock('[{"producto":"a1000000-0000-0000-0000-000000000001","cantidad":1}]'::jsonb,
     (select id from ids where nombre = 'Compra a proveedor'), null, current_date,
     'c1000000-0000-0000-0000-000000000002') -> 'lote' ->> 'numero')::int,
  2, 'el mismo envío con la misma clave devuelve el lote 2'
);

reset role;

select is((select count(*)::int from dominio.lotes_stock), 2, 'hay dos lotes: la clave repetida no creó un tercero');
select is(
  (select array_agg(numero order by numero) from dominio.lotes_stock),
  array[1, 2], 'números distintos y consecutivos, sin huecos'
);
select is(
  (select e.cantidad from dominio.existencias e where e.producto_id = 'a1000000-0000-0000-0000-000000000001'),
  2, 'el stock subió dos veces (una por lote), no tres'
);

select * from finish();

rollback;
