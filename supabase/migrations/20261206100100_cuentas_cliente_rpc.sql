-- F-CLI-05 (MSF-422, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): RPC de la cuenta web del
-- cliente. FR-003, FR-004, FR-005, FR-008, FR-009, FR-018.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla; las funciones de la app viven en
-- `public` (junto a clientes y clientes_empresas) y el auxiliar de permisos en `private`.
--
-- Desvío respecto del contrato (specs/…/contracts/cuenta-web-cliente.md): `preparar_cuenta_cliente` es
-- `security definer` (no `invoker`) porque lee `dominio.tiendas`, cuya RLS exige la sección Empresas, y los
-- operadores de Clientes pueden no tenerla. Valida los mismos permisos explícitamente. `vincular_cuenta_cliente`
-- suma `p_actor` (opcional) porque la llama el service-role y no tiene sesión: el actor viaja desde la Edge Function
-- (que ya autenticó al operador) para que el evento de Actividad lo registre.
--
-- Las funciones llaman a `private.registrar_actividad_cuenta_cliente`, que se crea en la migración siguiente
-- (20261202100150): plpgsql resuelve la llamada al ejecutarse, no al crearse.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function public.cuentas_web_de_cliente(uuid);
--   drop function public.cambiar_estado_cuenta_cliente(uuid, uuid, text);
--   drop function public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid);
--   drop function public.preparar_cuenta_cliente(uuid, uuid);
--   drop function private.exigir_gestion_cuenta_cliente(uuid, uuid);

-- ============================================================================
-- Permiso común: edición de Clientes, alcance sobre la tienda y cliente de la organización.
-- ============================================================================

create or replace function private.exigir_gestion_cuenta_cliente(p_cliente uuid, p_empresa uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('clientes')) <> 'edicion' then
    raise exception 'No tenés permiso para gestionar cuentas web de clientes' using errcode = '42501';
  end if;
  -- Alcance sobre la tienda: solo las empresas a las que accede el operador.
  if p_empresa is null or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = p_empresa) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  if p_cliente is null or not exists (
    select 1 from public.clientes c where c.id = p_cliente and c.organizacion_id = v_org
  ) then
    raise exception 'El cliente no pertenece a tu organización' using errcode = 'P0002';
  end if;
  return v_org;
end;
$$;

