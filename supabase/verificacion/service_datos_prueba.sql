-- F-SVC-23 (MSF-168, FR-066): datos de prueba REPRODUCIBLES para revisar el tablero «Service técnico».
-- Fuera de las migraciones: nada de esto viaja a staging ni producción.
-- SOLO contra la base LOCAL de `pnpm dev:supabase`: nunca apuntar $DATABASE_URL a una base compartida.
-- Idempotente: si la organización de prueba ya tiene reparaciones, no vuelve a crearlas (correrlo dos veces
-- deja los mismos conteos). Para empezar de cero: `delete from public.organizaciones where id = '…0168'`.
-- Uso (con `pnpm dev:supabase` corriendo):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verificacion/service_datos_prueba.sql
--
-- Conteos esperados (organización «Org Service prueba», 12 reparaciones, ingresos relativos a hoy):
--   por tienda:  Tienda Norte 6 · Tienda Sur 6
--   por estado:  Recibido 3 · En diagnóstico 2 · En reparación 3 · Listo para entregar 2 · Entregado 2
--   por técnico: Ana Pérez 5 · Luis Gómez 4 · Sin técnico asignado 3
--   ítems:       18 (12 de mano de obra · 6 de repuesto)
-- Se comprueba con las consultas del final (como el rol de Superset, sobre `analitica.service_*`).
do $$
declare
  c_org constant uuid := '00000000-0000-0000-0000-000000000168';
  c_ana constant uuid := '00000000-0000-0000-0000-0000000a0168';
  c_luis constant uuid := '00000000-0000-0000-0000-0000000b0168';
  c_norte constant uuid := '00000000-0000-0000-0000-0000000c0168';
  c_sur constant uuid := '00000000-0000-0000-0000-0000000d0168';
  c_cliente constant uuid := '00000000-0000-0000-0000-0000000e0168';
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_modelo uuid;
  v_id uuid;
  v_estado uuid;
  r record;
begin
  if exists (select 1 from dominio.reparaciones where organizacion_id = c_org) then
    raise notice 'Datos de prueba de Service ya cargados: no se repiten.';
    return;
  end if;

  insert into public.organizaciones (id, nombre) values (c_org, 'Org Service prueba') on conflict do nothing;
  insert into auth.users (id, email) values
    (c_ana, 'ana.service@ejemplo.test'), (c_luis, 'luis.service@ejemplo.test') on conflict do nothing;
  insert into public.perfiles_usuario (user_id, nombre, apellido) values
    (c_ana, 'Ana', 'Pérez'), (c_luis, 'Luis', 'Gómez') on conflict (user_id) do nothing;
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
    (c_ana, c_org, 'administrador', 'activo'), (c_luis, c_org, 'operador', 'activo') on conflict do nothing;
  insert into dominio.empresas (id, organizacion_id, nombre) values
    (c_norte, c_org, 'Tienda Norte'), (c_sur, c_org, 'Tienda Sur') on conflict do nothing;
  insert into public.clientes (id, organizacion_id, numero, nombre, tipo)
    values (c_cliente, c_org, 1, 'Cliente de prueba', 'minorista') on conflict do nothing;

  select id into v_modelo from dominio.modelos_equipo where organizacion_id = c_org order by equipo, modelo limit 1;

  -- Todas las altas pasan por las RPC (como la app): numeración, historial y totales reales.
  perform set_config('request.jwt.claims', json_build_object('sub', c_ana, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (tienda, técnico, estado, meses atrás, ítems de mano de obra, ítems de repuesto)
  for r in
    select * from (values
      (1, c_norte, c_ana,  'Recibido',            0, 1, 0),
      (2, c_norte, c_ana,  'Recibido',            0, 1, 0),
      (3, c_norte, null,   'Recibido',            1, 1, 0),
      (4, c_norte, c_ana,  'En diagnóstico',      1, 1, 1),
      (5, c_norte, c_luis, 'En reparación',       2, 1, 1),
      (6, c_norte, c_luis, 'Entregado',           3, 1, 1),
      (7, c_sur,   c_ana,  'En diagnóstico',      0, 1, 0),
      (8, c_sur,   c_luis, 'En reparación',       1, 1, 1),
      (9, c_sur,   c_luis, 'En reparación',       2, 1, 1),
      (10, c_sur,  null,   'Listo para entregar', 2, 1, 0),
      (11, c_sur,  null,   'Listo para entregar', 3, 1, 1),
      (12, c_sur,  c_ana,  'Entregado',           3, 1, 0)
    ) as t (n, empresa, tecnico, estado, meses, mano_obra, repuesto)
  loop
    select (public.crear_reparacion(r.empresa, c_cliente, v_modelo, p_numero_serie => 'PRUEBA-' || r.n,
      p_tecnico_id => r.tecnico)->>'id')::uuid into v_id;
    perform public.agregar_item_reparacion(v_id, 'mano_obra', 'Mano de obra de prueba', null, 1, 10000 + r.n * 500);
    if r.repuesto = 1 then
      perform public.agregar_item_reparacion(v_id, 'repuesto', 'Repuesto de prueba', null, 2, 3000 + r.n * 100);
    end if;
    select id into v_estado from dominio.estados_reparacion where organizacion_id = c_org and nombre = r.estado;
    if r.estado = 'Entregado' then
      -- Los estados que cierran pasan por la entrega (fecha y quién entregó).
      perform public.registrar_entrega_reparacion(v_id, v_estado, v_hoy, 'Cliente de prueba');
    elsif r.estado <> 'Recibido' then
      perform public.cambiar_estado_reparacion(v_id, v_estado);
    end if;
    -- El ingreso se retrasa en el dueño de la tabla (la RPC siempre ingresa «hoy»), para ver meses distintos.
    reset role;
    update dominio.reparaciones set ingreso_en = (v_hoy - (r.meses * 31)) where id = v_id;
    perform set_config('request.jwt.claims', json_build_object('sub', c_ana, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end loop;
  reset role;
end
$$;

-- Verificación (rol de Superset, sobre las vistas del tablero).
set role superset_analitica;
select empresa_nombre, count(*) as reparaciones from analitica.service_reparaciones
 where organizacion_id = '00000000-0000-0000-0000-000000000168' group by 1 order by 1;
select estado_nombre, count(*) as reparaciones from analitica.service_reparaciones
 where organizacion_id = '00000000-0000-0000-0000-000000000168' group by 1 order by 1;
select coalesce(tecnico_nombre, 'Sin técnico asignado') as tecnico, count(*) as reparaciones from analitica.service_reparaciones
 where organizacion_id = '00000000-0000-0000-0000-000000000168' group by 1 order by 1;
select tipo, count(*) as items, sum(subtotal) as subtotal from analitica.service_reparacion_items
 where organizacion_id = '00000000-0000-0000-0000-000000000168' group by 1 order by 1;
reset role;
