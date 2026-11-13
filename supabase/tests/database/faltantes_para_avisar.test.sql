-- MSF-161 · F-VTA-27 (MSF-270, spec 20261110-100000-ventas-avisos-de-faltantes): «Para avisar» al ingresar
-- mercadería.
-- Cubre el disparador `marcar_faltantes_para_avisar` sobre `dominio.ingresos_mercaderia_lineas` (FR-101,
-- FR-102, FR-105: cobertura por antigüedad, se salta el que no entra, sin remarcar, sin tocar otras
-- organizaciones ni productos ni resueltos, varias líneas, falla simulada que no rompe el ingreso, actividad)
-- y `listar_faltantes` con `aviso = 'para_avisar'`, el filtro y el orden ascendente (FR-103). El ingreso se
-- registra con la RPC real `registrar_ingreso_mercaderia`, que NO se modifica.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000002', 'operador@example.com'),
  ('f2000000-0000-0000-0000-000000000001', 'admin-dos@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador', 'activo'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

insert into dominio.empresas (id, organizacion_id, nombre) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'San Javucho'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa Dos');

insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administracion');

insert into public.usuario_empresa_activa (user_id, empresa_id) values
  ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');

insert into clientes (id, organizacion_id, numero, nombre, tipo, correo, archivado_en) values
  ('c5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 10, 'Cliente Uno', 'minorista', 'uno@example.com', null);

insert into dominio.proveedores (id, organizacion_id, razon_social, cuit, activo) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Proveedor Uno', '20123456786', true);

insert into dominio.categorias (id, organizacion_id, nombre) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Consolas');

-- Productos P1..P9 de la organización Uno (uuid b1…00N).
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, categoria_id, disponibilidad_manual, activo)
select ('b1000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111',
       'Producto ' || n, 'P-' || n, 'ARS', 1000, 'c1000000-0000-0000-0000-000000000001', null, true
  from generate_series(1, 9) n;

create temp table datos as
  select (select id from dominio.depositos where organizacion_id = '11111111-1111-1111-1111-111111111111' and por_defecto) as principal;
grant select on datos to public;

insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
select principal, 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111' from datos
on conflict do nothing;

insert into dominio.existencias (producto_id, organizacion_id, cantidad, reservado)
select p.id, p.organizacion_id, 100, 0 from dominio.productos p
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
on conflict (producto_id) do update set cantidad = excluded.cantidad, reservado = 0;
insert into dominio.existencias_deposito (producto_id, deposito_id, organizacion_id, cantidad, reservado)
select p.id, principal, p.organizacion_id, 100, 0 from dominio.productos p, datos
 where p.organizacion_id = '11111111-1111-1111-1111-111111111111'
on conflict (producto_id, deposito_id) do update set cantidad = excluded.cantidad, reservado = 0;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Inserta el faltante como dueño (lo escribe la RPC de despacho, ya probada en faltantes.test.sql).
create function pg_temp.insf(p_clave text, p_comprobante uuid, p_cantidad integer, p_horas integer, p_estado text)
returns void language plpgsql security definer as $$
declare v_l dominio.comprobantes_venta_lineas; v_c dominio.comprobantes_venta;
begin
  select * into v_c from dominio.comprobantes_venta where id = p_comprobante;
  select * into v_l from dominio.comprobantes_venta_lineas where comprobante_id = p_comprobante and orden = 1;
  insert into dominio.faltantes_venta
    (id, organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante,
     estado, resuelto_en, creado_en)
  values (gen_random_uuid(), v_c.organizacion_id, v_c.empresa_id, v_c.id, 1, v_l.producto_id, (select principal from datos),
          p_cantidad, p_estado, case when p_estado = 'resuelto' then now() end, now() - p_horas * interval '1 hour');
  insert into falt (clave, comprobante_id, producto_id)
    select p_clave, p_comprobante, v_l.producto_id;
end $$;

create temp table falt (clave text primary key, comprobante_id uuid, producto_id uuid);
grant select, insert on falt to public;

-- Un faltante de la tienda: factura confirmada de 1 unidad del producto + fila de faltantes_venta.
create function pg_temp.nuevo(p_clave text, p_producto integer, p_cantidad integer, p_horas integer, p_estado text default 'abierto')
returns void language plpgsql as $$
declare v_c dominio.comprobantes_venta;
begin
  v_c := public.crear_comprobante('factura', 'a1000000-0000-0000-0000-000000000001',
    'c5000000-0000-0000-0000-000000000001', 'mostrador', '2026-10-24');
  perform public.guardar_lineas_comprobante(v_c.id, jsonb_build_array(jsonb_build_object(
    'producto_id', ('b1000000-0000-0000-0000-00000000000' || p_producto)::uuid, 'cantidad', 1,
    'deposito_id', (select principal from datos))), v_c.updated_at);
  perform public.confirmar_comprobante(v_c.id);
  perform pg_temp.insf(p_clave, v_c.id, p_cantidad, p_horas, p_estado);
end $$;

create function pg_temp.ingreso(variadic p_lineas integer[]) returns void language plpgsql as $$
declare v_json jsonb := '[]'::jsonb; i integer := 1;
begin
  while i < array_length(p_lineas, 1) loop
    v_json := v_json || jsonb_build_object(
      'producto_id', ('b1000000-0000-0000-0000-00000000000' || p_lineas[i])::uuid,
      'cantidad', p_lineas[i + 1], 'costo_unitario_usd', 5);
    i := i + 2;
  end loop;
  perform public.registrar_ingreso_mercaderia('a1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001', current_date, null, v_json, false, gen_random_uuid());
end $$;

create function pg_temp.fa(p_clave text) returns text language sql security definer as $$
  select case when f.para_avisar_en is null then 'no' else 'si' end
    from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id and x.clave = p_clave
   where f.linea_orden = 1 order by f.creado_en desc limit 1 $$;
grant execute on function pg_temp.fa(text) to public;

select pg_temp.como('f1000000-0000-0000-0000-000000000002');

-- CA-VTA-27-1: P1 con tres faltantes de 3 (el más antiguo primero: a, b, c).
select pg_temp.nuevo('a1', 1, 3, 30);
select pg_temp.nuevo('a2', 1, 3, 20);
select pg_temp.nuevo('a3', 1, 3, 10);
-- CA-VTA-27-2: P2 con 4 + 4 + 4.
select pg_temp.nuevo('b1', 2, 4, 30);
select pg_temp.nuevo('b2', 2, 4, 20);
select pg_temp.nuevo('b3', 2, 4, 10);
-- Saltos: P3 [9, 2, 1] y P4 [12, 1].
select pg_temp.nuevo('c1', 3, 9, 30);
select pg_temp.nuevo('c2', 3, 2, 20);
select pg_temp.nuevo('c3', 3, 1, 10);
select pg_temp.nuevo('d1', 4, 12, 30);
select pg_temp.nuevo('d2', 4, 1, 20);
-- P5: uno ya avisado (cola «enviado»), uno libre, uno resuelto.
select pg_temp.nuevo('e1', 5, 1, 30);
select pg_temp.nuevo('e2', 5, 1, 20);
select pg_temp.nuevo('e3', 5, 1, 10, 'resuelto');
-- P6 y P7 para un ingreso de varias líneas; P8 para la falla simulada; P9 para el filtro y la otra organización.
select pg_temp.nuevo('f1', 6, 2, 10);
select pg_temp.nuevo('g1', 7, 2, 10);
select pg_temp.nuevo('h1', 8, 2, 10);

reset role;
-- e1 ya avisado: aviso «enviado» en la cola.
insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, estado, intentos, enviado_en)
select l.id, '11111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-000000000001',
       'c5000000-0000-0000-0000-000000000001', 'enviado', 1, now()
  from falt x join dominio.comprobantes_venta_lineas l on l.comprobante_id = x.comprobante_id and l.orden = 1
 where x.clave = 'e1';

-- Faltante de otra organización (producto propio): jamás se toca.
insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, disponibilidad_manual, activo) values
  ('b2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Producto Dos Org', 'P-2O', 'ARS', 10, null, true);

