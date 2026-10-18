-- F-STK-04 (MSF-249, épica MSF-231): cola de eventos `stock.actualizado`.
-- Cubre FR-003…FR-007 y SC-002, SC-003, SC-005: un evento por entrada/salida/ajuste aceptado
-- con la carga del contrato; ninguno si la salida se rechaza; el mínimo no emite; sin
-- consumidor el evento queda `pendiente`; reclamo exclusivo, lease vencido que vuelve a
-- `pendiente`, reintento con espera creciente, `agotada` y rechazo de confirmaciones vencidas
-- o reemplazadas; aislamiento por organización y por rol; `authenticated` sin escritura y
-- `anon` sin acceso. La concurrencia real entre conexiones la prueba el E2E
-- `apps/web/e2e/stock-concurrencia.e2e.ts` (pgTAP corre en una sola conexión).
begin;

select plan(49);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Cola Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Cola Dos');

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'cola-admin-x@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'cola-operador-x@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'cola-admin-y@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Joystick Cola', 'COLA-1', 50);

create temp table ids on commit drop as
select m.organizacion_id, m.nombre, m.id from dominio.motivos_movimiento m;
grant select on ids to authenticated;

create temp table ev (clave text primary key, id uuid) on commit drop;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Estructura y privilegios (FR-004, FR-007)
-- ============================================================================

select has_table('public', 'cola_eventos', 'la cola vive en public (Principio VII)');
select has_function('private', 'reclamar_eventos', array['text', 'integer', 'integer'], 'existe el reclamo');
select has_trigger('dominio', 'movimientos_stock', 'movimientos_stock_emitir_evento', 'existe el disparador de emisión');
select ok(not has_table_privilege('anon', 'public.cola_eventos', 'select'), 'anon no lee la cola');
select ok(not has_table_privilege('authenticated', 'public.cola_eventos', 'insert'), 'authenticated no inserta en la cola');
select ok(not has_table_privilege('authenticated', 'public.cola_eventos', 'update'), 'authenticated no actualiza la cola');
select ok(not has_table_privilege('authenticated', 'public.cola_eventos', 'delete'), 'authenticated no borra de la cola');
select ok(
  not has_function_privilege('authenticated', 'private.reclamar_eventos(text, integer, integer)', 'execute'),
  'authenticated no ejecuta el reclamo'
);
select ok(
  not has_function_privilege('anon', 'private.reclamar_eventos(text, integer, integer)', 'execute'),
  'anon no ejecuta el reclamo'
);
select ok(
  not has_function_privilege('authenticated', 'private.resolver_evento(uuid, integer, text, text, integer, integer)', 'execute'),
  'authenticated no ejecuta la resolución'
);
select ok(
  not has_function_privilege('anon', 'private.resolver_evento(uuid, integer, text, text, integer, integer)', 'execute'),
  'anon no ejecuta la resolución'
);
select ok(
  not has_function_privilege('authenticated', 'private.emitir_stock_actualizado()', 'execute'),
  'authenticated no ejecuta la emisión'
);

-- ============================================================================
-- Emisión (FR-003, SC-002): entrada aceptada, salida rechazada y mínimo
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000002');

select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'entrada', 5,
      (select id from ids where nombre = 'Compra a proveedor'))$$,
  'operador: entrada de 5'
);
select throws_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 8,
      (select id from ids where nombre = 'Venta en local'))$$,
  '23514', 'No hay stock suficiente', 'la salida de 8 con stock 5 se rechaza'
);
select lives_ok(
  $$select public.definir_minimo_stock('a1000000-0000-0000-0000-000000000001', 2)$$,
  'operador: define el mínimo (no cambia la cantidad)'
);

reset role;

