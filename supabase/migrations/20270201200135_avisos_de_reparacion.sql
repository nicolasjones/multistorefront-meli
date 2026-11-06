-- F-SVC-14 (MSF-424, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-026):
-- `public.avisos_de_reparacion`, el historial de avisos al cliente de una reparación.
--
-- Esquema (Principio VII): sin tablas nuevas; lee `dominio.reparacion_avisos` (`dominio`) y el nombre visible de
-- `public.perfiles_usuario`. Devuelve estado avisado, destinatario, resultado, motivo, fechas y quién lo pidió con su
-- NOMBRE (nunca el correo del usuario; sin perfil, null). Antes de leer cierra como fallido los pendientes vencidos.
-- Exige `service_tecnico` en `lectura` o más y tienda accesible (42501 sin permiso, P0002 inexistente).
-- `revoke … from public, anon` y `grant execute … to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.avisos_de_reparacion(uuid);

create or replace function public.avisos_de_reparacion(p_reparacion uuid)
returns table (
  id uuid,
  estado_id uuid,
  estado_nombre text,
  destinatario text,
  estado_envio text,
  error text,
  solicitado_en timestamptz,
  enviado_en timestamptz,
  solicitado_por_nombre text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los avisos de las reparaciones' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;

  perform private.expirar_avisos_reparacion(v_rep.id);

  return query
    select a.id, a.estado_id, a.estado_nombre, a.destinatario, a.estado_envio, a.error, a.solicitado_en, a.enviado_en,
           nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
      from dominio.reparacion_avisos a
      left join public.perfiles_usuario p on p.user_id = a.solicitado_por
     where a.reparacion_id = v_rep.id and a.organizacion_id = v_org
     order by a.solicitado_en desc, a.id;
end;
$$;

revoke execute on function public.avisos_de_reparacion(uuid) from public, anon;
grant execute on function public.avisos_de_reparacion(uuid) to authenticated;

comment on function public.avisos_de_reparacion(uuid) is
  'F-SVC-14: historial de avisos al cliente de una reparación (más reciente primero), con el nombre visible de quien lo pidió. Exige service_tecnico en lectura o más y tienda accesible.';
