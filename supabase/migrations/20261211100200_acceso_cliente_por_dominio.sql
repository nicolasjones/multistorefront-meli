-- F-CLI-05 (MSF-422, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): acceso del cliente a la
-- tienda de un dominio. FR-011.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.acceso_cliente_por_dominio -> `publico` (función de lectura mínima por Host); `publico` sigue SIN tablas.
--
-- Devuelve el estado EFECTIVO de la cuenta del llamador (la sesión del cliente) en la tienda de ese Host:
--   activa | suspendida | sin_cuenta | no_habilitado, y el tipo del cliente SOLO si está activa.
-- «No habilitado» prevalece sobre el estado guardado (se deriva de clientes_empresas). Host desconocido y empresa
-- desactivada responden lo mismo (null). La suspensión rige al instante: el estado se consulta en cada llamada, no
-- viaja en el token. Un cliente archivado no da acceso (se responde «sin_cuenta»). Solo `authenticated`.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function publico.acceso_cliente_por_dominio(text);

create or replace function publico.acceso_cliente_por_dominio(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_uid uuid := (select auth.uid());
  v_cliente uuid;
  v_estado text;
  v_habilitado boolean;
  v_tipo text;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  if v_uid is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  -- Un usuario de Auth pertenece a un solo cliente (D1, forzado por vincular_cuenta_cliente).
  select cc.cliente_id into v_cliente
    from public.cuentas_cliente cc
    join public.clientes c on c.id = cc.cliente_id and c.archivado_en is null
   where cc.auth_user_id = v_uid
   limit 1;
  if v_cliente is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  select exists (
    select 1 from public.clientes_empresas ce
     where ce.cliente_id = v_cliente and ce.empresa_id = v_empresa
  ) into v_habilitado;

  if not v_habilitado then
    return jsonb_build_object('estado', 'no_habilitado', 'tipo', null);
  end if;

  select cc.estado into v_estado
    from public.cuentas_cliente cc
   where cc.cliente_id = v_cliente and cc.empresa_id = v_empresa and cc.auth_user_id = v_uid;
  if v_estado is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  if v_estado = 'activa' then
    select c.tipo into v_tipo from public.clientes c where c.id = v_cliente;
    return jsonb_build_object('estado', 'activa', 'tipo', v_tipo);
  end if;

  return jsonb_build_object('estado', v_estado, 'tipo', null);
end;
$$;

revoke execute on function publico.acceso_cliente_por_dominio(text) from public, anon;
grant execute on function publico.acceso_cliente_por_dominio(text) to authenticated;

comment on function publico.acceso_cliente_por_dominio(text) is
  'F-CLI-05: estado efectivo (activa | suspendida | sin_cuenta | no_habilitado) de la cuenta web del llamador en la tienda del host y, solo si está activa, el tipo del cliente. «No habilitado» prevalece; host desconocido y empresa desactivada → null. El estado se consulta en cada llamada (la suspensión rige al instante).';
