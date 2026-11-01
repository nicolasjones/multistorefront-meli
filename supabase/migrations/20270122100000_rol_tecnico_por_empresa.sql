-- MSF-597 / MSF-606 · El rol `tecnico` puede asignarse por empresa e invitarse.
--
-- Bug: el CHECK `usuarios_empresas_rol_por_empresa`, `private.validar_asignaciones` y
-- `registrar_invitacion` solo admitían operador, consulta, mostrador, deposito y administracion,
-- así que un Técnico no podía recibir ninguna empresa y `private.empresas_accesibles()` no le
-- devolvía tiendas: no podía operar Service técnico. Decisión del producto: `tecnico` es un rol por
-- empresa más.
--
-- Esquemas (Principio VII): solo se altera una restricción de `public.usuarios_empresas` (plataforma)
-- y se redefinen funciones; no se crea ninguna tabla.
-- Alcance del acceso (sin cambios de permisos): la matriz de 20261020130100 ya da al Técnico
-- `service_tecnico` = edición; inicio, productos, stock y clientes = lectura; el resto ninguno.
-- `service_tecnico` no es sección por empresa ni compartida: el nivel sale del rol de organización
-- (`tecnico`) y el acceso a cada tienda, de `empresas_accesibles()` (sus filas en usuarios_empresas).
-- Las secciones por empresa (ventas, consultas, reportes) resuelven el rol por empresa `tecnico` = ninguno.
--
-- Migración aditiva (ensancha un CHECK y la lista de roles de dos funciones). Camino de reversión
-- (no se ejecuta; solo válido si ninguna fila de usuarios_empresas ni invitación usa `tecnico`):
--   delete from public.usuarios_empresas where rol_id = 'tecnico';
--   alter table public.usuarios_empresas drop constraint usuarios_empresas_rol_por_empresa;
--   alter table public.usuarios_empresas add constraint usuarios_empresas_rol_por_empresa
--     check (rol_id in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion'));
--   y restaurar private.validar_asignaciones(uuid, jsonb) a 20261016160100 y
--   public.registrar_invitacion(text, text) a 20261013150000.

alter table public.usuarios_empresas drop constraint usuarios_empresas_rol_por_empresa;
alter table public.usuarios_empresas add constraint usuarios_empresas_rol_por_empresa
  check (rol_id in ('operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico'));

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

-- Misma función que 20261013150000 con `tecnico` entre los roles invitables.
create or replace function public.registrar_invitacion(p_email text, p_rol_id text)
returns public.invitaciones_organizacion
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv public.invitaciones_organizacion;
begin
  if p_rol_id is null or p_rol_id not in ('administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion', 'tecnico') then
    raise exception 'Rol inválido' using errcode = '22023';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Correo inválido' using errcode = '22023';
  end if;
  select private.organizacion_id() into v_org;
  if v_org is null or not private.puede_gestionar_membresias(v_org) then
    raise exception 'No puede gestionar usuarios de esta organización' using errcode = '42501';
  end if;
  -- Una persona pertenece a una sola organización (FR-009, escenario 7). El
  -- mensaje es genérico: no se revela si el correo existe ni en qué organización está.
  if exists (
    select 1 from auth.users u
    join public.usuarios_organizacion m on m.user_id = u.id
    where lower(u.email) = v_email
  ) then
    raise exception 'No se puede invitar a ese correo' using errcode = '23505';
  end if;

  insert into public.invitaciones_organizacion (organizacion_id, email, rol_id, creada_por)
  values (v_org, v_email, p_rol_id, (select auth.uid()))
  on conflict (organizacion_id, email) where estado = 'pendiente'
  do update set rol_id = excluded.rol_id, vence_en = now() + interval '7 days',
    creada_por = excluded.creada_por, updated_at = now()
  returning * into v_inv;
  return v_inv;
end;
$$;

revoke execute on function public.registrar_invitacion(text, text) from public, anon;
grant execute on function public.registrar_invitacion(text, text) to authenticated;
