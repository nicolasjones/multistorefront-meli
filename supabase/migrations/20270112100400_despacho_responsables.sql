-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-009):
-- `public.listar_responsables_despacho`: quién puede responder por cada paso del despacho de una factura.
--
-- Esquema (Principio VII): sin tablas nuevas. Lee `public.usuarios_organizacion`, `public.usuarios_empresas`,
-- `public.perfiles_usuario`, `dominio.empresas` y `auth.users` (solo lectura). La organización y el actor salen
-- de la sesión, nunca de un argumento.
--
-- Quién es elegible (FR-004, FR-005, FR-006 y Decisión abierta 2 de la spec):
--   · armar y controlar → rol Depósito o Administrador en la empresa del comprobante.
--   · entregar → el rol que tenga la acción `despachar` en Ventas (hoy: Administrador y Depósito). Si más
--     adelante se quiere que entregue otro rol, se le da la acción en la matriz de permisos: sin migración.
-- Los responsables ya registrados (Armó, Controló, Entregó) salen de esta misma lista: quien armó o controló
-- es, por definición, elegible para ese paso.
--
-- Seguridad: `security definer`, `set search_path = ''`; exige ver Ventas en la empresa (`lectura` o `edicion`),
-- como el resto de las lecturas de comprobantes. `revoke … from public, anon` y `grant execute … to
-- authenticated` explícitos.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_responsables_despacho(uuid, text);
--   drop function private.responsable_despacho_habilitado(uuid, text, text);
--   drop function private.rol_usuario_en_empresa(uuid, uuid, uuid);

-- Rol que un usuario tiene en una empresa: el de la organización si es Administrador (accede a todas las
-- empresas) o el de su asignación en esa empresa. Null si no tiene rol ahí o si está suspendido.
create or replace function private.rol_usuario_en_empresa(p_organizacion uuid, p_user_id uuid, p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
        from public.usuarios_organizacion u
       where u.user_id = p_user_id
         and u.organizacion_id = p_organizacion
         and u.estado = 'activo'
         and u.rol_id = 'administrador'
    ) then 'administrador'
    else (
      select ue.rol_id
        from public.usuarios_empresas ue
        join public.usuarios_organizacion u
          on u.user_id = ue.user_id and u.organizacion_id = ue.organizacion_id
       where ue.user_id = p_user_id
         and ue.empresa_id = p_empresa_id
         and ue.organizacion_id = p_organizacion
         and u.estado = 'activo'
    )
  end;
$$;

comment on function private.rol_usuario_en_empresa(uuid, uuid, uuid) is
  'Rol de un usuario en una empresa: administrador de la organización o el de su asignación. Null si no tiene rol o está suspendido. Solo la llaman las RPC de despacho (F-VTA-15, FR-004).';

revoke execute on function private.rol_usuario_en_empresa(uuid, uuid, uuid) from public, anon, authenticated;

-- Si un rol puede responder por un paso del despacho (FR-004, FR-005, FR-006, Decisión abierta 2).
create or replace function private.responsable_despacho_habilitado(
  p_organizacion uuid,
  p_rol_id text,
  p_funcion text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Armar y controlar: Depósito o Administrador de la empresa.
    -- Ojo: el `case` de Postgres no admite varios valores por `when` (`when 'armar', 'controlar'` es
    -- sintaxis inválida): la comparación va en la condición.
    when p_funcion in ('armar', 'controlar') then p_rol_id in ('deposito', 'administrador')
    -- Entregar: quien tenga la acción `despachar` en Ventas.
    when p_funcion = 'entregar' then private.accion_de_rol(p_organizacion, p_rol_id, 'ventas', 'despachar')
    else false
  end;
$$;

comment on function private.responsable_despacho_habilitado(uuid, text, text) is
  'true si el rol puede armar, controlar o entregar el despacho de una factura (F-VTA-15). Armar y controlar: Depósito o Administrador. Entregar: rol con la acción `despachar` en Ventas.';

revoke execute on function private.responsable_despacho_habilitado(uuid, text, text) from public, anon, authenticated;

create or replace function public.listar_responsables_despacho(p_empresa_id uuid, p_funcion text)
returns table (user_id uuid, nombre text, rol_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_funcion text := lower(btrim(coalesce(p_funcion, '')));
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los responsables del despacho' using errcode = '42501';
  end if;
  if v_funcion not in ('armar', 'controlar', 'entregar') then
    raise exception 'El paso "%" no es un paso del despacho', p_funcion using errcode = '22023';
  end if;
  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org
  ) then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  -- Ver Ventas en la tienda: sin acceso no hay lista de responsables.
  if (select private.nivel_ventas_en_empresa(p_empresa_id)) = 'ninguno' then
    raise exception 'Tu rol no puede ver los responsables de esta tienda' using errcode = '42501';
  end if;

  return query
    select c.user_id,
           coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text),
           c.rol_id
      from (
        -- Administradores de la organización: acceder a todas sus empresas.
        select u.user_id, 'administrador'::text as rol_id
          from public.usuarios_organizacion u
         where u.organizacion_id = v_org and u.estado = 'activo' and u.rol_id = 'administrador'
        union
        -- Miembros con rol en esta empresa.
        select ue.user_id, ue.rol_id
          from public.usuarios_empresas ue
          join public.usuarios_organizacion u
            on u.user_id = ue.user_id and u.organizacion_id = ue.organizacion_id
         where ue.empresa_id = p_empresa_id
           and ue.organizacion_id = v_org
           and u.estado = 'activo'
      ) c
      join auth.users au on au.id = c.user_id
      left join public.perfiles_usuario pu on pu.user_id = c.user_id
     where private.responsable_despacho_habilitado(v_org, c.rol_id, v_funcion)
     order by coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), au.email::text),
              c.rol_id,
              c.user_id;
end;
$$;

comment on function public.listar_responsables_despacho(uuid, text) is
  'Usuarios elegibles para armar, controlar o entregar el despacho de una factura en una tienda (F-VTA-15, FR-009): nombre y rol. Exige ver Ventas en esa tienda.';

revoke execute on function public.listar_responsables_despacho(uuid, text) from public, anon;
grant execute on function public.listar_responsables_despacho(uuid, text) to authenticated;
