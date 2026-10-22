-- F-SVC-03 (MSF-303, épica MSF-182): cambio de estado de una reparación (`cambiar_estado_reparacion`).
-- Esquema: sin tablas nuevas (usa `dominio.reparaciones` y `dominio.reparacion_historial`;
-- Principio VII: ambas siguen en `dominio` con RLS por organización).
--
-- SECURITY DEFINER (las tablas no admiten escritura directa) con control explícito: organización de la
-- sesión, nivel `edicion` de `service_tecnico` y tienda accesible (FR-034). Bloquea la fila
-- (`for update`) para serializar cambios simultáneos. Rechaza reparaciones anuladas o ya cerradas por
-- entrega (55000), estados inexistentes, de otra organización o inactivos (22023, hint `estado_id`) y
-- estados que cierran (esos pasan por `registrar_entrega_reparacion`). Idempotente: elegir el estado
-- actual devuelve la reparación sin duplicar historial. Escribe el evento `estado` con estado
-- anterior, nuevo, usuario y fecha (`clock_timestamp()`: orden estable dentro de una transacción) en la
-- misma transacción.
--
-- Incluye `historial_reparacion` (FR-030): lectura del historial con los nombres de los estados y del
-- usuario (`security definer`: el nombre del usuario no se lee con RLS). Exige `lectura` o `edicion` y
-- una tienda accesible; más reciente primero; sin identificadores técnicos en lo visible.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.historial_reparacion(uuid);
--   drop function public.cambiar_estado_reparacion(uuid, uuid);

create or replace function public.cambiar_estado_reparacion(p_id uuid, p_estado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_cierra_actual boolean;
  v_nuevo dominio.estados_reparacion;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de reparaciones' using errcode = '42501';
  end if;

  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede modificar' using errcode = '55000';
  end if;
  select s.cierra into v_cierra_actual
    from dominio.estados_reparacion s
   where s.id = v_actual.estado_id and s.organizacion_id = v_org;
  if v_actual.entrega_real is not null or coalesce(v_cierra_actual, false) then
    raise exception 'La reparación ya fue entregada o cerrada y no admite más cambios de estado' using errcode = '55000';
  end if;

  if p_estado_id is null then
    raise exception 'Elegí el estado' using errcode = '22023', hint = 'estado_id';
  end if;
  select * into v_nuevo
    from dominio.estados_reparacion s
   where s.id = p_estado_id and s.organizacion_id = v_org;
  if not found or not v_nuevo.activo then
    raise exception 'El estado no existe o está desactivado' using errcode = '22023', hint = 'estado_id';
  end if;

  -- Idempotente: el estado actual no duplica historial.
  if v_nuevo.id = v_actual.estado_id then
    return private.reparacion_json(p_id);
  end if;
  if v_nuevo.cierra then
    raise exception 'Para cerrar la reparación registrá la entrega' using errcode = '22023', hint = 'estado_id';
  end if;

  update dominio.reparaciones set estado_id = v_nuevo.id where id = p_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, usuario_id, creado_en)
  values (v_org, p_id, 'estado', v_actual.estado_id, v_nuevo.id, (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$$;

comment on function public.cambiar_estado_reparacion(uuid, uuid) is
  'F-SVC-03: cambia el estado (activo, de la organización); idempotente; rechaza anuladas y cerradas (55000) y estados que cierran (van por entrega). Solo con edición en Service técnico.';

revoke execute on function public.cambiar_estado_reparacion(uuid, uuid) from public, anon;
grant execute on function public.cambiar_estado_reparacion(uuid, uuid) to authenticated;

create or replace function public.historial_reparacion(p_id uuid)
returns table (
  id uuid,
  tipo text,
  estado_anterior text,
  estado_nuevo text,
  nota text,
  usuario text,
  creado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el historial' using errcode = '42501';
  end if;
  if not exists (
    select 1 from dominio.reparaciones r
     where r.id = p_id
       and r.organizacion_id = (select private.organizacion_id())
       and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  return query
    select h.id, h.tipo, a.nombre, n.nombre, h.nota,
           coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), u.email::text),
           h.creado_en
      from dominio.reparacion_historial h
      left join dominio.estados_reparacion a on a.id = h.estado_anterior_id and a.organizacion_id = h.organizacion_id
      left join dominio.estados_reparacion n on n.id = h.estado_nuevo_id and n.organizacion_id = h.organizacion_id
      left join auth.users u on u.id = h.usuario_id
      left join public.perfiles_usuario p on p.user_id = h.usuario_id
     where h.reparacion_id = p_id
       and h.organizacion_id = (select private.organizacion_id())
     order by h.creado_en desc, h.id desc;
end;
$$;

comment on function public.historial_reparacion(uuid) is
  'F-SVC-03: historial de una reparación (tipo, estados por nombre, nota, usuario, fecha), más reciente primero. Requiere lectura o edición y tienda accesible.';

revoke execute on function public.historial_reparacion(uuid) from public, anon;
grant execute on function public.historial_reparacion(uuid) to authenticated;
