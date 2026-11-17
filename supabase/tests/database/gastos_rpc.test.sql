-- F-GAS-01/02 (MSF-469): RPC de gastos: permisos, validación, bloqueo optimista, dólar congelado, anulación, Actividad,
-- listado con cursor, resumen y exportación (RF-GAS-2, 3, 4, 6, 7, 9).
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización A'),
  ('22222222-2222-2222-2222-222222222222', 'Organización B');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'admin-a@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'administracion-a@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'operador-a@example.com'),
  ('d2000000-0000-0000-0000-000000000001', 'admin-b@example.com');
insert into usuarios_organizacion (user_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'administracion'),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'operador'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A1', true),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda A2', true),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda A3 pausada', false),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Tienda B', true);
insert into usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id) values
  ('d1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administracion');

-- Dólar: general $ 1.000 (2026-03-01) y de A2 $ 1.200 (2026-03-10); la más cercana a la fecha del gasto gana.
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, cargada_por_nombre, cargada_en, recalculo_aplicado) values
  ('11111111-1111-1111-1111-111111111111', null, 1000, 'Test', '2026-03-01 12:00-03', true),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 1200, 'Test', '2026-03-10 12:00-03', true);

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Alta ARS (CA-GAS-1).
create temp table ids (clave text primary key, id uuid);
grant all on ids to public;
insert into ids select 'g1', public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-06', 'Servicios', 'fijo', 'Internet', 36800, 'ARS', false, null);
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g1')), 36800.00, 'alta ARS: pesos = importe');
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g1')), null, 'alta ARS: sin cotización');
select is((select count(*)::int from public.registro_actividad where tipo = 'gasto.creado'), 1, 'el alta deja gasto.creado en Actividad');

-- USD con la cotización general más cercana (CA-GAS-2) y con la de la empresa.
insert into ids select 'g2', public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 500, 'USD', true, null);
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g2')), 1000.0000, 'USD: dólar general más cercano');
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g2')), 500000.00, 'USD: pesos congelados');
insert into ids select 'g3', public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000002', '2026-03-12', 'Insumos', 'variable', null, 10, 'USD', false, null);
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g3')), 1200.0000, 'USD: dólar de la empresa más cercano');

-- Snapshot inmutable: una cotización posterior no reescribe lo guardado.
reset role;
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, cargada_por_nombre, cargada_en, recalculo_aplicado) values
  ('11111111-1111-1111-1111-111111111111', null, 5000, 'Test', '2026-03-05 12:00-03', true);
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g2')), 500000.00, 'una cotización cargada después no reescribe el gasto');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Sin cotización (otra organización sin dólar).
select pg_temp.como('d2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.guardar_gasto(null, 'e2000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 10, 'USD', false, null)$$,
  '22023', 'Cargá la cotización del dólar', 'sin cotización se rechaza');
select is((select count(*)::int from dominio.gastos where organizacion_id = '22222222-2222-2222-2222-222222222222'), 0, 'no se escribió nada');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Validaciones (CA-GAS-3) y empresa.
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 0, 'ARS', false, null)$$, '22023', null, 'importe 0');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Otra', 'fijo', null, 5, 'ARS', false, null)$$, '22023', null, 'categoría inválida');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2099-01-01', 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, '22023', null, 'fecha a más de 31 días');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '1999-12-31', 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, '22023', null, 'fecha anterior a 2000-01-01');
select lives_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000002', '2000-01-01', 'Otros', 'variable', null, 5, 'ARS', false, null)$$, 'fecha en el mínimo 2000-01-01');
select throws_ok(format($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', %L, 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 32),
  '22023', null, 'fecha a +32 días se rechaza');
select lives_ok(format($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000002', %L, 'Otros', 'variable', null, 5, 'ARS', false, null)$$, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 31),
  'fecha en el límite de +31 días se acepta');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 10.005, 'ARS', false, null)$$, '22023', null, 'importe con 3 decimales');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 1000000000000, 'ARS', false, null)$$, '22023', null, 'importe de 10^12 o más');
