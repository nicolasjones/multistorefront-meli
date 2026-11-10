-- MSF-319 · F-NOT-01 (FR-006, FR-011): cola de avisos y emisión.
-- Esquema `public` para la tabla (Principio VII: outbox de plataforma) y `private` para
-- las funciones. `avisos_pendientes` tiene RLS activada SIN políticas para `authenticated`:
-- solo la tocan funciones `security definer` y el rol de Kestra.
-- `private.emitir_aviso` NO se concede a `authenticated`: la llaman otras funciones
-- `security definer` del componente que genera el aviso (p. ej. el trigger de Consultas).
--
-- Reversión (migración posterior): drop function private.emitir_aviso(text, uuid, jsonb);
-- drop function private.nivel_seccion_de_usuario(uuid, text); drop table public.avisos_pendientes;

create table if not exists public.avisos_pendientes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Destinatario.
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo_aviso text not null references public.tipos_aviso (clave),
  -- Los avisos de un mismo destinatario y tipo dentro de una ventana comparten grupo (un correo).
  grupo_id uuid not null,
  datos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'descartado', 'fallido')),
  intentos integer not null default 0 check (intentos >= 0),
  creado_en timestamptz not null default now(),
  -- A partir de cuándo el grupo puede enviarse.
  ventana_vence_en timestamptz not null default now(),
  -- Espera creciente tras un fallo.
  proximo_intento timestamptz,
  -- Vencimiento del reclamo de Kestra: si caduca, el grupo vuelve a estar disponible.
  reclamado_hasta timestamptz,
  enviado_en timestamptz,
  error text
);

comment on table public.avisos_pendientes is
  'Cola/outbox durable de correos de avisos (plataforma, esquema public). RLS sin políticas para authenticated: solo funciones security definer y el rol de Kestra. Un aviso por fila; las filas con el mismo grupo_id salen en un solo correo.';

create index if not exists avisos_pendientes_organizacion_id_idx on public.avisos_pendientes (organizacion_id);
create index if not exists avisos_pendientes_user_id_idx on public.avisos_pendientes (user_id);
create index if not exists avisos_pendientes_tipo_aviso_idx on public.avisos_pendientes (tipo_aviso);
create index if not exists avisos_pendientes_grupo_id_idx on public.avisos_pendientes (grupo_id);
create index if not exists avisos_pendientes_listos_idx
  on public.avisos_pendientes (ventana_vence_en)
  where estado in ('pendiente', 'enviando');

alter table public.avisos_pendientes enable row level security;

revoke all on public.avisos_pendientes from public, anon, authenticated;

-- Nivel de OTRO usuario en una sección (nivel_seccion resuelve solo la sesión actual).
-- Misma regla que private.nivel_seccion, pero sin "empresa activa" (es de la sesión de cada
-- persona): en secciones por empresa o compartidas vale el mejor rol entre sus empresas.
-- Usuario inexistente, suspendido o sin membresía: 'ninguno'.
create or replace function private.nivel_seccion_de_usuario(p_user_id uuid, p_seccion text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.nivel
      from (
        select private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) as nivel
        from (
          select u.organizacion_id, u.rol_id
          from public.usuarios_organizacion u
          where u.user_id = p_user_id and u.estado = 'activo'
            and (
              u.rol_id = 'administrador'
              or not exists (select 1 from public.usuarios_empresas ue where ue.user_id = u.user_id)
              or not (
                p_seccion = any (private.secciones_compartidas())
                or p_seccion = any (private.secciones_por_empresa())
              )
            )
          union
          select ue.organizacion_id, ue.rol_id
          from public.usuarios_organizacion u
          join public.usuarios_empresas ue on ue.user_id = u.user_id
          join dominio.empresas e
            on e.id = ue.empresa_id and e.organizacion_id = u.organizacion_id and e.activa
          where u.user_id = p_user_id and u.estado = 'activo' and u.rol_id <> 'administrador'
            and (
              p_seccion = any (private.secciones_compartidas())
              or p_seccion = any (private.secciones_por_empresa())
            )
        ) x
      ) r
      order by case r.nivel when 'edicion' then 2 when 'lectura' then 1 else 0 end desc
      limit 1
    ),
    'ninguno'
  );
$$;

comment on function private.nivel_seccion_de_usuario(uuid, text) is
  'Nivel de un usuario cualquiera en una sección: edicion | lectura | ninguno. Como nivel_seccion pero para otra persona y sin empresa activa (mejor rol entre sus empresas). Usuario suspendido o ajeno: ninguno.';

-- Emite un aviso a los destinatarios que corresponden: usuarios activos de la organización,
-- con correo, con acceso a la sección del tipo y con la preferencia encendida (sin fila =
-- encendida). Devuelve cuántos destinatarios se encolaron. La agrupación llega en la
-- migración siguiente; aquí cada aviso sale solo.
create or replace function private.emitir_aviso(p_tipo text, p_organizacion uuid, p_datos jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seccion text;
  v_destinatario uuid;
  v_encolados integer := 0;
begin
  select t.seccion into v_seccion from public.tipos_aviso t where t.clave = p_tipo;
  if not found then
    raise exception 'Tipo de aviso desconocido' using errcode = '22023';
  end if;

  for v_destinatario in
    select u.user_id
    from public.usuarios_organizacion u
    join auth.users a on a.id = u.user_id
    where u.organizacion_id = p_organizacion
      and u.estado = 'activo'
      and btrim(coalesce(a.email, '')) <> ''
      and private.nivel_seccion_de_usuario(u.user_id, v_seccion) <> 'ninguno'
      and coalesce(
        (select p.activo from public.preferencias_aviso p
          where p.user_id = u.user_id and p.tipo_aviso = p_tipo),
        true
      )
  loop
    insert into public.avisos_pendientes (organizacion_id, user_id, tipo_aviso, grupo_id, datos)
    values (p_organizacion, v_destinatario, p_tipo, gen_random_uuid(), coalesce(p_datos, '{}'::jsonb));
    v_encolados := v_encolados + 1;
  end loop;

  return v_encolados;
end;
$$;

comment on function private.emitir_aviso(text, uuid, jsonb) is
  'Encola un aviso para cada destinatario con acceso a la sección del tipo y preferencia encendida. Devuelve la cantidad de destinatarios. Solo para funciones security definer de otros componentes.';

revoke execute on function
  private.nivel_seccion_de_usuario(uuid, text),
  private.emitir_aviso(text, uuid, jsonb)
  from public, anon, authenticated;
