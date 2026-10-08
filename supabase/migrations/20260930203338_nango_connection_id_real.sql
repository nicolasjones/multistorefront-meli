-- Corrige un defecto de diseño real de spec 20260930-153545-conexiones-oauth-nango
-- (research.md R6/R8): con Connect Session Token, Nango asigna el
-- connection_id — no se puede fijar de antemano en POST /connect/sessions
-- (confirmado leyendo packages/server/lib/controllers/connect/postSessions.ts
-- de NangoHQ/nango: el body schema no acepta connection_id). El id de
-- conexiones_oauth sigue siendo la clave de bookkeeping de Supabase, pero
-- deja de asumirse igual al connection_id real de Nango — ese llega recién
-- en la respuesta de nango.auth()/.reconnect() (ConnectionResponseSuccess.
-- connectionId) y hay que guardarlo aparte.
--
-- Migración aditiva. Reversión:
--   drop function private.datos_despacho_conexion_oauth(uuid, text);
--   drop function public.confirmar_conexion_oauth(uuid, text);
--   drop index conexiones_oauth_nango_connection_id_idx;
--   alter table conexiones_oauth drop column nango_connection_id;
-- (y recrear las dos funciones con su forma anterior desde
-- 20260930160000_conexiones_oauth.sql / 20260930165825_datos_despacho_conexion_oauth.sql
-- si hiciera falta revertir del todo)

alter table conexiones_oauth add column nango_connection_id text;

comment on column conexiones_oauth.nango_connection_id is
  'connection_id real que Nango asignó al confirmar la conexión (ConnectionResponseSuccess.connectionId) — null mientras estado = pendiente. Ya no se asume igual a id: con Connect Session Token, Nango lo genera, no se puede pre-fijar (research.md R8).';

create unique index conexiones_oauth_nango_connection_id_idx
  on conexiones_oauth (nango_connection_id)
  where nango_connection_id is not null;

-- ============================================================================
-- confirmar_conexion_oauth: ahora recibe también el connection_id real
-- ============================================================================

drop function public.confirmar_conexion_oauth(uuid);

create or replace function public.confirmar_conexion_oauth(p_conexion_id uuid, p_nango_connection_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_estado text;
begin
  select organizacion_id, estado into v_organizacion_id, v_estado
  from public.conexiones_oauth
  where id = p_conexion_id;

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'P0002';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  update public.conexiones_oauth
  set estado = 'activa', nango_connection_id = p_nango_connection_id, updated_at = clock_timestamp()
  where id = p_conexion_id;

  insert into public.eventos_conexion_oauth (conexion_id, tipo, actor)
  values (p_conexion_id, case when v_estado = 'pendiente' then 'creada' else 'reautorizada' end, (select auth.uid()));
end;
$$;

comment on function public.confirmar_conexion_oauth(uuid, text) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/conectar-oauth.md #3. p_nango_connection_id es el connectionId que devuelve nango.auth()/.reconnect() al resolver con éxito — Nango lo asigna, este llamador no lo inventa. Llamar únicamente cuando esa promesa resolvió con éxito en el navegador.';

revoke execute on function public.confirmar_conexion_oauth(uuid, text) from public;
grant execute on function public.confirmar_conexion_oauth(uuid, text) to authenticated;

-- ============================================================================
-- datos_despacho_conexion_oauth: devuelve el connection_id real de Nango
-- ============================================================================

drop function private.datos_despacho_conexion_oauth(uuid, text);

create or replace function private.datos_despacho_conexion_oauth(
  p_organizacion_id uuid,
  p_clave text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_nango_connection_id text;
begin
  select c.nango_connection_id
  into v_nango_connection_id
  from public.conexiones_oauth c
  join public.integraciones_oauth i on i.id = c.integracion_id
  where c.organizacion_id = p_organizacion_id
    and i.clave = p_clave
    and c.estado = 'activa';

  if v_nango_connection_id is null then
    raise exception 'No hay conexión OAuth activa a % para la organización %', p_clave, p_organizacion_id using errcode = 'P0002';
  end if;

  return v_nango_connection_id;
end;
$$;

comment on function private.datos_despacho_conexion_oauth(uuid, text) is
  'Contrato: specs/20260930-153545-conexiones-oauth-nango/contracts/obtener-token-oauth.md (Paso 1, variante para un flow de Kestra). Devuelve el connection_id REAL de Nango (nango_connection_id), no el id de conexiones_oauth — desde research.md R8 esos dos valores ya no son iguales.';

revoke execute on function private.datos_despacho_conexion_oauth(uuid, text) from public, authenticated, anon;
grant execute on function private.datos_despacho_conexion_oauth(uuid, text) to kestra_orquestacion;

-- ============================================================================
-- Grant de columna (auto_expose_new_tables = false)
-- ============================================================================

grant select (nango_connection_id) on table conexiones_oauth to authenticated;