-- QA M2 · aislamiento entre organizaciones: un faltante ABIERTO de la Organización Dos con el MISMO producto que
-- ingresa la Organización Uno (P1). Las FK compuestas impiden armarlo con datos válidos; se inserta sin los
-- disparadores de FK solo para probar que el disparador filtra por `organizacion_id` (sin ese filtro, el ingreso de
-- Uno lo marcaría).
set local session_replication_role = replica;
insert into dominio.faltantes_venta
  (id, organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, estado, creado_en)
select 'd2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2000000-0000-0000-0000-000000000001',
       x.comprobante_id, 99, 'b1000000-0000-0000-0000-000000000001', (select principal from datos), 1, 'abierto',
       now() - interval '1000 hours'
  from falt x where x.clave = 'a1';
set local session_replication_role = origin;

select is((select count(*)::int from dominio.faltantes_venta where para_avisar_en is null and organizacion_id = '11111111-1111-1111-1111-111111111111'), 17, 'hay 17 faltantes sin marca antes de ingresar');
select is((select count(*)::int from dominio.faltantes_avisos), 1, 'la cola tiene solo el aviso previo de e1');

-- ============================================================================
-- Esquema, privilegios y firma intacta
-- ============================================================================

select has_column('dominio', 'faltantes_venta', 'para_avisar_en', 'faltantes_venta tiene para_avisar_en');
select has_column('dominio', 'faltantes_venta', 'para_avisar_ingreso_id', 'faltantes_venta tiene para_avisar_ingreso_id');
select is(has_function_privilege('authenticated', 'private.marcar_faltantes_para_avisar()', 'execute'), false, 'authenticated no ejecuta el disparador');
select is(has_function_privilege('anon', 'private.marcar_faltantes_para_avisar()', 'execute'), false, 'anon no ejecuta el disparador');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.marcar_faltantes_para_avisar()'::regprocedure),
  true, 'el disparador es security definer con search_path vacío');
