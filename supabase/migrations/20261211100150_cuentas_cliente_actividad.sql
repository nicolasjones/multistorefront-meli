-- F-CLI-05 (MSF-422, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): eventos de Actividad de la
-- cuenta web del cliente. FR-016 (Constitución III).
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla. Los eventos van a
-- `public.registro_actividad` (existente) por `private.insertar_actividad`; el auxiliar vive en `private`.
--
-- Eventos (tipo → cuándo): cliente.cuenta_creada, cliente.cuenta_suspendida, cliente.cuenta_reactivada,
-- cliente.cuenta_restablecida. Cada uno lleva actor (sesión del operador), cliente (Nº y nombre) y tienda
-- (empresa_id + nombre en el detalle). Se registran en la misma transacción que la operación; nunca llevan el
-- correo ni datos de contacto.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function public.registrar_restablecimiento_cuenta_cliente(uuid, uuid);
--   drop function private.registrar_actividad_cuenta_cliente(uuid, uuid, uuid, uuid, text);

create or replace function private.registrar_actividad_cuenta_cliente(
  p_organizacion uuid,
  p_actor uuid,
  p_cliente uuid,
  p_empresa uuid,
  p_accion text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero integer;
  v_nombre text;
  v_tienda text;
  v_verbo text;
begin
  v_verbo := case p_accion
    when 'creada' then 'Creó la cuenta web'
    when 'suspendida' then 'Suspendió la cuenta web'
    when 'reactivada' then 'Reactivó la cuenta web'
    when 'restablecida' then 'Restableció la clave de la cuenta web'
    else null
  end;
  if v_verbo is null then
    raise exception 'Acción de cuenta web inválida' using errcode = '22023';
  end if;

  select c.numero, c.nombre into v_numero, v_nombre
    from public.clientes c
   where c.id = p_cliente and c.organizacion_id = p_organizacion;
  select e.nombre into v_tienda
    from dominio.empresas e
   where e.id = p_empresa and e.organizacion_id = p_organizacion;

  perform private.insertar_actividad(
    p_organizacion,
    p_actor,
    'cliente.cuenta_' || p_accion,
    format('%s del cliente Nº %s · %s en %s', v_verbo, v_numero, v_nombre, v_tienda),
    p_empresa
  );
end;
$$;

revoke execute on function private.registrar_actividad_cuenta_cliente(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- «Restablecer clave» no cambia ninguna fila: lo dispara la Edge Function invitar-cliente (con el JWT del
-- operador) después de enviar el enlace, y esta RPC deja el evento. Solo con la cuenta activa.
create or replace function public.registrar_restablecimiento_cuenta_cliente(p_cliente uuid, p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := private.exigir_gestion_cuenta_cliente(p_cliente, p_empresa);

  if not exists (
    select 1 from public.cuentas_cliente cc
     where cc.cliente_id = p_cliente and cc.empresa_id = p_empresa and cc.estado = 'activa'
  ) then
    raise exception 'La cuenta web no está activa en esa tienda' using errcode = '22023';
  end if;

  perform private.registrar_actividad_cuenta_cliente(v_org, (select auth.uid()), p_cliente, p_empresa, 'restablecida');
end;
$$;

comment on function public.registrar_restablecimiento_cuenta_cliente(uuid, uuid) is
  'F-CLI-05: deja el evento cliente.cuenta_restablecida (actor, cliente y tienda) tras enviar el enlace para definir una nueva clave. Exige edición de Clientes, alcance sobre la tienda y cuenta activa.';

revoke execute on function public.registrar_restablecimiento_cuenta_cliente(uuid, uuid) from public, anon;
grant execute on function public.registrar_restablecimiento_cuenta_cliente(uuid, uuid) to authenticated;
