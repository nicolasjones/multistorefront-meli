-- F-CLI-06 (MSF-428, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): consulta que usa la Edge
-- Function anónima `recuperar-clave-cliente` para decidir si envía el correo de recuperación. FR-023.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * public.cuenta_cliente_para_recuperar -> `public` (RPC de plataforma/autenticación, como el resto de las
--     de cuenta web); solo lee public.cuentas_cliente, public.clientes, public.clientes_empresas y dominio.tiendas.
--
-- Devuelve el correo de Auth y el dominio normalizado de la tienda SOLO si, en la tienda de ese host, el correo
-- pertenece a una cuenta web ACTIVA de un cliente no archivado y habilitado en esa empresa activa. Cualquier otro
-- caso (host desconocido, empresa desactivada, sin cuenta, suspendida, no habilitada, correo de un usuario del
-- panel) devuelve cero filas: la Edge Function responde igual en todos, sin enumerar cuentas.
-- Solo `service_role`: `anon` y `authenticated` no pueden preguntar por correos ajenos.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function public.cuenta_cliente_para_recuperar(text, text);

create or replace function public.cuenta_cliente_para_recuperar(p_host text, p_correo text)
returns table (correo text, dominio text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text, ti.dominio::text
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id and e.activa
    join public.cuentas_cliente cc on cc.empresa_id = e.id and cc.estado = 'activa'
    join public.clientes c on c.id = cc.cliente_id and c.archivado_en is null
    join public.clientes_empresas ce on ce.cliente_id = c.id and ce.empresa_id = e.id
    join auth.users u on u.id = cc.auth_user_id
   where ti.dominio = private.normalizar_host(p_host)
     and lower(u.email) = lower(btrim(p_correo))
   limit 1;
$$;

revoke execute on function public.cuenta_cliente_para_recuperar(text, text) from public, anon, authenticated;
grant execute on function public.cuenta_cliente_para_recuperar(text, text) to service_role;

comment on function public.cuenta_cliente_para_recuperar(text, text) is
  'F-CLI-06: correo de Auth y dominio de la tienda si el correo tiene cuenta web ACTIVA y habilitada en la tienda del host; si no, cero filas. Solo service_role (Edge Function recuperar-clave-cliente).';
