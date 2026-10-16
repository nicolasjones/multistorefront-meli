-- MSF-463 · F-AUD-01 (épica MSF-455, spec 20261016-120000-actividad-y-ambientes,
-- FR-001…FR-007): registro transversal de actividad e historial.
--
-- Esquema (Principio VII): `public.registro_actividad` vive en `public`
-- (plataforma: lo escriben todos los componentes y no es una entidad de
-- negocio, igual que `eventos_membresia`). No se crea ninguna tabla en
-- `dominio`. RLS por organización y por `private.nivel_seccion('actividad')`;
-- solo `select` para `authenticated`; nada para `anon`; sin policies de
-- escritura: se agrega únicamente por `private.registrar_actividad` /
-- `public.registrar_actividad`.
--
-- Migración aditiva. Además de la tabla y sus funciones, reemplaza
-- `public.guardar_matriz_permisos` y `public.restablecer_matriz_permisos`
-- (solo cambia el `raise log` por el registro del evento) y agrega un trigger
-- sobre `eventos_membresia` que refleja los eventos de Acceso sin tocar las
-- RPC que los generan.
--
-- Reversión (en una migración posterior, no en el mismo PR):
--   drop trigger registrar_actividad_membresia on public.eventos_membresia;
--   drop function private.registrar_actividad_membresia();
--   restaurar guardar_matriz_permisos / restablecer_matriz_permisos de
--     20261013140000_editar_matriz_permisos.sql;
--   drop function public.opciones_actividad();
--   drop function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer);
--   drop function public.registrar_actividad(text, text, uuid);
--   drop function private.registrar_actividad(text, text, uuid);
--   drop function private.insertar_actividad(uuid, uuid, text, text, uuid);
--   drop function private.etiqueta_rol(text);
--   drop table public.registro_actividad;   (pierde el historial: exportarlo antes)

-- ============================================================================
-- Tabla (FR-001)
-- ============================================================================

create table public.registro_actividad (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Sin FK: la empresa vive en `dominio` y el historial debe sobrevivirla.
  empresa_id uuid,
  -- Sin FK a auth.users: el historial conserva al actor aunque se borre su cuenta.
  actor_id uuid,
  -- Foto del nombre visible del actor al registrar (el perfil es self-only por RLS).
  actor_nombre text,
  tipo text not null check (tipo ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and length(tipo) <= 60),
  detalle text not null check (btrim(detalle) <> '' and length(detalle) <= 500),
  creado_en timestamptz not null default now()
);

comment on table public.registro_actividad is
  'Historial de actividad de la organización (F-AUD-01). Solo de agregado: se escribe únicamente con registrar_actividad; nadie edita ni borra desde la app.';
comment on column public.registro_actividad.tipo is
  'Formato entidad.accion (p. ej. producto.creado, empresa.pausada).';

create index registro_actividad_org_fecha_idx on public.registro_actividad (organizacion_id, creado_en desc);
create index registro_actividad_org_tipo_fecha_idx on public.registro_actividad (organizacion_id, tipo, creado_en desc);
create index registro_actividad_org_actor_fecha_idx on public.registro_actividad (organizacion_id, actor_id, creado_en desc);
create index registro_actividad_org_empresa_fecha_idx on public.registro_actividad (organizacion_id, empresa_id, creado_en desc);

alter table public.registro_actividad enable row level security;

create policy registro_actividad_select on public.registro_actividad
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('actividad')) in ('lectura', 'edicion')
  );

revoke all on public.registro_actividad from public, anon, authenticated;
grant select on public.registro_actividad to authenticated;

-- ============================================================================
-- Registro (FR-002)
-- ============================================================================

