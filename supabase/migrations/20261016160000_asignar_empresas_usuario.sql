-- F-ROL-07 · Asignar empresas y rol por empresa desde Usuarios (épica MSF-121, spec
-- 20261016-140000-permisos-por-empresa, FR-015…FR-018).
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   usuarios_empresas              public  (existente, F-ROL-04) solo se escribe desde estas RPC
--   usuario_empresa_activa         public  (existente, F-ROL-04) se fija la primera empresa si no hay activa válida
--   invitaciones_organizacion      public  (existente) se agrega la columna `asignaciones` (plataforma, aditiva)
--   dominio.empresas               dominio (existente) solo se lee
-- No crea tablas. Funciones RPC en `public`, helpers en `private`.
--
-- Migración aditiva (una columna con default, funciones nuevas y create or replace de
-- aceptar_invitacion con el mismo contrato). Camino de reversión (no se ejecuta en el mismo PR):
--   drop function public.listar_empresas_usuarios();
--   drop function public.guardar_asignaciones_invitacion(uuid, jsonb);
--   drop function public.asignar_empresas_usuario(uuid, jsonb);
--   drop function private.aplicar_asignaciones(uuid, uuid, jsonb);
--   drop function private.validar_asignaciones(uuid, jsonb);
--   restaurar public.aceptar_invitacion() a 20261013160001_invitaciones_aceptar_estricto.sql;
--   alter table public.invitaciones_organizacion drop column asignaciones;  (pierde las asignaciones pendientes)

alter table public.invitaciones_organizacion
  add column asignaciones jsonb not null default '[]'::jsonb
    constraint invitaciones_asignaciones_es_arreglo check (jsonb_typeof(asignaciones) = 'array');

comment on column public.invitaciones_organizacion.asignaciones is
  'F-ROL-07: [{"empresa_id": uuid, "rol_id": text}] que se aplican en usuarios_empresas al aceptar la invitación.';

-- ============================================================================
-- Validación común (FR-015, FR-017): arreglo de {empresa_id, rol_id}; rol entre los cinco por
-- empresa, empresa de la organización, sin repetir empresa. Devuelve las filas normalizadas.
-- Errores: 22023 formato/rol/duplicada inválidos; 42501 empresa de otra organización.
-- ============================================================================

create or replace function private.validar_asignaciones(p_organizacion_id uuid, p_asignaciones jsonb)
returns table (empresa_id uuid, rol_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_empresa uuid;
  v_rol text;
  v_vistas uuid[] := '{}';
begin
  if p_asignaciones is null or jsonb_typeof(p_asignaciones) <> 'array' then
    raise exception 'Las asignaciones deben ser una lista' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_asignaciones) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'empresa_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Asignación inválida' using errcode = '22023';
    end if;
    v_empresa := (v_item ->> 'empresa_id')::uuid;
    v_rol := v_item ->> 'rol_id';
    if v_rol is null or v_rol not in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion') then
      raise exception 'Rol inválido para una empresa' using errcode = '22023';
    end if;
    if v_empresa = any (v_vistas) then
      raise exception 'Empresa repetida' using errcode = '22023';
    end if;
    v_vistas := v_vistas || v_empresa;
    if not exists (
      select 1 from dominio.empresas e
      where e.id = v_empresa and e.organizacion_id = p_organizacion_id
    ) then
      raise exception 'Empresa fuera de la organización' using errcode = '42501';
    end if;
    empresa_id := v_empresa;
    rol_id := v_rol;
    return next;
  end loop;
end;
$$;

revoke execute on function private.validar_asignaciones(uuid, jsonb) from public, anon, authenticated;