select is(
  (select count(*)::int from pg_trigger t where t.tgrelid = 'dominio.ingresos_mercaderia_lineas'::regclass
     and t.tgname = 'ingresos_mercaderia_lineas_marcar_faltantes' and not t.tgisinternal),
  1, 'el disparador está en ingresos_mercaderia_lineas');
select is(
  (select p.prosrc !~* 'faltantes' from pg_proc p where p.proname = 'registrar_ingreso_mercaderia' and p.pronamespace = 'public'::regnamespace),
  true, 'registrar_ingreso_mercaderia no menciona faltantes (no se modificó)');
select isnt(to_regprocedure('public.registrar_ingreso_mercaderia(uuid, uuid, date, text, jsonb, boolean, uuid)'), null,
  'la firma de registrar_ingreso_mercaderia sigue igual');

-- ============================================================================
-- CA-VTA-27-1 y CA-VTA-27-2
-- ============================================================================

select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.ingreso(1, 10);
select is((select count(*)::int from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id
            where x.clave in ('a1', 'a2', 'a3') and f.para_avisar_en is not null and f.para_avisar_ingreso_id is not null), 3,
  'CA-VTA-27-1: ingreso de 10 con tres faltantes de 3: los tres quedan Para avisar');
select is((select count(*)::int from dominio.faltantes_avisos), 1, 'CA-VTA-27-1: no se escribe nada en faltantes_avisos');
select is((select count(*)::int from dominio.ingresos_mercaderia), 1, 'el ingreso quedó registrado');

select pg_temp.ingreso(2, 10);
select is(pg_temp.fa('b1') || pg_temp.fa('b2') || pg_temp.fa('b3'), 'sisino', 'CA-VTA-27-2: 4+4+4 con ingreso de 10: los dos más antiguos; el tercero espera');
select pg_temp.ingreso(2, 4);
select is(pg_temp.fa('b3'), 'si', 'un segundo ingreso cubre el tercero');
select is((select count(distinct f.para_avisar_ingreso_id)::int from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id
            where x.clave in ('b1', 'b2', 'b3')), 2, 'cada marca guarda el ingreso que la originó');

-- Se salta el que no entra y se sigue con el siguiente.
select pg_temp.ingreso(3, 10);
select is(pg_temp.fa('c1') || pg_temp.fa('c2') || pg_temp.fa('c3'), 'sinosi', '[9, 2, 1] con ingreso de 10: el de 9 y el de 1 (saldo 1; el de 2 no entra y se salta)');
select pg_temp.ingreso(4, 10);
select is(pg_temp.fa('d1') || pg_temp.fa('d2'), 'nosi', '[12, 1] con ingreso de 10: solo el de 1 (el más antiguo no entra y se salta)');

-- No remarca los ya Para avisar ni toca avisados o resueltos.
create temp table antes (marca timestamptz);
grant select, insert on antes to public;
reset role;
insert into antes select f.para_avisar_en from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id and f.linea_orden = 1 where x.clave = 'a1';
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.ingreso(5, 5);
select is(pg_temp.fa('e1') || pg_temp.fa('e2') || pg_temp.fa('e3'), 'nosino', 'P5: el avisado y el resuelto no se marcan; el libre sí');
select pg_temp.ingreso(1, 10, 5, 5);
select is((select f.para_avisar_en from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id and f.linea_orden = 1 where x.clave = 'a1'),
  (select marca from antes), 'un segundo ingreso no remarca (la fecha de la marca no cambia)');
select is(pg_temp.fa('e1') || pg_temp.fa('e3'), 'nono', 'avisado y resuelto siguen sin marca tras el segundo ingreso');

-- Otro producto de la organización y otra organización intactos.
select is((select count(*)::int from dominio.faltantes_venta f join falt x on x.comprobante_id = f.comprobante_id
            where x.clave in ('f1', 'g1', 'h1') and f.para_avisar_en is not null), 0, 'los faltantes de otros productos no se tocan');

