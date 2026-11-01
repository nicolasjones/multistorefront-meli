-- MSF-597 (BUG-315) · El rol Técnico no se podía asignar a ninguna tienda.
--
-- Causa: el CHECK `usuarios_empresas_rol_por_empresa` y la validación de
-- `private.validar_asignaciones` (la usan `asignar_empresas_usuario`,
-- `guardar_asignaciones_invitacion` y `aceptar_invitacion`) solo admitían cinco roles; sin fila en
-- `usuarios_empresas`, `private.empresas_accesibles()` no deja pasar al Técnico y toda RPC de
-- Service que valida la tienda devolvía 42501 «No tenés acceso a esa tienda».
--
-- Esquemas (Principio VII, re-verificado): `usuarios_empresas` es plataforma → `public` (existente,
-- solo se amplía un CHECK; sin RLS nueva). No crea tablas. `mostrador` no se toca.
--
-- Migración aditiva: solo AMPLÍA los roles válidos. Camino de reversión (no se ejecuta; solo válido
-- mientras ninguna fila de usuarios_empresas ni invitación pendiente use `tecnico`):
--   alter table public.usuarios_empresas drop constraint usuarios_empresas_rol_por_empresa;
--   alter table public.usuarios_empresas add constraint usuarios_empresas_rol_por_empresa
--     check (rol_id in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion'));
--   restaurar private.validar_asignaciones() a 20261016160100_asignar_empresas_usuario.sql.

alter table public.usuarios_empresas drop constraint usuarios_empresas_rol_por_empresa;
alter table public.usuarios_empresas
  add constraint usuarios_empresas_rol_por_empresa
  check (rol_id in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico'));

-- Mismo cuerpo que 20261016160100 con `tecnico` entre los roles válidos por empresa.
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
  if jsonb_array_length(p_asignaciones) > 200 then
    raise exception 'Demasiadas asignaciones' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_asignaciones) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'empresa_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Asignación inválida' using errcode = '22023';
    end if;
    v_empresa := (v_item ->> 'empresa_id')::uuid;
    v_rol := v_item ->> 'rol_id';
    if v_rol is null or v_rol not in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico') then
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