select lives_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000002', '2025-01-05', 'Otros', 'variable', null, 999999999999.99, 'ARS', false, null)$$, 'importe máximo 999.999.999.999,99');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 999999999999, 'USD', false, null)$$,
  '22023', 'El importe en pesos es demasiado grande: revisá el importe', 'USD que desborda los pesos: 22023 claro, no 22003');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', repeat('x', 201), 5, 'ARS', false, null)$$, '22023', null, 'detalle de más de 200');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000003', '2026-03-05', 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, '22023', null, 'empresa inactiva');
select throws_ok($$select public.guardar_gasto(null, 'e2000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, 'P0002', null, 'empresa de otra organización');

-- Edición con bloqueo optimista (CA-GAS-5) y recálculo de cotización al cambiar la fecha.
select throws_ok(format($$select public.guardar_gasto(%L, 'e1000000-0000-0000-0000-000000000001', '2026-03-06', 'Servicios', 'fijo', 'Internet', 40000, 'ARS', false, '2020-01-01')$$, (select id from ids where clave = 'g1')),
  '40001', null, 'edición con versión vieja: 40001');
select public.guardar_gasto((select id from ids where clave = 'g1'), 'e1000000-0000-0000-0000-000000000001', '2026-03-06', 'Servicios', 'fijo', 'Internet', 40000, 'ARS', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g1')));
select is((select importe from dominio.gastos where id = (select id from ids where clave = 'g1')), 40000.00, 'la edición se guarda');
select is((select valor_nuevo -> 'campos_modificados' from public.registro_actividad where tipo = 'gasto.editado'), '["importe"]'::jsonb,
  'Actividad registra solo el NOMBRE del campo modificado');
select is((select valor_anterior ->> 'categoria' from public.registro_actividad where tipo = 'gasto.editado'), 'Servicios', 'y el concepto anterior');

-- Actividad no lleva cifras (la lee quien tiene la sección actividad sin rentabilidad): ni en detalle ni en el jsonb.
select is((select count(*)::int from public.registro_actividad
            where tipo in ('gasto.creado', 'gasto.editado')
              and (detalle ~ '[0-9]{3}' or valor_anterior::text ~ '[0-9]{3}' or valor_nuevo::text ~ '[0-9]{3}'
                   or valor_nuevo ? 'importe' or valor_nuevo ? 'moneda' or valor_nuevo ? 'importe_pesos')), 0,
  'alta y edición no guardan importe, moneda ni cifras en Actividad');

-- CA-GAS-5: la cotización congelada se recalcula si cambia importe, fecha, tienda o moneda; se conserva si nada de eso cambia.
reset role;
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, cargada_por_nombre, cargada_en, recalculo_aplicado) values
  ('11111111-1111-1111-1111-111111111111', null, 2000, 'Test', '2026-03-20 12:00-03', true);
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
insert into ids select 'g4', public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-21', 'Alquiler', 'fijo', null, 100, 'USD', false, null);
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), 2000.0000, 'USD g4: dólar general más cercano a su fecha');
-- Solo cambia el detalle: se conserva aunque haya una cotización más cercana cargada después.
reset role;
insert into dominio.cotizaciones (organizacion_id, empresa_id, valor, cargada_por_nombre, cargada_en, recalculo_aplicado) values
  ('11111111-1111-1111-1111-111111111111', null, 3000, 'Test', '2026-03-21 11:00-03', true);
-- Cotizaciones esperadas para A2 según la regla vigente (se calculan con el dueño: `analitica` no es accesible a `authenticated`).
create temp table exp as select
  analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-03-21 12:00-03', 'e1000000-0000-0000-0000-000000000002') as a, analitica.cotizacion_cercana('11111111-1111-1111-1111-111111111111', '2026-03-05 12:00-03', 'e1000000-0000-0000-0000-000000000002') as b;