select is(
  (select count(*)::int from public.cola_eventos where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1, 'un solo evento: la entrada; ni la salida rechazada ni el mínimo emiten'
);
select is(
  (select count(*)::int from public.cola_eventos c
     join dominio.movimientos_stock m on m.id::text = c.clave_idempotencia
    where c.tipo = 'stock.actualizado'),
  1, 'la clave de idempotencia es el id del movimiento'
);
select results_eq(
  $$select c.carga->>'tipo_movimiento', (c.carga->>'cantidad')::int, (c.carga->>'diferencia')::int,
           c.carga->>'producto_id', c.carga->>'organizacion_id'
      from public.cola_eventos c$$,
  $$values ('entrada'::text, 5, 5, 'a1000000-0000-0000-0000-000000000001'::text, '11111111-1111-1111-1111-111111111111'::text)$$,
  'la carga trae tipo, cantidad resultante, diferencia, producto y organización'
);
select is(
  (select c.carga->>'movimiento_id' from public.cola_eventos c),
  (select m.id::text from dominio.movimientos_stock m),
  'la carga referencia el movimiento'
);
select ok(
  (select (c.carga->>'ocurrido_en')::timestamptz = m.creado_en
     from public.cola_eventos c, dominio.movimientos_stock m),
  'la carga trae la fecha del movimiento'
);
select results_eq(
  $$select estado, intentos from public.cola_eventos$$,
  $$values ('pendiente'::text, 0)$$,
  'sin consumidor el evento queda pendiente y sin intentos'
);

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'salida', 2,
      (select id from ids where nombre = 'Venta en local'))$$,
  'operador: salida de 2'
);
select lives_ok(
  $$select public.registrar_movimiento_stock('a1000000-0000-0000-0000-000000000001', 'ajuste', 9,
      (select id from ids where nombre = 'Conteo de inventario'))$$,
  'operador: ajuste a 9'
);
reset role;

select results_eq(
  $$select c.carga->>'tipo_movimiento', (c.carga->>'cantidad')::int, (c.carga->>'diferencia')::int
      from public.cola_eventos c order by (c.carga->>'cantidad')::int$$,
  $$values ('salida'::text, 3, -2), ('entrada'::text, 5, 5), ('ajuste'::text, 9, 6)$$,
  'un evento por entrada, salida y ajuste, con la cantidad resultante y la diferencia'
);

-- Idempotencia (FR-006): repetir el evento de un movimiento no duplica.
select lives_ok(
  $$insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
    select organizacion_id, tipo, clave_idempotencia, carga from public.cola_eventos
    on conflict (organizacion_id, tipo, clave_idempotencia) do nothing$$,
  'reinsertar el mismo evento no falla'
);
select is((select count(*)::int from public.cola_eventos), 3, 'la reinserción no duplica eventos');

-- ============================================================================
-- Aislamiento (FR-007, SC-005)
-- ============================================================================

select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.cola_eventos), 3, 'el Administrador de la organización ve sus 3 eventos');
reset role;

select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.cola_eventos), 0, 'un no Administrador no ve eventos');
select throws_ok(
  $$insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
    values ('11111111-1111-1111-1111-111111111111', 'stock.actualizado', 'falso', '{}')$$,
  '42501', null, 'authenticated no escribe en la cola'
);
select throws_ok(
  $$select * from private.reclamar_eventos('stock.actualizado', 1, 60)$$,
  '42501', null, 'authenticated no puede reclamar eventos'
);
reset role;

select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.cola_eventos), 0, 'el Administrador de otra organización no ve eventos ajenos');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.cola_eventos$$, '42501', null, 'anon no accede a la cola');
reset role;

-- ============================================================================
-- Reclamo exclusivo y vencimiento del lease (FR-005, SC-003)
-- ============================================================================

insert into ev (clave, id)
select case c.carga->>'tipo_movimiento' when 'entrada' then 'e1' when 'salida' then 'e2' else 'e3' end, c.id
  from public.cola_eventos c;
-- Orden determinista: e1, luego e2, luego e3.
update public.cola_eventos set proximo_intento_en = clock_timestamp() - interval '3 hours' where id = (select id from ev where clave = 'e1');
update public.cola_eventos set proximo_intento_en = clock_timestamp() - interval '2 hours' where id = (select id from ev where clave = 'e2');
update public.cola_eventos set proximo_intento_en = clock_timestamp() - interval '1 hour' where id = (select id from ev where clave = 'e3');

select throws_ok($$select * from private.reclamar_eventos('stock.actualizado', 0, 60)$$, 'P0001', null, 'el límite debe ser 1–100');
select throws_ok($$select * from private.reclamar_eventos('stock.actualizado', 10, 0)$$, 'P0001', null, 'la duración del lease debe ser 1–3600 s');
select throws_ok($$select * from private.reclamar_eventos(' ', 10, 60)$$, 'P0001', null, 'el tipo es obligatorio');