revoke execute on function private.exigir_gestion_cuenta_cliente(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- preparar_cuenta_cliente: valida y devuelve lo que la Edge Function necesita. No escribe.
-- ============================================================================

create or replace function public.preparar_cuenta_cliente(p_cliente uuid, p_empresa uuid)
returns table (correo text, dominio text, auth_user_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_correo text;
  v_dominio text;
  v_auth uuid;
begin
  v_org := private.exigir_gestion_cuenta_cliente(p_cliente, p_empresa);

  if not exists (
    select 1 from public.clientes_empresas ce where ce.cliente_id = p_cliente and ce.empresa_id = p_empresa
  ) then
    raise exception 'El cliente no está habilitado en esa tienda' using errcode = '22023';
  end if;

  select nullif(btrim(c.correo), '') into v_correo
    from public.clientes c
   where c.id = p_cliente and c.organizacion_id = v_org and c.archivado_en is null;
  if v_correo is null then
    raise exception 'El cliente no tiene correo' using errcode = '22023';
  end if;

  select t.dominio into v_dominio
    from dominio.tiendas t
   where t.empresa_id = p_empresa and t.organizacion_id = v_org;
  if v_dominio is null then
    raise exception 'La tienda no tiene dominio' using errcode = '22023';
  end if;

  -- D1: un solo usuario de Auth por cliente; si ya tiene cuenta en otra tienda se reutiliza.
  select cc.auth_user_id into v_auth
    from public.cuentas_cliente cc
   where cc.cliente_id = p_cliente
   order by cc.created_at
   limit 1;

  return query select v_correo, v_dominio, v_auth;
end;
$$;

comment on function public.preparar_cuenta_cliente(uuid, uuid) is
  'F-CLI-05: valida (edición de Clientes, alcance sobre la tienda, cliente habilitado y con correo) y devuelve correo, dominio de la tienda y el usuario de Auth ya vinculado del cliente. No escribe. La usa la Edge Function invitar-cliente con el JWT del operador.';

revoke execute on function public.preparar_cuenta_cliente(uuid, uuid) from public, anon;
grant execute on function public.preparar_cuenta_cliente(uuid, uuid) to authenticated;

-- ============================================================================
-- vincular_cuenta_cliente: solo service_role (Edge Function). Idempotente.
-- ============================================================================

create or replace function public.vincular_cuenta_cliente(
  p_cliente uuid,
  p_empresa uuid,
  p_auth_user uuid,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select c.organizacion_id into v_org
    from public.clientes c
   where c.id = p_cliente and c.archivado_en is null;
  if v_org is null then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.clientes_empresas ce where ce.cliente_id = p_cliente and ce.empresa_id = p_empresa
  ) then
    raise exception 'El cliente no está habilitado en esa tienda' using errcode = '22023';
  end if;

  if p_auth_user is null or not exists (select 1 from auth.users u where u.id = p_auth_user) then
    raise exception 'El usuario de acceso no existe' using errcode = '22023';
  end if;

  -- D5: una persona no mezcla identidad de panel y de cliente.
  if exists (select 1 from public.usuarios_organizacion uo where uo.user_id = p_auth_user) then
    raise exception 'El correo ya pertenece a un usuario del panel' using errcode = '22023';
  end if;

  -- D1: un usuario de Auth por cliente, y un usuario no sirve a dos clientes.
  if exists (
    select 1 from public.cuentas_cliente cc
     where (cc.cliente_id = p_cliente and cc.auth_user_id <> p_auth_user)
        or (cc.auth_user_id = p_auth_user and cc.cliente_id <> p_cliente)
  ) then
    raise exception 'El usuario de acceso ya está vinculado a otro cliente' using errcode = '22023';
  end if;

  insert into public.cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado)
  values (v_org, p_cliente, p_empresa, p_auth_user, 'activa')
  on conflict (cliente_id, empresa_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Reintento: la cuenta ya existe y se conserva tal cual (no reactiva una suspendida ni duplica el evento).
    select cc.id into v_id from public.cuentas_cliente cc
     where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa;
    return v_id;
  end if;

  perform private.registrar_actividad_cuenta_cliente(v_org, p_actor, p_cliente, p_empresa, 'creada');
  return v_id;
end;
$$;

comment on function public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid) is
  'F-CLI-05: alta idempotente de la cuenta web (cliente, tienda) en estado activa, con su evento de Actividad. Solo service_role (Edge Function invitar-cliente). Rechaza usuarios del panel (D5) y usuarios de otro cliente (D1).';

revoke execute on function public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.vincular_cuenta_cliente(uuid, uuid, uuid, uuid) to service_role;

-- ============================================================================
-- cambiar_estado_cuenta_cliente: suspender / reactivar. Idempotente.
-- ============================================================================

create or replace function public.cambiar_estado_cuenta_cliente(p_cliente uuid, p_empresa uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_actual text;
begin
  v_org := private.exigir_gestion_cuenta_cliente(p_cliente, p_empresa);

  if p_estado is null or p_estado not in ('activa', 'suspendida') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;

  select cc.estado into v_actual
    from public.cuentas_cliente cc
   where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa
   for update;
  if v_actual is null then
    raise exception 'El cliente no tiene cuenta web en esa tienda' using errcode = 'P0002';
  end if;

  if v_actual = p_estado then
    return;
  end if;

  update public.cuentas_cliente cc
     set estado = p_estado
   where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa;

  perform private.registrar_actividad_cuenta_cliente(
    v_org, (select auth.uid()), p_cliente, p_empresa,
    case p_estado when 'suspendida' then 'suspendida' else 'reactivada' end
  );
end;
$$;

comment on function public.cambiar_estado_cuenta_cliente(uuid, uuid, text) is
  'F-CLI-05: suspende (suspendida) o reactiva (activa) la cuenta web de un cliente en una tienda. Exige edición de Clientes y alcance sobre la tienda; idempotente; el acceso a la tienda cambia al instante porque el estado se consulta en cada llamada.';

revoke execute on function public.cambiar_estado_cuenta_cliente(uuid, uuid, text) from public, anon;
grant execute on function public.cambiar_estado_cuenta_cliente(uuid, uuid, text) to authenticated;

-- ============================================================================
-- cuentas_web_de_cliente: lectura para la ficha (estado, correo de acceso y último ingreso).
-- ============================================================================

create or replace function public.cuentas_web_de_cliente(p_cliente uuid)
returns table (empresa_id uuid, estado text, correo text, ultimo_ingreso timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('clientes')) not in ('lectura', 'edicion') then
    raise exception 'No tenés permiso para ver las cuentas web de clientes' using errcode = '42501';
  end if;
  if p_cliente is null or not exists (
    select 1 from public.clientes c where c.id = p_cliente and c.organizacion_id = v_org
  ) then
    raise exception 'El cliente no pertenece a tu organización' using errcode = 'P0002';
  end if;

  return query
    select cc.empresa_id, cc.estado, c.correo, u.last_sign_in_at
      from public.cuentas_cliente cc
      join public.clientes c on c.id = cc.cliente_id
      left join auth.users u on u.id = cc.auth_user_id
     where cc.cliente_id = p_cliente
       and cc.organizacion_id = v_org
       and cc.empresa_id in (select a.id from private.empresas_accesibles() a(id))
     order by cc.created_at;
end;
$$;

comment on function public.cuentas_web_de_cliente(uuid) is
  'F-CLI-05: cuentas web de un cliente por tienda accesible (estado, correo de acceso = correo del cliente y último ingreso desde auth.users). Exige lectura de Clientes y cliente de la organización.';

revoke execute on function public.cuentas_web_de_cliente(uuid) from public, anon;
grant execute on function public.cuentas_web_de_cliente(uuid) to authenticated;
