-- MSF-176 · cierre (MSF-988): hallazgos de la revisión de seguridad integral (T070) sobre las definiciones vigentes de `dokploy`.
--   H-2  El vínculo de un presupuesto de la tienda sobrevive a la baja de la cuenta (FK `on delete set null`), y `fusionar_clientes` repunta
--        `presupuestos_tienda.cliente_id` y `consultas.cliente_id` al cliente conservado. Al dar de baja la cuenta web que no se elige, los
--        presupuestos del cliente perdedor pasan a la cuenta que sobrevive (se prueba en los dos casos del diálogo).
--   H-3  Cupo de llamadas por cuenta (120 por minuto; acá se baja a 3) en las cinco RPC de «Mi cuenta», antes del cálculo y sobreviviendo a un error.
--   H-4  Ya estaba corregido en `20270430000000`: el cupo de la lista de pedido y del envío (B1) sobrevive a una excepción; se vuelve a probar.
--   H-6  U+00AD, U+180E y U+2061 a U+2064 (además de lo anterior) se rechazan en las notas y los nombres de B1 y B2.
begin;

select plan(69);

-- ============================================================================
-- Fixture
-- ============================================================================
insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'conservado@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'descartado@example.com'),
  ('f5000000-0000-0000-0000-000000000003', 'suelto@example.com'),
  ('f5000000-0000-0000-0000-000000000004', 'cupo@example.com'),
  ('f5000000-0000-0000-0000-000000000005', 'sin-cuenta@example.com'),
  ('f5000000-0000-0000-0000-000000000007', 'panel@example.com'),
  ('f5000000-0000-0000-0000-000000000008', 'conservado-2@example.com'),
  ('f5000000-0000-0000-0000-000000000009', 'descartado-2@example.com'),
  ('f5000000-0000-0000-0000-000000000010', 'chave-1@example.com'),
  ('f5000000-0000-0000-0000-000000000011', 'chave-2@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Cierre', true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e5000000-0000-0000-0000-000000000001', 'cierre-a.ejemplo.com');
-- El depósito por defecto de la organización (lo siembra el alta) tiene que vender en la tienda.
insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select d.id, 'e5000000-0000-0000-0000-000000000001', d.organizacion_id
  from dominio.depositos d
 where d.por_defecto and d.organizacion_id = '11111111-1111-1111-1111-111111111111';
insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Con IVA');
insert into dominio.alicuotas_iva (id, organizacion_id, nombre, porcentaje, exento) values
  ('a5000000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'IVA 21 % de prueba', 21, false);
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, categoria_id, alicuota_iva_id) values
  ('a5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alfa', 'CI-1', 1000, 'ARS', true, 'c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-0000000000a5'),
  ('a5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Beta', 'CI-2', 2000, 'ARS', true, 'c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-0000000000a5');
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
select id, 'e5000000-0000-0000-0000-000000000001', organizacion_id from dominio.productos where organizacion_id = '11111111-1111-1111-1111-111111111111';
-- El trigger `productos_crear_existencias` ya deja una fila por producto (cantidad 0): se sube la cantidad sin duplicar la clave primaria.
insert into dominio.existencias (producto_id, organizacion_id, cantidad)
select id, organizacion_id, 7 from dominio.productos where organizacion_id = '11111111-1111-1111-1111-111111111111'
on conflict (producto_id) do update set cantidad = excluded.cantidad;
insert into dominio.clientes (id, organizacion_id, numero, nombre, correo, tipo) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 710, 'Conservado', 'co@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 711, 'Descartado', 'de@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 712, 'Suelto', 'su@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 713, 'Cupo', 'cu@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 714, 'Conservado dos', 'co2@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 715, 'Descartado dos', 'de2@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 716, 'Clave uno', 'c1@example.com', 'minorista'),
  ('c5000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 717, 'Clave dos', 'c2@example.com', 'minorista');
insert into clientes_empresas (cliente_id, empresa_id, organizacion_id)
select id, 'e5000000-0000-0000-0000-000000000001', organizacion_id from dominio.clientes where id::text like 'c5000000%';
insert into cuentas_cliente (id, organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values
  ('ca500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'activa'),
  ('ca500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000002', 'activa'),
  ('ca500000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000003', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000003', 'activa'),
  ('ca500000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000004', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000004', 'activa'),
  ('ca500000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000005', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000008', 'activa'),
  ('ca500000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000006', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000009', 'activa'),
  ('ca500000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000007', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000010', 'activa'),
  ('ca500000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'c5000000-0000-0000-0000-000000000008', 'e5000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000011', 'activa');
update public.banderas_plataforma set activa = true where clave = 'tienda_pedidos';

create function pg_temp.como(p_user uuid, p_ip text default '10.9.0.1') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  set local role authenticated;
end $$;
create function pg_temp.anonimo(p_ip text default '10.9.0.2') returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  set local role anon;
end $$;
create temp table res (k text primary key, v jsonb);
grant all on res to public;
create function pg_temp.items(variadic p text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('producto_id', t[1], 'cantidad', t[2]::int))
    from (select array[p[i], p[i + 1]] as t from generate_series(1, array_length(p, 1), 2) i) x
$$;
grant execute on function pg_temp.items(text[]) to public;
create function pg_temp.fila(p_clave text) returns jsonb language sql as $$ select v from res where k = p_clave $$;

-- ============================================================================
-- H-2: la baja de la cuenta no borra el vínculo del presupuesto
-- ============================================================================
select is((select is_nullable from information_schema.columns where table_schema = 'dominio' and table_name = 'presupuestos_tienda' and column_name = 'cuenta_cliente_id'), 'YES',
  'H-2: presupuestos_tienda.cuenta_cliente_id admite nulo');
select is((select pg_get_constraintdef(c.oid) like '%ON DELETE SET NULL (cuenta_cliente_id)%' from pg_constraint c where c.conname = 'presupuestos_tienda_cuenta_fk'), true,
  'H-2: la FK de la cuenta es on delete set null (cuenta_cliente_id), no cascade');

select pg_temp.como('f5000000-0000-0000-0000-000000000003', '10.1.0.1');   -- el cliente «suelto»
insert into res values ('pres_suelto', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), 'Nota del suelto', 'c0000000-0000-0000-0000-000000000501'));
select pg_temp.como('f5000000-0000-0000-0000-000000000002', '10.1.0.2');   -- el cliente a descartar (también hace una consulta de pedido)
insert into res values ('pres_descartado', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000002', '1'), 'Nota del descartado', 'c0000000-0000-0000-0000-000000000502'));
insert into res values ('pedido_descartado', publico.enviar_lista_pedido('cierre-a.ejemplo.com', null, null, null, pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), 'c0000000-0000-0000-0000-000000000503'));
-- Segundo caso de fusión (el que ofrece el diálogo: se conserva la cuenta web del DESCARTADO): los dos clientes tienen su presupuesto.
select pg_temp.como('f5000000-0000-0000-0000-000000000008', '10.1.0.4');   -- el cliente conservado dos
insert into res values ('pres_conservado_2', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), 'Nota del conservado dos', 'c0000000-0000-0000-0000-000000000504'));
select pg_temp.como('f5000000-0000-0000-0000-000000000009', '10.1.0.5');   -- el cliente descartado dos
insert into res values ('pres_descartado_2', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000002', '1'), 'Nota del descartado dos', 'c0000000-0000-0000-0000-000000000505'));
reset role;
select is(pg_temp.fila('pres_suelto') ->> 'estado', 'ok', 'H-2: el cliente suelto pidió un presupuesto');
select is(pg_temp.fila('pres_descartado') ->> 'estado', 'ok', 'H-2: el cliente a descartar pidió un presupuesto');
select is(pg_temp.fila('pedido_descartado') ->> 'estado', 'ok', 'H-2: el cliente a descartar mandó una lista de pedido (con su cliente_id)');
select is((select count(*)::int from dominio.consultas where cliente_id = 'c5000000-0000-0000-0000-000000000002'), 1, 'H-2: la consulta de pedido quedó con el cliente descartado');

-- Baja de la cuenta del cliente suelto (por ejemplo, al borrar su usuario de Auth).
delete from public.cuentas_cliente where id = 'ca500000-0000-0000-0000-000000000003';
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501'), 1, 'H-2: tras borrar la cuenta el VÍNCULO del presupuesto sigue existiendo');
select is((select cuenta_cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501'), null::uuid, 'H-2: sin cuenta (la columna quedó nula)');
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501'), 'Nota del suelto', 'H-2: y conserva la nota del cliente');
select is((select cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501'), 'c5000000-0000-0000-0000-000000000003'::uuid, 'H-2: y su cliente');
select pg_temp.como('f5000000-0000-0000-0000-000000000007', '10.1.0.3');
select is((select l.operador from public.listar_presupuestos(null, null, null, 1, 200) l
            where l.id = (select comprobante_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501')), 'Tienda online (cliente)',
  'H-2: el rótulo «Tienda online (cliente)» persiste aunque la cuenta ya no exista');
select is((select public.obtener_comprobante((select comprobante_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000501')) ->> 'de_tienda'), 'true',
  'H-2: la ficha sigue marcándolo de la tienda');

-- Fusión: el conservado gana la cuenta web (la del descartado se da de baja con un delete: antes se llevaba el vínculo por cascade).
select lives_ok($$select public.fusionar_clientes('c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001')$$,
  'H-2: el administrador fusiona al descartado en el conservado');
reset role;
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000502'), 1, 'H-2: la fusión NO borra el vínculo del presupuesto del descartado (cuenta dada de baja)');
select is((select cuenta_cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000502'), 'ca500000-0000-0000-0000-000000000001'::uuid,
  'H-2: ese vínculo pasa a la cuenta web que sobrevive (si quedara sin cuenta, saldría de los topes por cuenta y de la idempotencia (cuenta, clave))');
select is((select cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000502'), 'c5000000-0000-0000-0000-000000000001'::uuid, 'H-2: la fusión repunta presupuestos_tienda.cliente_id al conservado');
select is((select c.cliente_id from dominio.comprobantes_venta c join dominio.presupuestos_tienda pt on pt.comprobante_id = c.id where pt.clave_envio = 'c0000000-0000-0000-0000-000000000502'), 'c5000000-0000-0000-0000-000000000001'::uuid,
  'H-2: y el comprobante también es del conservado (como ya hacía la fusión)');
select is((select count(*)::int from dominio.consultas where cliente_id = 'c5000000-0000-0000-0000-000000000002'), 0, 'H-2: ninguna consulta queda con el cliente descartado');
select is((select count(*)::int from dominio.consultas where cliente_id = 'c5000000-0000-0000-0000-000000000001' and origen = 'pedido'), 1, 'H-2: la consulta de pedido pasó al conservado');
select is((select nota from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000502'), 'Nota del descartado', 'H-2: la nota del presupuesto del descartado se conserva');
select is((select count(*)::int from dominio.presupuestos_tienda where cliente_id = 'c5000000-0000-0000-0000-000000000002'), 0, 'H-2: ningún vínculo apunta al cliente archivado');

-- Segundo caso de fusión: se conserva la cuenta web del DESCARTADO (la del conservado se da de baja con un delete).
select lives_ok($$select public.fusionar_clientes('c5000000-0000-0000-0000-000000000005', 'c5000000-0000-0000-0000-000000000006', 'c5000000-0000-0000-0000-000000000006')$$,
  'H-2: la fusión también se puede hacer conservando la cuenta web del descartado');
reset role;
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000504'), 1, 'H-2: el presupuesto del conservado NO se borra (su cuenta web se dio de baja)');
select is((select cuenta_cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000504'), 'ca500000-0000-0000-0000-000000000006'::uuid,
  'H-2: y su vínculo pasa a la cuenta que sobrevive (no queda sin cuenta)');
select is((select cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000504'), 'c5000000-0000-0000-0000-000000000005'::uuid,
  'H-2: y su cliente es el conservado');
select is((select cuenta_cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000505'), 'ca500000-0000-0000-0000-000000000006'::uuid,
  'H-2: el presupuesto del descartado queda en la misma cuenta que sobrevive');
select is((select cliente_id from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000505'), 'c5000000-0000-0000-0000-000000000005'::uuid,
  'H-2: y con el cliente conservado');
select is((select count(*)::int from dominio.presupuestos_tienda where cuenta_cliente_id = 'ca500000-0000-0000-0000-000000000006'), 2,
  'H-2: la cuenta que sobrevive NO arranca en cero: los dos presupuestos cuentan para sus topes (5 por día y 10 abiertos)');
select is((select cliente_id from public.cuentas_cliente where id = 'ca500000-0000-0000-0000-000000000006'), 'c5000000-0000-0000-0000-000000000005'::uuid,
  'H-2: y la cuenta que sobrevive ya es del cliente conservado');

-- Tercera fusión: dos cuentas de la MISMA empresa con la MISMA `clave_envio`. Es posible porque la unicidad de
-- `dominio.tienda_envios (empresa_id, clave_envio)` solo protege 24 h (la poda borra esas filas): al re-apuntar el vínculo
-- del cliente perdedor a la cuenta que sobrevive, la unicidad `(cuenta_cliente_id, clave_envio)` (la idempotencia de B2)
-- choca y el `update` abortaba con «duplicate key»: el administrador no podía fusionar ese par de clientes.
select pg_temp.como('f5000000-0000-0000-0000-000000000010', '10.1.0.6');   -- el cliente «clave uno»
insert into res values ('pres_clave_1', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), 'Nota del cliente uno', 'c0000000-0000-0000-0000-000000000601'));
reset role;
-- La poda de lo vencido (más de 24 h) borra el envío: la misma clave vuelve a estar libre para otra cuenta de la empresa.
delete from dominio.tienda_envios where empresa_id = 'e5000000-0000-0000-0000-000000000001' and clave_envio = 'c0000000-0000-0000-0000-000000000601';
select pg_temp.como('f5000000-0000-0000-0000-000000000011', '10.1.0.7');   -- el cliente «clave dos»
insert into res values ('pres_clave_2', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000002', '1'), 'Nota del cliente dos', 'c0000000-0000-0000-0000-000000000601'));
reset role;
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000601'), 2,
  'H-2: dos cuentas distintas de la misma empresa tienen presupuestos con la misma clave (la poda de 24 h liberó la clave)');
select pg_temp.como('f5000000-0000-0000-0000-000000000007', '10.1.0.3');   -- el administrador
select lives_ok($$select public.fusionar_clientes('c5000000-0000-0000-0000-000000000007', 'c5000000-0000-0000-0000-000000000008', 'c5000000-0000-0000-0000-000000000007')$$,
  'H-2: la fusión NO falla por «duplicate key» cuando las dos cuentas tienen la misma clave de envío');
reset role;
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000601' and cuenta_cliente_id = 'ca500000-0000-0000-0000-000000000007'), 1,
  'H-2: el presupuesto de la cuenta que sobrevive sigue con su cuenta');
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000601'), 2,
  'H-2: los dos vínculos siguen existiendo (no se borra ninguno)');
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000601' and cuenta_cliente_id is null), 1,
  'H-2: el que chocaba NO se re-apunta: queda sin cuenta al bajar la cuenta que lo tenía (el vínculo no se pierde)');
select is((select count(*)::int from dominio.presupuestos_tienda where clave_envio = 'c0000000-0000-0000-0000-000000000601' and cliente_id = 'c5000000-0000-0000-0000-000000000007'), 2,
  'H-2: y los dos quedan con el cliente conservado');

-- ============================================================================
-- H-3: cupo de llamadas por cuenta en las cinco RPC de «Mi cuenta»
-- ============================================================================
-- Se baja el cupo a 3 por minuto SOLO en esta transacción (el valor real es 120).
select is(private.limite_llamadas_cuenta_por_minuto(), 120, 'H-3: el cupo real es de 120 llamadas por minuto y cuenta');
create or replace function private.limite_llamadas_cuenta_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
delete from public.limite_pedidos_publicos;

select is((select count(*)::int from pg_proc p where p.pronamespace = 'publico'::regnamespace
            and p.proname in ('cambiar_favorito_por_dominio', 'mis_favoritos_por_dominio', 'favoritos_entre_por_dominio', 'mis_compras_por_dominio', 'mi_compra_por_dominio')
            and p.provolatile = 'v' and p.prosecdef), 5, 'H-3: las cinco RPC son volatile (escriben el contador) y security definer');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'publico'::regnamespace
            and p.proname in ('cambiar_favorito_por_dominio', 'mis_favoritos_por_dominio', 'favoritos_entre_por_dominio', 'mis_compras_por_dominio', 'mi_compra_por_dominio')
            and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 0, 'H-3: siguen solo para authenticated (anon sin execute)');

select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.1');   -- la cuenta «cupo»
insert into res select 'fav_' || n, publico.cambiar_favorito_por_dominio('cierre-a.ejemplo.com', 'a5000000-0000-0000-0000-000000000001', true) from generate_series(1, 4) n;
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.1');
insert into res select 'misfav_' || n, publico.mis_favoritos_por_dominio('cierre-a.ejemplo.com') from generate_series(1, 4) n;
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.1');
insert into res select 'entre_' || n, publico.favoritos_entre_por_dominio('cierre-a.ejemplo.com', array['a5000000-0000-0000-0000-000000000001']::uuid[]) from generate_series(1, 4) n;
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.1');
insert into res select 'compras_' || n, publico.mis_compras_por_dominio('cierre-a.ejemplo.com') from generate_series(1, 4) n;
reset role;
delete from public.limite_pedidos_publicos;
select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.1');
insert into res select 'compra_' || n, publico.mi_compra_por_dominio('cierre-a.ejemplo.com', gen_random_uuid()) from generate_series(1, 4) n;
reset role;
select is((select array_agg(v ->> 'estado' order by k) from res where k ~ '^fav_[1-3]$'), array['ok', 'ok', 'ok'], 'H-3: cambiar_favorito: las 3 primeras llamadas del minuto se evalúan');
select is(pg_temp.fila('fav_4') ->> 'estado', 'limite', 'H-3: cambiar_favorito: la cuarta del minuto responde limite');
select ok((pg_temp.fila('fav_4') ->> 'espera_segundos')::int between 1 and 60, 'H-3: con la espera en segundos (1 a 60)');
select is(pg_temp.fila('misfav_4') ->> 'estado', 'limite', 'H-3: mis_favoritos: la cuarta responde limite');
select is(pg_temp.fila('misfav_3') ->> 'estado', 'ok', 'H-3: mis_favoritos: la tercera se evalúa');
select is(pg_temp.fila('entre_4') ->> 'estado', 'limite', 'H-3: favoritos_entre: la cuarta responde limite');
select is(pg_temp.fila('entre_3') ->> 'estado', 'ok', 'H-3: favoritos_entre: la tercera se evalúa');
select is(pg_temp.fila('compras_4') ->> 'estado', 'limite', 'H-3: mis_compras: la cuarta responde limite');
select is(pg_temp.fila('compras_3') ->> 'estado', 'ok', 'H-3: mis_compras: la tercera se evalúa');
select is(pg_temp.fila('compra_4') ->> 'estado', 'limite', 'H-3: mi_compra: la cuarta responde limite');
select is(pg_temp.fila('compra_3') ->> 'estado', 'no_encontrada', 'H-3: mi_compra: la tercera se evalúa (id inexistente: no_encontrada)');
select is((select count(*)::int from res where k ~ '^(fav|misfav|entre|compras|compra)_' and v::text ~* '(sqlstate|violates|relation )'), 0, 'H-3: ninguna respuesta lleva texto de Postgres');

-- Quien no tiene cuenta activa recibe sin_acceso idéntico y NO gasta el cupo de nadie (el cupo viene después de resolver la cuenta).
delete from public.limite_pedidos_publicos;
select pg_temp.como('f5000000-0000-0000-0000-000000000005', '10.2.0.2');
insert into res select 'sinacc_' || n, publico.mis_compras_por_dominio('cierre-a.ejemplo.com') from generate_series(1, 6) n;
reset role;
select is((select array_agg(distinct v) from res where k ~ '^sinacc_'), array['{"estado":"sin_acceso"}'::jsonb], 'H-3: sin cuenta activa: sin_acceso idéntico, sin cupo');
select is((select count(*)::int from public.limite_pedidos_publicos), 0, 'H-3: y sin tocar el contador de llamadas');

-- El cupo SOBREVIVE a un error: se provoca una falla DENTRO del bloque (un CHECK que siempre falla) y el contador igual sube.
delete from public.limite_pedidos_publicos;
alter table dominio.favoritos_cliente add constraint favoritos_falla_a_proposito check (false) not valid;
select pg_temp.como('f5000000-0000-0000-0000-000000000004', '10.2.0.3');
insert into res values ('falla_fav', publico.cambiar_favorito_por_dominio('cierre-a.ejemplo.com', 'a5000000-0000-0000-0000-000000000002', true));
reset role;
alter table dominio.favoritos_cliente drop constraint favoritos_falla_a_proposito;
select is(pg_temp.fila('falla_fav'), '{"estado":"error"}'::jsonb, 'H-3: una falla dentro de cambiar_favorito responde error genérico');
select is((select pedidos from public.limite_pedidos_publicos where visitante = 'cuenta|ca500000-0000-0000-0000-000000000004'), 1, 'H-3: y el cupo de llamadas se GASTÓ igual (sobrevive a la excepción)');

-- ============================================================================
-- H-6: caracteres invisibles bloqueados en B1 y B2 (U+00AD, U+180E, U+2061 a U+2064, además de los anteriores)
-- ============================================================================
-- La ráfaga de pruebas de esta sección necesita más de 10 llamadas por minuto a `crear_presupuesto_tienda`: se sube el cupo SOLO en esta transacción.
create or replace function private.limite_presupuestos_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 100; $$;
select pg_temp.como('f5000000-0000-0000-0000-000000000001', '10.4.0.1');
insert into res select 'inv_pres_' || x.n, publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), 'hola' || x.c || 'chau', gen_random_uuid())
  from (values ('00ad', E'\u00ad'), ('180e', E'\u180e'), ('2061', E'\u2061'), ('2062', E'\u2062'), ('2063', E'\u2063'), ('2064', E'\u2064'), ('2060', E'\u2060'), ('200b', E'\u200b'), ('061c', E'\u061c'), ('feff', E'\ufeff')) x(n, c);
reset role;
select is((select count(*)::int from res where k ~ '^inv_pres_' and v = '{"estado":"invalido","campos":["nota"]}'::jsonb), 10,
  'H-6: crear_presupuesto_tienda rechaza en la nota U+00AD, U+180E, U+2061 a U+2064 y los anteriores (2060, 200B, 061C, FEFF)');
select pg_temp.anonimo('10.4.0.2');
insert into res select 'inv_nota_' || x.n, publico.enviar_lista_pedido('cierre-a.ejemplo.com', 'Ana', 'ana@example.com', 'hola' || x.c || 'chau', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), gen_random_uuid())
  from (values ('00ad', E'\u00ad'), ('180e', E'\u180e'), ('2061', E'\u2061'), ('2064', E'\u2064')) x(n, c);
insert into res select 'inv_nombre_' || x.n, publico.enviar_lista_pedido('cierre-a.ejemplo.com', 'An' || x.c || 'a', 'ana@example.com', null, pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), gen_random_uuid())
  from (values ('00ad', E'\u00ad'), ('180e', E'\u180e'), ('2062', E'\u2062')) x(n, c);
reset role;
select is((select count(*)::int from res where k ~ '^inv_nota_' and v = '{"estado":"invalido","campos":["nota"]}'::jsonb), 4, 'H-6: enviar_lista_pedido (B1) rechaza los mismos caracteres en la nota');
select is((select count(*)::int from res where k ~ '^inv_nombre_' and v = '{"estado":"invalido","campos":["nombre"]}'::jsonb), 3, 'H-6: y en el nombre');
select is((select count(*)::int from dominio.consultas where origen = 'pedido' and nombre like 'An%a'), 0, 'H-6: ninguno de los rechazados creó una consulta');
-- Un texto normal con tildes y emoji sigue pasando (no se bloqueó de más).
select pg_temp.como('f5000000-0000-0000-0000-000000000001', '10.4.0.3');
insert into res values ('normal', publico.crear_presupuesto_tienda('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1'), E'Entregar mañana, por favor 🙂\nGracias', gen_random_uuid()));
reset role;
select is(pg_temp.fila('normal') ->> 'estado', 'ok', 'H-6: una nota normal (tildes, emoji, salto de línea) sigue siendo válida');

-- ============================================================================
-- H-4: el cupo de la lista de pedido y del envío (B1) sobrevive a una excepción
-- ============================================================================
-- Se baja el cupo a 3 por minuto SOLO en esta transacción (los valores reales son 30 y 20).
create or replace function private.limite_listas_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
create or replace function private.limite_llamadas_envio_por_minuto() returns integer language sql immutable set search_path = '' as $$ select 3; $$;
-- `disponible_publico` falla DESPUÉS del cupo de lecturas, dentro del bloque de la lista.
create or replace function private.disponible_publico(p_producto uuid) returns boolean language plpgsql stable as $$
begin raise exception 'falla provocada de la lista'; end $$;
delete from public.limite_pedidos_publicos;
select pg_temp.anonimo('10.3.0.1');
insert into res select 'lista_' || n, publico.lista_pedido_por_dominio('cierre-a.ejemplo.com', pg_temp.items('a5000000-0000-0000-0000-000000000001', '1')) from generate_series(1, 4) n;
reset role;
select is((select count(*)::int from res where k ~ '^lista_[1-3]$' and v = '{"estado":"error"}'::jsonb), 3, 'H-4: las 3 primeras llamadas de la lista con la falla provocada responden error genérico');
select is(pg_temp.fila('lista_4') ->> 'estado', 'limite', 'H-4: y la cuarta responde limite: el cupo de la lista sobrevivió a las excepciones');
-- `validar_items_pedido` falla DESPUÉS del cupo del envío, dentro del bloque con su manejador.
create or replace function private.validar_items_pedido(p_items jsonb) returns jsonb language plpgsql immutable as $$
begin raise exception 'falla provocada del envío'; end $$;
delete from public.limite_pedidos_publicos;
select pg_temp.anonimo('10.3.0.2');
insert into res select 'envio_' || n, publico.enviar_lista_pedido('cierre-a.ejemplo.com', 'Ana', 'ana@example.com', null, '[]'::jsonb, gen_random_uuid()) from generate_series(1, 4) n;
reset role;
select is((select count(*)::int from res where k ~ '^envio_[1-3]$' and v = '{"estado":"error"}'::jsonb), 3, 'H-4: las 3 primeras llamadas del envío con la falla provocada responden error genérico');
select is(pg_temp.fila('envio_4') ->> 'estado', 'limite', 'H-4: y la cuarta responde limite: el cupo del envío sobrevivió a las excepciones');
select is((select count(*)::int from dominio.consultas where origen = 'pedido' and nombre = 'Ana'), 0, 'H-4: nada se creó');

-- ============================================================================
-- H-2 (efecto sobre las bajas): borrar el usuario de Auth conserva el vínculo; la baja de la ORGANIZACIÓN sigue funcionando con presupuestos
-- ============================================================================
select is((select count(*)::int from dominio.presupuestos_tienda where cuenta_cliente_id is not null), 5, 'bajas: antes de borrar al usuario, los cinco vínculos con cuenta están con cuenta (los dos de la cuenta conservada, los dos de la cuenta que sobrevivió a la segunda fusión y el de la cuenta que sobrevivió a la tercera)');
select lives_ok($$delete from auth.users where id = 'f5000000-0000-0000-0000-000000000001'$$, 'bajas: borrar el usuario de Auth (que borra su cuenta web) no falla');
select is((select count(*)::int from dominio.presupuestos_tienda where cuenta_cliente_id is null), 4, 'bajas: y los vínculos de sus presupuestos siguen existiendo, sin cuenta (los cuatro: el suelto, el del descartado, el nuevo y el que chocó en la tercera fusión)');
select lives_ok($$delete from organizaciones where id = '11111111-1111-1111-1111-111111111111'$$, 'bajas: la baja de la organización con presupuestos de la tienda NO se bloquea (las FK de cliente y comprobante son cascade)');
select is((select count(*)::int from dominio.presupuestos_tienda), 0, 'bajas: y no queda ningún vínculo');

select * from finish();
rollback;
