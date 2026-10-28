-- F-SVC-14 (MSF-424, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-021, FR-023, FR-027, FR-029):
-- `public.avisar_cliente_reparacion`, el aviso por correo al cliente por el estado de su reparación.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.reparacion_avisos` (`dominio`, 20270115020100) y,
-- para el despacho, las tablas de plataforma `public.capacidades_ejecucion`, `public.ejecuciones_worker` y
-- `public.despachos_ejecucion` (la outbox, solo por esta RPC). Lee `dominio.reparaciones`, `estados_reparacion` y
-- `public.clientes`.
--
-- Qué hace, en UNA transacción: toma la reparación `for update` (serializa el doble clic y a dos operadores), arma el
-- aviso `pendiente` del estado pedido (por defecto, el actual) con el correo ACTUAL del cliente y deja la orden de
-- despacho en la outbox (capacidad `enviar-aviso-reparacion-<aviso>`, ejecución `manual` auditable), igual que
-- `enviar_presupuesto_correo`. El flow `reparaciones-aviso-correo` reclama ese prefijo.
--
-- Resultado: `{ resultado: 'encolado' | 'sin_correo', aviso_id }`. Cliente sin correo válido → `sin_correo`, no se
-- encola nada (FR-023). Idempotente: con un aviso pendiente del mismo estado devuelve ese (`encolado`).
-- Permisos: `service_tecnico` en `edicion` y tienda accesible (42501); reparación inexistente (P0002); anulada
-- (55000); estado inexistente (22023); organización sin la conexión de envíos (P0001, hint `sin_conexion`).
-- La organización y el actor salen de la sesión. `revoke … from public, anon` y `grant execute … to authenticated`.
--
-- La conexión es la `comprobantes-pdf` que ya usa el envío de presupuestos (spec 019): sin proveedor ni conexión nuevos.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.avisar_cliente_reparacion(uuid, uuid);

create or replace function public.avisar_cliente_reparacion(p_reparacion uuid, p_estado_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rep dominio.reparaciones;
  v_estado dominio.estados_reparacion;
  v_correo text;
  v_aviso dominio.reparacion_avisos;
  v_conexion uuid;
  v_capacidad uuid;
  v_ejecucion uuid;
begin
  if v_org is null or v_actor is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede avisar a los clientes de las reparaciones' using errcode = '42501';
  end if;
  if p_reparacion is null then
    raise exception 'Indicá la reparación' using errcode = '22023';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org
   for update;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if v_rep.anulada_en is not null then
    raise exception 'La reparación está anulada: no se puede avisar al cliente' using errcode = '55000';
  end if;

  select * into v_estado
    from dominio.estados_reparacion s
   where s.id = coalesce(p_estado_id, v_rep.estado_id) and s.organizacion_id = v_org;
  if not found then
    raise exception 'El estado no existe' using errcode = '22023', hint = 'estado_id';
  end if;

  select nullif(btrim(cl.correo), '') into v_correo
    from public.clientes cl
   where cl.id = v_rep.cliente_id and cl.organizacion_id = v_org;
  -- Sin correo válido no hay a quién avisar: no se crea nada (FR-023).
  if v_correo is null
     or length(v_correo) > 320
     or v_correo !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then
    return jsonb_build_object('resultado', 'sin_correo', 'aviso_id', null);
  end if;

  -- Un pendiente que ya no puede completarse se cierra como fallido; así «Reenviar» no queda bloqueado.
  perform private.expirar_avisos_reparacion(v_rep.id);

  select * into v_aviso
    from dominio.reparacion_avisos a
   where a.reparacion_id = v_rep.id and a.estado_id = v_estado.id and a.estado_envio = 'pendiente';
  if found then
    return jsonb_build_object('resultado', 'encolado', 'aviso_id', v_aviso.id);
  end if;

  select c.id into v_conexion
    from public.conexiones c
   where c.organizacion_id = v_org and c.sistema_externo = 'comprobantes-pdf' and c.estado = 'activa'
   order by c.created_at desc
   limit 1;
  if v_conexion is null then
    raise exception 'El envío de avisos todavía no está habilitado para tu organización. Pedile a un administrador que lo active.'
      using errcode = 'P0001', hint = 'sin_conexion';
  end if;

  insert into dominio.reparacion_avisos
    (organizacion_id, empresa_id, reparacion_id, estado_id, estado_nombre, destinatario, solicitado_por)
  values (v_org, v_rep.empresa_id, v_rep.id, v_estado.id, v_estado.nombre, v_correo, v_actor)
  returning * into v_aviso;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, 'enviar-aviso-reparacion-' || v_aviso.id::text, 900)
  returning id into v_capacidad;

  insert into public.ejecuciones_worker (organizacion_id, conexion_id, capacidad_id, origen, actor, detalle)
  values (v_org, v_conexion, v_capacidad, 'manual', v_actor, jsonb_build_object('aviso_id', v_aviso.id))
  returning id into v_ejecucion;

  insert into public.despachos_ejecucion (ejecucion_id, organizacion_id) values (v_ejecucion, v_org);

  update dominio.reparacion_avisos a set ejecucion_id = v_ejecucion where a.id = v_aviso.id;

  perform private.registrar_actividad(
    'reparacion.aviso_solicitado',
    format('Pidió avisar al cliente de la reparación %s (estado «%s»)', private.codigo_reparacion(v_rep.numero), v_estado.nombre),
    v_rep.empresa_id
  );
  return jsonb_build_object('resultado', 'encolado', 'aviso_id', v_aviso.id);
end;
$$;

revoke execute on function public.avisar_cliente_reparacion(uuid, uuid) from public, anon;
grant execute on function public.avisar_cliente_reparacion(uuid, uuid) to authenticated;

comment on function public.avisar_cliente_reparacion(uuid, uuid) is
  'F-SVC-14: encola el aviso por correo al cliente por el estado (por defecto el actual) de una reparación, con su orden de despacho en la misma transacción; sin correo no encola; idempotente por reparación y estado. Exige service_tecnico en edición y tienda accesible.';