-- Aplica (reemplaza) las asignaciones de un usuario y fija la primera empresa como activa si
-- no tiene una válida (FR-018). Valida antes de borrar: si algo falla no cambia nada.
create or replace function private.aplicar_asignaciones(p_user_id uuid, p_organizacion_id uuid, p_asignaciones jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primera uuid;
  v_activa_valida boolean;
  v_total integer;
begin
  perform 1 from private.validar_asignaciones(p_organizacion_id, p_asignaciones);

  delete from public.usuarios_empresas ue where ue.user_id = p_user_id;

  insert into public.usuarios_empresas (user_id, empresa_id, organizacion_id, rol_id)
  select p_user_id, v.empresa_id, p_organizacion_id, v.rol_id
  from private.validar_asignaciones(p_organizacion_id, p_asignaciones) v;
  get diagnostics v_total = row_count;

  if v_total = 0 then
    return 0;
  end if;

  select exists (
    select 1 from public.usuario_empresa_activa a
    join public.usuarios_empresas ue on ue.user_id = a.user_id and ue.empresa_id = a.empresa_id
    join dominio.empresas e on e.id = a.empresa_id and e.activa
    where a.user_id = p_user_id
  ) into v_activa_valida;

  if not v_activa_valida then
    select ue.empresa_id into v_primera
    from public.usuarios_empresas ue
    join dominio.empresas e on e.id = ue.empresa_id and e.activa
    where ue.user_id = p_user_id
    order by e.nombre, ue.empresa_id
    limit 1;
    if v_primera is not null then
      insert into public.usuario_empresa_activa (user_id, empresa_id, updated_at)
      values (p_user_id, v_primera, now())
      on conflict (user_id) do update
        set empresa_id = excluded.empresa_id, updated_at = excluded.updated_at;
    end if;
  end if;
  return v_total;
end;
$$;

revoke execute on function private.aplicar_asignaciones(uuid, uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- asignar_empresas_usuario (FR-015, FR-018)
-- Solo quien gestiona membresías (Administrador) de la organización activa. Reemplazo atómico:
-- una sola transacción borra e inserta; si algo falla no cambia nada. El Administrador de
-- destino no lleva filas (accede a todas): se rechaza asignarle empresas.
-- Errores: 42501 sin permiso o empresa ajena; 22023 formato/rol/duplicada o destino Administrador;
-- P0002 usuario fuera de la organización.
-- ============================================================================

create or replace function public.asignar_empresas_usuario(p_target_user_id uuid, p_asignaciones jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rol text;
  v_total integer;
  v_persona text;
begin
  if v_org is null or not (select private.puede_gestionar_membresias(v_org)) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  if p_target_user_id is null then
    raise exception 'El usuario es obligatorio' using errcode = '22023';
  end if;

  select u.rol_id into v_rol
  from public.usuarios_organizacion u
  where u.user_id = p_target_user_id and u.organizacion_id = v_org;
  if not found then
    raise exception 'El usuario no pertenece a la organización' using errcode = 'P0002';
  end if;

  -- Serializa asignaciones del mismo usuario (y su empresa activa).
  perform pg_advisory_xact_lock(hashtext(p_target_user_id::text));

  if v_rol = 'administrador' and jsonb_typeof(coalesce(p_asignaciones, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_asignaciones) > 0 then
    raise exception 'El Administrador accede a todas las empresas: no lleva asignaciones' using errcode = '22023';
  end if;

  v_total := private.aplicar_asignaciones(p_target_user_id, v_org, p_asignaciones);

  select coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'un usuario') into v_persona
  from (select 1) x
  left join public.perfiles_usuario p on p.user_id = p_target_user_id;

  perform private.registrar_actividad(
    'usuario.empresas_asignadas',
    case when v_total = 0
      then 'Quitó las empresas asignadas a ' || v_persona
      else 'Asignó ' || v_total || (case when v_total = 1 then ' empresa' else ' empresas' end) || ' a ' || v_persona
    end,
    null
  );
  return v_total;
end;
$$;

comment on function public.asignar_empresas_usuario(uuid, jsonb) is
  'F-ROL-07: el Administrador reemplaza de forma atómica las empresas y el rol por empresa de un usuario; fija la primera como activa si no hay una válida y registra usuario.empresas_asignadas en la misma transacción. Único camino de escritura de usuarios_empresas.';

revoke execute on function public.asignar_empresas_usuario(uuid, jsonb) from public, anon;
grant execute on function public.asignar_empresas_usuario(uuid, jsonb) to authenticated;

-- ============================================================================
-- guardar_asignaciones_invitacion (FR-017)
-- La edge function la llama tras registrar_invitacion: deja las asignaciones en la invitación
-- pendiente y se aplican al aceptarla. Valida igual que la asignación directa.
-- ============================================================================

create or replace function public.guardar_asignaciones_invitacion(p_invitacion_id uuid, p_asignaciones jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_inv public.invitaciones_organizacion;
begin
  if v_org is null or not (select private.puede_gestionar_membresias(v_org)) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  select * into v_inv from public.invitaciones_organizacion i
  where i.id = p_invitacion_id and i.organizacion_id = v_org and i.estado = 'pendiente' for update;
  if not found then
    raise exception 'Invitación inexistente o no pendiente' using errcode = 'P0002';
  end if;
  if v_inv.rol_id = 'administrador' and jsonb_typeof(coalesce(p_asignaciones, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_asignaciones) > 0 then
    raise exception 'El Administrador accede a todas las empresas: no lleva asignaciones' using errcode = '22023';
  end if;
  perform 1 from private.validar_asignaciones(v_org, p_asignaciones);
  update public.invitaciones_organizacion
    set asignaciones = p_asignaciones, updated_at = now()
    where id = v_inv.id;
end;
$$;

revoke execute on function public.guardar_asignaciones_invitacion(uuid, jsonb) from public, anon;
grant execute on function public.guardar_asignaciones_invitacion(uuid, jsonb) to authenticated;

-- ============================================================================
-- aceptar_invitacion: mismo contrato de 20261013160001 + aplica las asignaciones de la invitación.
-- ============================================================================

create or replace function public.aceptar_invitacion()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.invitaciones_organizacion;
  v_rol text;
begin
  if v_uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  select i.* into v_inv from public.invitaciones_organizacion i
  join auth.users u on u.id = i.auth_user_id and lower(u.email) = i.email
  where i.auth_user_id = v_uid and i.estado = 'pendiente' for update of i;
  if not found then
    -- Reintento: la cuenta ya aceptó esta invitación (la membresía existe) → mismo resultado.
    select m.rol_id into v_rol from public.usuarios_organizacion m
    join public.invitaciones_organizacion i
      on i.auth_user_id = m.user_id and i.organizacion_id = m.organizacion_id and i.estado = 'aceptada'
    where m.user_id = v_uid limit 1;
    if v_rol is not null then
      return v_rol;
    end if;
    raise exception 'Invitación cancelada o inexistente' using errcode = 'P0002';
  end if;
  if v_inv.vence_en <= now() then
    raise exception 'La invitación venció' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.usuarios_organizacion where user_id = v_uid) then
    raise exception 'No se puede aceptar la invitación' using errcode = '23505';
  end if;
  insert into public.usuarios_organizacion (user_id, organizacion_id, rol_id)
  values (v_uid, v_inv.organizacion_id, v_inv.rol_id);
  -- F-ROL-07 (FR-017): las empresas y roles elegidos al invitar.
  if v_inv.rol_id <> 'administrador' and jsonb_array_length(v_inv.asignaciones) > 0 then
    perform private.aplicar_asignaciones(v_uid, v_inv.organizacion_id, v_inv.asignaciones);
  end if;
  update public.invitaciones_organizacion set estado = 'aceptada', updated_at = now() where id = v_inv.id;
  insert into public.eventos_membresia (organizacion_id, actor_user_id, target_user_id, target_email, accion, rol_nuevo)
  values (v_inv.organizacion_id, v_uid, v_uid, v_inv.email, 'miembro_agregado', v_inv.rol_id);
  return v_inv.rol_id;
end;
$$;

-- ============================================================================
-- listar_empresas_usuarios (FR-016): tiendas y rol por tienda de cada usuario, para la lista.
-- Solo quien gestiona membresías; el chequeo vive dentro de la función.
-- ============================================================================

create or replace function public.listar_empresas_usuarios()
returns table (user_id uuid, empresa_id uuid, empresa_nombre text, rol_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select private.organizacion_id() as organizacion_id)
  select ue.user_id, ue.empresa_id, e.nombre, ue.rol_id
  from v
  join public.usuarios_empresas ue on ue.organizacion_id = v.organizacion_id
  join dominio.empresas e on e.id = ue.empresa_id
  where v.organizacion_id is not null
    and private.puede_gestionar_membresias(v.organizacion_id)
  order by e.nombre;
$$;

comment on function public.listar_empresas_usuarios() is
  'F-ROL-07: empresas y rol por empresa de los usuarios de la organización activa; solo para quien gestiona membresías.';

revoke execute on function public.listar_empresas_usuarios() from public, anon;
grant execute on function public.listar_empresas_usuarios() to authenticated;