grant all on exp to public;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000001', '2026-03-21', 'Alquiler', 'fijo', 'Oficina', 100, 'USD', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), 2000.0000, 'USD: si solo cambia el detalle se conserva la cotización');
-- Cambia el importe: se recalcula con la más cercana vigente.
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000001', '2026-03-21', 'Alquiler', 'fijo', 'Oficina', 110, 'USD', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), 3000.0000, 'USD: al cambiar el importe se recalcula la cotización');
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g4')), 330000.00, 'y los pesos con la nueva cotización');
-- Cambia la tienda (A2 tiene dólar propio de 1.200 del 2026-03-10; la general 3.000 es más cercana a la fecha, pero la regla elige por alcance).
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000002', '2026-03-21', 'Alquiler', 'fijo', 'Oficina', 110, 'USD', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')),
  (select a from exp),
  'USD: al cambiar la tienda se recalcula con la regla de la nueva tienda');
-- Cambia la fecha.
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000002', '2026-03-05', 'Alquiler', 'fijo', 'Oficina', 110, 'USD', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), (select b from exp), 'USD: al cambiar la fecha se recalcula');
-- USD -> ARS: sin cotización y pesos = importe.
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000002', '2026-03-05', 'Alquiler', 'fijo', 'Oficina', 110, 'ARS', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), null, 'USD a ARS: sin cotización');
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g4')), 110.00, 'USD a ARS: pesos = importe');
-- ARS -> USD: cotiza al guardar.
select public.guardar_gasto((select id from ids where clave = 'g4'), 'e1000000-0000-0000-0000-000000000002', '2026-03-05', 'Alquiler', 'fijo', 'Oficina', 110, 'USD', false,
  (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g4')));
select is((select cotizacion_usada from dominio.gastos where id = (select id from ids where clave = 'g4')), (select b from exp), 'ARS a USD: cotiza con la más cercana');
select is((select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g4')), round(110 * (select b from exp), 2), 'ARS a USD: pesos congelados');

-- Permisos (CA-GAS-7): Administración solo lee; Operador nada.
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2026-03-05', 'Alquiler', 'fijo', null, 5, 'ARS', false, null)$$, '42501', null, 'sin edición no guarda');
select throws_ok(format($$select public.anular_gasto(%L, 'x', now())$$, (select id from ids where clave = 'g1')), '42501', null, 'sin edición no anula');
select is((select count(*)::int from public.listar_gastos()), 2, 'con lectura lista solo la empresa asignada (A1: g1 y g2)');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000003');
select throws_ok($$select * from public.listar_gastos()$$, '42501', null, 'sin la sección no lista');
select throws_ok($$select public.resumen_gastos()$$, '42501', null, 'sin la sección no resume');
reset role;
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Anulación (CA-GAS-6): motivo obligatorio, idempotente, no se edita y no cuenta.
select throws_ok(format($$select public.anular_gasto(%L, '  ', %L)$$, (select id from ids where clave = 'g3'), (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g3'))),
  '22023', null, 'sin motivo se rechaza');
select throws_ok(format($$select public.anular_gasto(%L, 'Cargado por error', '2020-01-01')$$, (select id from ids where clave = 'g3')),
  '40001', null, 'anular con versión vieja: 40001');
select public.anular_gasto((select id from ids where clave = 'g3'), 'Cargado por error', (select updated_at from dominio.gastos where id = (select id from ids where clave = 'g3')));
select is((select count(*)::int from dominio.gastos where anulado_en is not null and motivo_anulacion = 'Cargado por error'), 1, 'queda anulado con motivo');
select lives_ok(format($$select public.anular_gasto(%L, 'otra vez', now())$$, (select id from ids where clave = 'g3')), 'anular de nuevo no falla');
select is((select count(*)::int from public.registro_actividad where tipo = 'gasto.anulado'), 1, 'un solo evento de anulación');
select is((select count(*)::int from public.registro_actividad
            where tipo = 'gasto.anulado' and (detalle ~ 'error|[0-9]{3}' or valor_nuevo::text ~ 'error|[0-9]{3}' or valor_nuevo ? 'motivo' or valor_nuevo ? 'importe')), 0,
  'la anulación no deja el motivo ni cifras en Actividad');
select throws_ok(format($$select public.guardar_gasto(%L, 'e1000000-0000-0000-0000-000000000002', '2026-03-12', 'Insumos', 'variable', null, 10, 'USD', false, now())$$, (select id from ids where clave = 'g3')),
  '22023', null, 'un gasto anulado no se edita');

-- Listado con cursor, filtros, resumen (RF-GAS-6, RF-GAS-7).
select is((select count(*)::int from public.listar_gastos('2026-03-01', '2026-03-31')), 3, 'lista los vigentes del período');
select is((select count(*)::int from public.listar_gastos('2026-03-01', '2026-03-31', null, null, null, true)), 4, 'con anulados suma el anulado');
select is((select fecha::text from public.listar_gastos('2026-03-01', '2026-03-31', p_limite => 1)), '2026-03-06', 'orden fecha desc');
select is((select fecha::text from public.listar_gastos('2026-03-01', '2026-03-31', null, null, null, false, '2026-03-06', (select id from ids where clave = 'g1'), 1)), '2026-03-05', 'el cursor devuelve la tanda siguiente');
select is((select count(*)::int from public.listar_gastos('2026-03-01', '2026-03-31', null, 'Alquiler')), 2, 'filtro por categoría');
select is((select count(*)::int from public.listar_gastos('2026-03-01', '2026-03-31', null, null, 'variable')), 0, 'filtro por tipo (el variable está anulado)');
select is((select public.resumen_gastos('2026-03-01', '2026-03-31') ->> 'total'), (540000 + (select importe_pesos from dominio.gastos where id = (select id from ids where clave = 'g4')))::numeric(14,2)::text, 'total en pesos sin anulados (40.000 + 500.000 + g4)');
select is((select jsonb_array_length(public.resumen_gastos('2026-03-01', '2026-03-31') -> 'desglose')), 2, 'desglose por categoría y tipo');
select is((select (public.resumen_gastos('2026-03-01', '2026-03-31') ->> 'conteo_anulados')::int), 1, 'cuenta los anulados aparte');

-- Administrador acotado a una tienda (CA-GAS-8): con edición en rentabilidad pero asignado solo a A1, no carga ni edita en A2.
reset role;
insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel) values
  ('11111111-1111-1111-1111-111111111111', 'administracion', 'rentabilidad', 'edicion')
  on conflict (organizacion_id, rol_id, seccion) do update set nivel = 'edicion';
select pg_temp.como('d1000000-0000-0000-0000-000000000002');
select lives_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000001', '2025-01-05', 'Otros', 'variable', null, 7, 'ARS', false, null)$$, 'acotado: carga en su tienda');
select throws_ok($$select public.guardar_gasto(null, 'e1000000-0000-0000-0000-000000000002', '2026-03-05', 'Otros', 'variable', null, 7, 'ARS', false, null)$$,
  '42501', null, 'acotado: no carga en otra tienda de la organización');
select throws_ok(format($$select public.guardar_gasto(%L, 'e1000000-0000-0000-0000-000000000001', '2026-03-12', 'Insumos', 'variable', null, 10, 'ARS', false, now())$$, (select id from ids where clave = 'g4')),
  '42501', null, 'acotado: no edita un gasto de otra tienda');
select throws_ok(format($$select public.anular_gasto(%L, 'x', now())$$, (select id from ids where clave = 'g4')), '42501', null, 'acotado: no anula un gasto de otra tienda');
select throws_ok($$select public.exportar_gastos(null, null, 'e1000000-0000-0000-0000-000000000002')$$, '42501', null,
  'acotado: exportar una tienda no accesible se rechaza sin revelar su nombre');
reset role;
select is((select count(*)::int from public.registro_actividad where tipo = 'gasto.exportado' and detalle like '%Tienda A2%'), 0, 'el nombre de la tienda no accesible no queda en Actividad');
select pg_temp.como('d1000000-0000-0000-0000-000000000001');

-- Exportación (RF-GAS-9).
select is((select (public.exportar_gastos('2026-03-01', '2026-03-31') ->> 'total')::int), 3, 'exporta las filas filtradas');
select is((select count(*)::int from public.registro_actividad where tipo = 'gasto.exportado'), 1, 'deja gasto.exportado en Actividad');

select * from finish();
rollback;