-- Varias líneas en un mismo ingreso.
select pg_temp.ingreso(6, 2, 7, 5);
select is(pg_temp.fa('f1') || pg_temp.fa('g1'), 'sisi', 'un ingreso con dos líneas marca los faltantes de cada producto');

-- Actividad: solo si marcó algo.
select is((select count(*)::int from public.registro_actividad where tipo = 'ventas.faltantes_para_avisar'), 8,
  'actividad ventas.faltantes_para_avisar solo cuando se marcó algo (8 de 9 ingresos)');
select ok((select bool_and(length(detalle) <= 500 and detalle !~ '@') from public.registro_actividad where tipo = 'ventas.faltantes_para_avisar'),
  'la actividad cabe en 500 caracteres y no lleva correos');

-- ============================================================================
-- FR-105 · una falla del disparador no rompe el ingreso
-- ============================================================================

reset role;
create function pg_temp.falla() returns trigger language plpgsql as $$
begin
  if new.para_avisar_en is not null then raise exception 'falla simulada'; end if;
  return new;
end $$;
create trigger falla_simulada before update on dominio.faltantes_venta
  for each row execute function pg_temp.falla();
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select lives_ok($$select pg_temp.ingreso(8, 5)$$, 'FR-105: el ingreso se registra aunque el disparador falle');
select is((select cantidad from dominio.existencias where producto_id = 'b1000000-0000-0000-0000-000000000008'), 104,
  'el stock del ingreso se aplicó');
select is((select count(*)::int from dominio.ingresos_mercaderia), 9, 'y quedó el ingreso (9 en total)');
select is(pg_temp.fa('h1'), 'no', 'sin marcas parciales cuando falla');
reset role;
drop trigger falla_simulada on dominio.faltantes_venta;
select pg_temp.como('f1000000-0000-0000-0000-000000000002');
select pg_temp.ingreso(8, 5);
select is(pg_temp.fa('h1'), 'si', 'sin la falla, el siguiente ingreso lo marca');

-- ============================================================================
-- FR-103 · listar_faltantes: aviso, filtro y orden
-- ============================================================================

select is((select aviso from public.listar_faltantes(null, 1, 100) where comprobante_id = (select comprobante_id from falt where clave = 'a1')),
  'para_avisar', 'aviso = para_avisar para un marcado no avisado');
select is((select aviso_en from public.listar_faltantes(null, 1, 100) where comprobante_id = (select comprobante_id from falt where clave = 'a1')),
  (select marca from antes), 'aviso_en = para_avisar_en');
select is((select aviso from public.listar_faltantes(null, 1, 100) where comprobante_id = (select comprobante_id from falt where clave = 'e1')),
  'avisado', 'el avisado (cola enviado) tiene prioridad sobre Para avisar');
select is((select aviso from public.listar_faltantes(null, 1, 100) where comprobante_id = (select comprobante_id from falt where clave = 'c2')),
  'sin_avisar', 'los no marcados siguen sin_avisar');
select is((select count(*)::int from public.listar_faltantes(null, 1, 100, 'para_avisar')), 13,
  'el filtro para_avisar devuelve los 13 marcados (a1-a3, b1-b3, c1, c3, d2, e2, f1, g1, h1)');
select ok(
  (select array_agg(l.desde order by l.desde, l.id) = array_agg(l.desde)
     from (select * from public.listar_faltantes(null, 1, 100, 'para_avisar') offset 0) l),
  'con para_avisar el orden es del más antiguo al más nuevo');
select ok(
  (select array_agg(l.desde order by l.desde desc, l.id) = array_agg(l.desde)
     from (select * from public.listar_faltantes(null, 1, 100) offset 0) l),
  'sin filtro el orden de siempre (más reciente primero)');
select is((select filas from public.listar_faltantes(null, 1, 3, 'para_avisar') limit 1), 13::bigint, 'filas es el total del filtro');
select throws_ok($$select * from public.listar_faltantes(null, 1, 10, 'otro')$$, '22023', null, 'filtro inválido: 22023');

-- Otra organización: ni ve los faltantes ni se le marcó nada.
select pg_temp.como('f2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.listar_faltantes(null, 1, 100, 'para_avisar')), 0, 'otra organización no ve los marcados');
reset role;
select is((select count(*)::int from dominio.faltantes_venta where organizacion_id = '22222222-2222-2222-2222-222222222222'), 1,
  'la Organización Dos conserva su faltante (QA M2)');
select is((select para_avisar_en from dominio.faltantes_venta where id = 'd2000000-0000-0000-0000-000000000001'), null,
  'y ningún ingreso de la Organización Uno (P1 incluido, con saldo de sobra) se lo marcó: el disparador filtra por organización');

select * from finish();
rollback;
