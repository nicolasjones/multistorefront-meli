-- Service técnico: (1) «Regenerar enlace» del seguimiento público y (2) reportes acotados a las empresas
-- accesibles de quien mira el tablero.
--
-- (1) `public.regenerar_enlace_consulta(reparacion)`: genera un token nuevo (192 bits, base64url) para la
--     reparación y el anterior deja de resolver (la fila es única por reparación: el token viejo desaparece).
--     SECURITY DEFINER con los mismos controles que `obtener_enlace_consulta`: organización de la sesión, `edicion`
--     en `service_tecnico`, reparación de la organización y de una tienda accesible (`P0002` igual que si no
--     existiera). Si la reparación aún no tenía enlace, lo crea. Registra `reparacion.enlace_regenerado`.
--     Tope: 10 regeneraciones por persona por hora (`P0001` `DEMASIADAS_REGENERACIONES`). El límite de consultas por IP no se toca (vive en la Edge Function y `registrar_consulta_publica`).
-- (2) El reporte «Service técnico» declara `filtro_empresa = true`: `emitir-acceso-reporte` agrega
--     `empresa_id IN (<empresas_accesibles del usuario>)` a la cláusula `rls` del guest token. Las dos vistas
--     `analitica.service_*` exponen `empresa_id`, así que la cláusula es válida en todos los datasets.
--
-- Migración aditiva. Reversión (migración posterior; los enlaces ya regenerados siguen siendo los vigentes):
--   drop function public.regenerar_enlace_consulta(uuid);
--   drop trigger reportes_service_filtro_empresa on public.reportes;
--   drop function private.forzar_filtro_empresa_service();
--   update public.reportes set filtro_empresa = false where seccion = 'service_tecnico';

create or replace function public.regenerar_enlace_consulta(p_reparacion uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_token text;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede regenerar enlaces de seguimiento' using errcode = '42501';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    -- Misma respuesta que una reparación inexistente o de otra organización: no se confirma que el id exista.
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;

  -- Serializa las regeneraciones de la misma reparación (solo después de comprobar el alcance).
  perform 1 from dominio.reparaciones r where r.id = v_rep.id for update;

  -- Tope de frecuencia: 10 regeneraciones por persona por hora (cuenta la actividad ya registrada).
  if (select count(*) from public.registro_actividad ra
       where ra.organizacion_id = v_org
         and ra.actor_id = (select auth.uid())
         and ra.tipo = 'reparacion.enlace_regenerado'
         and ra.creado_en > now() - interval '1 hour') >= 10 then
    raise exception 'DEMASIADAS_REGENERACIONES: probá de nuevo en unos minutos' using errcode = 'P0001';
  end if;

  insert into dominio.reparacion_enlaces_consulta (organizacion_id, reparacion_id, token, creado_por)
  values (
    v_org, v_rep.id,
    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
    (select auth.uid())
  )
  on conflict (reparacion_id) do update
    set token = excluded.token,
        creado_por = excluded.creado_por,
        creado_en = now()
  returning token into v_token;

  perform private.registrar_actividad(
    'reparacion.enlace_regenerado',
    format('Regeneró el enlace de seguimiento de %s', private.codigo_reparacion(v_rep.numero)),
    v_rep.empresa_id
  );

  return jsonb_build_object('token', v_token);
end;
$$;

comment on function public.regenerar_enlace_consulta(uuid) is
  'Service: genera un token nuevo para el enlace público de seguimiento; el anterior deja de funcionar. Solo con edición en Service técnico y tienda accesible.';

revoke execute on function public.regenerar_enlace_consulta(uuid) from public, anon;
grant execute on function public.regenerar_enlace_consulta(uuid) to authenticated;

-- (2) El tablero de Service filtra por empresa (el importador lo vuelve a escribir desde reportes.json).
update public.reportes
   set filtro_empresa = true
 where seccion = 'service_tecnico'
   and filtro_empresa is distinct from true;

-- Los reportes de la sección de Service siempre filtran por empresa, sin depender de quien los registre (el
-- importador de tableros, un seed o un alta manual): un valor `false` los dejaría mostrando toda la organización.
create or replace function private.forzar_filtro_empresa_service()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seccion = 'service_tecnico' then
    new.filtro_empresa := true;
  end if;
  return new;
end;
$$;

revoke execute on function private.forzar_filtro_empresa_service() from public, anon, authenticated;

drop trigger if exists reportes_service_filtro_empresa on public.reportes;
create trigger reportes_service_filtro_empresa
  before insert or update of seccion, filtro_empresa on public.reportes
  for each row execute function private.forzar_filtro_empresa_service();