-- Etiqueta visible de un rol para armar el detalle de los eventos de Acceso.
create or replace function private.etiqueta_rol(p_rol text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rol is null then 'sin rol'
    when p_rol = 'deposito' then 'Depósito'
    when p_rol = 'administracion' then 'Administración'
    else initcap(replace(p_rol, '_', ' '))
  end;
$$;

-- Escritura interna: organización y actor llegan por parámetro (los fija quien
-- llama, siempre desde el servidor). Nunca expuesta a la API ni a `anon`.
create or replace function private.insertar_actividad(
  p_organizacion_id uuid,
  p_actor_id uuid,
  p_tipo text,
  p_detalle text,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detalle text := btrim(coalesce(p_detalle, ''));
  v_nombre text;
  v_id uuid;
begin
  if p_organizacion_id is null then
    raise exception 'La actividad necesita una organización' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' or length(p_tipo) > 60 then
    raise exception 'Tipo de actividad inválido: use el formato entidad.accion' using errcode = '22023';
  end if;
  if v_detalle = '' then
    raise exception 'El detalle de la actividad no puede estar vacío' using errcode = '22023';
  end if;
  if length(v_detalle) > 500 then
    v_detalle := left(v_detalle, 499) || '…';
  end if;

  if p_empresa_id is not null and not exists (
    select 1 from dominio.empresas e
    where e.id = p_empresa_id and e.organizacion_id = p_organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '22023';
  end if;

  if p_actor_id is not null then
    select coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), u.email::text)
      into v_nombre
      from auth.users u
      left join public.perfiles_usuario p on p.user_id = u.id
      where u.id = p_actor_id;
  end if;

  insert into public.registro_actividad (organizacion_id, empresa_id, actor_id, actor_nombre, tipo, detalle)
  values (p_organizacion_id, p_empresa_id, p_actor_id, v_nombre, p_tipo, v_detalle)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function private.insertar_actividad(uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- Contrato para los demás componentes: se llama desde sus RPC (security
-- definer) en la misma transacción que la operación de origen. Organización y
-- actor salen de la sesión, no de parámetros.
create or replace function private.registrar_actividad(
  p_tipo text,
  p_detalle text,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
begin
  if v_organizacion is null or v_actor is null then
    raise exception 'Se necesita una sesión con organización para registrar actividad' using errcode = '42501';
  end if;
  return private.insertar_actividad(v_organizacion, v_actor, p_tipo, p_detalle, p_empresa_id);
end;
$$;

revoke execute on function private.registrar_actividad(text, text, uuid) from public, anon;
grant execute on function private.registrar_actividad(text, text, uuid) to authenticated;

comment on function private.registrar_actividad(text, text, uuid) is
  'Registra un evento en el historial con la organización y el actor de la sesión (F-AUD-01, FR-002). Se invoca desde las RPC de otros componentes, en la misma transacción que la operación.';

-- Para eventos que nacen en el frontend (los empresa.* de eventosActividad.ts).
-- Los tipos de Acceso los fija solo el servidor: un cliente no puede
-- fabricar «cambió el rol de…» ni «guardó la matriz».
create or replace function public.registrar_actividad(
  p_tipo text,
  p_detalle text,
  p_empresa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tipo ~ '^(usuario|invitacion|permisos)\.' then
    raise exception 'Ese tipo de actividad lo registra solo el servidor' using errcode = '42501';
  end if;
  return private.registrar_actividad(p_tipo, p_detalle, p_empresa_id);
end;
$$;

revoke execute on function public.registrar_actividad(text, text, uuid) from public, anon;
grant execute on function public.registrar_actividad(text, text, uuid) to authenticated;

comment on function public.registrar_actividad(text, text, uuid) is
  'Registra actividad desde el frontend (F-AUD-01, FR-002). Organización y actor los fija el servidor; rechaza los tipos usuario.*, invitacion.* y permisos.*.';

-- ============================================================================
-- Lectura (FR-003, FR-004). Security invoker: rige la RLS de la tabla.
-- ============================================================================

-- p_desde / p_hasta son fechas (inclusivas) en America/Argentina/Buenos_Aires.
-- El texto se trata como literal (comodines escapados) y sin distinguir
-- mayúsculas ni tildes. Devuelve la página pedida más el total del filtro.
create or replace function public.listar_actividad(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_actor uuid default null,
  p_tipo text default null,
  p_texto text default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  creado_en timestamptz,
  tipo text,
  empresa_id uuid,
  empresa_nombre text,
  actor_id uuid,
  actor_nombre text,
  detalle text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre, r.actor_id, r.actor_nombre, r.detalle,
    count(*) over ()
  from public.registro_actividad r
  left join dominio.empresas e on e.id = r.empresa_id
  where r.organizacion_id = (select private.organizacion_id())
    and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
    and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
    and (p_empresa is null or r.empresa_id = p_empresa)
    and (p_actor is null or r.actor_id = p_actor)
    and (p_tipo is null or r.tipo = p_tipo)
    and (
      p_texto is null or btrim(p_texto) = ''
      or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like
        '%' || replace(replace(replace(translate(lower(left(btrim(p_texto), 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        escape '\'
    )
  order by r.creado_en desc, r.id desc
  limit least(greatest(coalesce(p_tamano, 10), 1), 100)
  offset (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_tamano, 10), 1), 100);
$$;

comment on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) is
  'Historial de actividad paginado en servidor (F-AUD-01, FR-003). Security invoker: la RLS de registro_actividad decide quién ve qué. Fechas en America/Argentina/Buenos_Aires.';

revoke execute on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) to authenticated;

-- Opciones de los filtros «tipo» y «usuario», derivadas de los eventos existentes.
create or replace function public.opciones_actividad()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'tipos', coalesce((
      select jsonb_agg(t.tipo order by t.tipo)
      from (
        select distinct r.tipo from public.registro_actividad r
        where r.organizacion_id = (select private.organizacion_id())
        limit 200
      ) t
    ), '[]'::jsonb),
    'actores', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.actor_id, 'nombre', a.nombre) order by a.nombre)
      from (
        select r.actor_id, coalesce(max(r.actor_nombre), 'Usuario') as nombre
        from public.registro_actividad r
        where r.organizacion_id = (select private.organizacion_id()) and r.actor_id is not null
        group by r.actor_id
        limit 200
      ) a
    ), '[]'::jsonb)
  );
$$;

comment on function public.opciones_actividad() is
  'Tipos y usuarios presentes en el historial, para los filtros de la pantalla Actividad (F-AUD-01). Security invoker.';

revoke execute on function public.opciones_actividad() from public, anon;
grant execute on function public.opciones_actividad() to authenticated;

-- ============================================================================
-- Eventos de Acceso (FR-007): se reflejan desde eventos_membresia, que ya
-- escriben invitar, cambiar rol, remover, suspender y reactivar. El
-- trigger no cambia el comportamiento de esas RPC.
-- ============================================================================

create or replace function private.registrar_actividad_membresia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_persona text;
  v_tipo text;
  v_detalle text;
begin
  select coalesce(
      nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''),
      new.target_email,
      u.email::text,
      'una persona'
    )
    into v_persona
    from (select 1) uno
    left join auth.users u on u.id = new.target_user_id
    left join public.perfiles_usuario p on p.user_id = new.target_user_id;

  case new.accion
    when 'invitacion_enviada' then
      v_tipo := 'invitacion.enviada';
      v_detalle := format('Invitó a %s con el rol %s', v_persona, private.etiqueta_rol(new.rol_nuevo));
    when 'invitacion_reenviada' then
      v_tipo := 'invitacion.reenviada';
      v_detalle := format('Reenvió la invitación a %s', v_persona);
    when 'invitacion_cancelada' then
      v_tipo := 'invitacion.cancelada';
      v_detalle := format('Canceló la invitación a %s', v_persona);
    when 'miembro_agregado' then
      v_tipo := 'usuario.agregado';
      v_detalle := format('%s se sumó con el rol %s', v_persona, private.etiqueta_rol(new.rol_nuevo));
    when 'rol_cambiado' then
      v_tipo := 'usuario.rol_cambiado';
      v_detalle := format('Cambió el rol de %s: %s → %s', v_persona, private.etiqueta_rol(new.rol_anterior), private.etiqueta_rol(new.rol_nuevo));
    when 'miembro_removido' then
      v_tipo := 'usuario.removido';
      v_detalle := format('Quitó a %s de la organización', v_persona);
    when 'suspendido' then
      v_tipo := 'usuario.suspendido';
      v_detalle := format('Suspendió a %s', v_persona);
    when 'reactivado' then
      v_tipo := 'usuario.reactivado';
      v_detalle := format('Reactivó a %s', v_persona);
    else
      return new;
  end case;

  perform private.insertar_actividad(new.organizacion_id, new.actor_user_id, v_tipo, v_detalle, null);
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_membresia() from public, anon, authenticated;

create trigger registrar_actividad_membresia
  after insert on public.eventos_membresia
  for each row execute function private.registrar_actividad_membresia();

-- ============================================================================
-- Matriz de permisos (FR-007): el `raise log` de F-ROL-02 pasa a ser un evento.
-- Mismas funciones de 20261013140000, solo cambia el cierre de cada una.
-- ============================================================================

-- p_niveles:  [{"rol_id": "...", "seccion": "...", "nivel": "edicion|lectura|ninguno"}, ...]
-- p_acciones: [{"rol_id": "...", "seccion": "...", "accion": "eliminar|exportar|ver_costos", "permitido": true|false}, ...]
-- Se aplica todo o nada (una sola transacción). `miembro` (rol del template) no se
-- edita desde acá: la UI de F-ROL-02 muestra solo los 6 roles de FR-014. Solo toca la organización de
-- private.organizacion_id(): el cliente no elige la organización.
create or replace function public.guardar_matriz_permisos(p_niveles jsonb default '[]', p_acciones jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambio jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede editar la matriz de permisos' using errcode = '42501';
  end if;

  if jsonb_typeof(p_niveles) is distinct from 'array' or jsonb_typeof(p_acciones) is distinct from 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  -- Tope de tamaño (hay 6×16 niveles y 6×16×3 acciones editables): evita que un envío
  -- enorme ocupe el lock y la CPU de la organización.
  if jsonb_array_length(p_niveles) > 200 or jsonb_array_length(p_acciones) > 400 then
    raise exception 'Demasiados cambios en un solo guardado' using errcode = '22023';
  end if;

  -- Un guardado concurrente o un restablecer en curso (borra y resiembra) no deben
  -- verse como filas «desconocidas»: se serializan por organización.
  perform pg_advisory_xact_lock(hashtextextended('matriz_permisos:' || v_org::text, 0));

  for v_cambio in select * from jsonb_array_elements(p_niveles) loop
    if jsonb_typeof(v_cambio) is distinct from 'object'
       or jsonb_typeof(v_cambio -> 'rol_id') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'seccion') is distinct from 'string' then
      raise exception 'Cada cambio de nivel debe ser un objeto con rol_id y seccion' using errcode = '22023';
    end if;
    -- FR-003: el Administrador no se restringe (además lo impide un check en la tabla).
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'miembro' then
      raise exception 'El rol miembro (template) no se edita desde la matriz' using errcode = '22023';
    end if;
    if jsonb_typeof(v_cambio -> 'nivel') is distinct from 'string'
       or v_cambio ->> 'nivel' not in ('edicion', 'lectura', 'ninguno') then
      raise exception 'Nivel inválido: %', v_cambio ->> 'nivel' using errcode = '22023';
    end if;
    -- Solo se actualizan filas existentes (sembradas): rol o sección desconocidos fallan.
    update public.permisos_rol
       set nivel = v_cambio ->> 'nivel'
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion';
    if not found then
      raise exception 'Rol o sección desconocidos: % / %', v_cambio ->> 'rol_id', v_cambio ->> 'seccion' using errcode = '22023';
    end if;
  end loop;

  for v_cambio in select * from jsonb_array_elements(p_acciones) loop
    if jsonb_typeof(v_cambio) is distinct from 'object'
       or jsonb_typeof(v_cambio -> 'rol_id') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'seccion') is distinct from 'string'
       or jsonb_typeof(v_cambio -> 'accion') is distinct from 'string' then
      raise exception 'Cada cambio de acción debe ser un objeto con rol_id, seccion y accion' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'administrador' then
      raise exception 'El rol Administrador no se puede restringir' using errcode = '22023';
    end if;
    if v_cambio ->> 'rol_id' = 'miembro' then
      raise exception 'El rol miembro (template) no se edita desde la matriz' using errcode = '22023';
    end if;
    if jsonb_typeof(v_cambio -> 'permitido') is distinct from 'boolean' then
      raise exception 'permitido debe ser booleano' using errcode = '22023';
    end if;
    update public.permisos_rol_accion
       set permitido = (v_cambio ->> 'permitido')::boolean
     where organizacion_id = v_org
       and rol_id = v_cambio ->> 'rol_id'
       and seccion = v_cambio ->> 'seccion'
       and accion = v_cambio ->> 'accion';
    if not found then
      raise exception 'Rol, sección o acción desconocidos: % / % / %',
        v_cambio ->> 'rol_id', v_cambio ->> 'seccion', v_cambio ->> 'accion' using errcode = '22023';
    end if;
  end loop;

  -- Trazabilidad (Principio III, F-AUD-01): quién y cuántos cambios.
  perform private.registrar_actividad(
    'permisos.matriz_guardada',
    format('Guardó cambios en la matriz de permisos (%s niveles, %s acciones)', jsonb_array_length(p_niveles), jsonb_array_length(p_acciones))
  );
end;
$$;

comment on function public.guardar_matriz_permisos(jsonb, jsonb) is
  'Guarda cambios de la matriz de permisos de la organización actual (F-ROL-02, FR-013). Solo Administrador; todo o nada; el Administrador no es restringible.';

-- FR-015: vuelve a los valores iniciales de Roles.dc.html reutilizando la siembra.
create or replace function public.restablecer_matriz_permisos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un Administrador de la organización puede restablecer la matriz de permisos' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matriz_permisos:' || v_org::text, 0));

  delete from public.permisos_rol_accion where organizacion_id = v_org;
  delete from public.permisos_rol where organizacion_id = v_org;
  perform private.sembrar_permisos(v_org);

  perform private.registrar_actividad('permisos.matriz_restablecida', 'Restableció la matriz de permisos a los valores iniciales');
end;
$$;

comment on function public.restablecer_matriz_permisos() is
  'Restablece la matriz de la organización actual a los valores iniciales (F-ROL-02, FR-015). Solo Administrador.';

revoke all on function public.guardar_matriz_permisos(jsonb, jsonb), public.restablecer_matriz_permisos() from public, anon;
grant execute on function public.guardar_matriz_permisos(jsonb, jsonb), public.restablecer_matriz_permisos() to authenticated;