select is(
  (select evento_id from private.reclamar_eventos('stock.actualizado', 1, 60)),
  (select id from ev where clave = 'e1'),
  'el reclamo entrega el evento más antiguo'
);
select results_eq(
  $$select evento_id, intento from private.reclamar_eventos('stock.actualizado', 10, 60) order by evento_id$$,
  $$select id, 1 from ev where clave in ('e2', 'e3') order by id$$,
  'el segundo reclamo recibe solo los eventos que nadie tiene'
);
select is(
  (select count(*)::int from private.reclamar_eventos('stock.actualizado', 10, 60)),
  0, 'con todos reclamados no queda nada para un tercer reclamo'
);

select is(
  private.resolver_evento((select id from ev where clave = 'e1'), 1, 'confirmar'),
  'completada', 'confirmar un reclamo vigente lo completa'
);

-- Lease vencido: e2 vuelve a pendiente y se reclama de nuevo (intento 2).
update public.cola_eventos
   set reclamada_en = clock_timestamp() - interval '2 minutes', vence_en = clock_timestamp() - interval '1 minute'
 where id = (select id from ev where clave = 'e2');
select results_eq(
  $$select evento_id, intento from private.reclamar_eventos('stock.actualizado', 1, 60)$$,
  $$select id, 2 from ev where clave = 'e2'$$,
  'el lease vencido devuelve el evento a pendiente y se reclama con intento 2'
);
select is(
  (select ultimo_error_sanitizado from public.cola_eventos where id = (select id from ev where clave = 'e2')),
  'RECLAMO_VENCIDO', 'queda registrado el vencimiento del reclamo'
);
select throws_ok(
  format($$select private.resolver_evento(%L, 1, 'confirmar')$$, (select id from ev where clave = 'e2')),
  'P0001', 'RECLAMO_NO_VIGENTE', 'no se confirma un intento reemplazado'
);

-- Reintento con espera creciente: intento 2 con demora 60 → 120 s.
select is(
  private.resolver_evento((select id from ev where clave = 'e2'), 2, 'liberar', 'FALLA_DE_PRUEBA', 60, 3),
  'pendiente', 'liberar con intentos disponibles vuelve a pendiente'
);
select ok(
  (select proximo_intento_en >= clock_timestamp() + interval '115 seconds' from public.cola_eventos where id = (select id from ev where clave = 'e2')),
  'la espera crece con el intento (60 s × 2^(intentos−1))'
);
select is(
  (select count(*)::int from private.reclamar_eventos('stock.actualizado', 10, 60) where evento_id = (select id from ev where clave = 'e2')),
  0, 'un evento en espera no se reclama antes de su próximo intento'
);

-- Agotamiento: tercer intento fallido → agotada.
update public.cola_eventos set proximo_intento_en = clock_timestamp() - interval '1 second'
 where id = (select id from ev where clave = 'e2');
select results_eq(
  $$select evento_id, intento from private.reclamar_eventos('stock.actualizado', 10, 60) where evento_id = (select id from ev where clave = 'e2')$$,
  $$select id, 3 from ev where clave = 'e2'$$,
  'tras la espera se reclama con intento 3'
);
select is(
  private.resolver_evento((select id from ev where clave = 'e2'), 3, 'liberar', 'FALLA_DE_PRUEBA', 60, 3),
  'agotada', 'al alcanzar el máximo de intentos queda agotada'
);

-- Confirmación vencida: e3 sigue reclamado; se vence y no se puede confirmar.
update public.cola_eventos
   set reclamada_en = clock_timestamp() - interval '2 minutes', vence_en = clock_timestamp() - interval '1 minute'
 where id = (select id from ev where clave = 'e3');
select throws_ok(
  format($$select private.resolver_evento(%L, 1, 'confirmar')$$, (select id from ev where clave = 'e3')),
  'P0001', 'RECLAMO_NO_VIGENTE', 'no se confirma un reclamo vencido'
);
select throws_ok(
  format($$select private.resolver_evento(%L, 1, 'inventada')$$, (select id from ev where clave = 'e3')),
  'P0001', 'ARGUMENTO_INVALIDO', 'la acción desconocida se rechaza'
);

select * from finish();
rollback;
