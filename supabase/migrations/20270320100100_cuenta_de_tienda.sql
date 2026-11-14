-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T002.
--
-- Esquema (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * private.cuenta_de_tienda -> `private`: lógica interna de identidad, sin acceso de API.
--
-- Único punto de identidad y aislamiento de toda RPC de cuenta (`mis_*`, `cambiar_favorito`, y luego B1 y B2): devuelve
-- `(cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo)` de la sesión `auth.uid()` en la tienda del host SOLO si
-- la cuenta está `activa`, el cliente está habilitado en `public.clientes_empresas`, no está archivado y no es consumidor final,
-- y la empresa del host está activa. Es la misma regla que `publico.acceso_cliente_por_dominio`. En cualquier otro caso (sin
-- sesión, sin cuenta, suspendida, no habilitada, otra tienda, usuario de panel, host desconocido, empresa desactivada) no
-- devuelve nada: la RPC que la llama responde `sin_acceso`, idéntico en todos los casos.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists private.cuenta_de_tienda(text);

create or replace function private.cuenta_de_tienda(p_host text)
returns table (
  cuenta_cliente_id uuid,
  cliente_id uuid,
  organizacion_id uuid,
  empresa_id uuid,
  tipo text
)
language sql
stable
security definer
set search_path = ''
as $$
  select cc.id, cc.cliente_id, cc.organizacion_id, cc.empresa_id, c.tipo
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id and e.activa
    join public.cuentas_cliente cc on cc.empresa_id = e.id and cc.organizacion_id = e.organizacion_id
    join public.clientes c on c.id = cc.cliente_id and c.organizacion_id = cc.organizacion_id
    join public.clientes_empresas ce
      on ce.cliente_id = c.id and ce.empresa_id = e.id and ce.organizacion_id = c.organizacion_id
   where ti.dominio = private.normalizar_host(p_host)
     and cc.auth_user_id = (select auth.uid())
     and cc.estado = 'activa'
     and c.archivado_en is null
     and not c.es_consumidor_final;
$$;

revoke execute on function private.cuenta_de_tienda(text) from public, anon, authenticated;

comment on function private.cuenta_de_tienda(text) is
  'MSF-176: identidad única de las RPC de cuenta de la tienda. (cuenta_cliente_id, cliente_id, organizacion_id, empresa_id, tipo) de auth.uid() en la tienda del host solo si la cuenta está activa, el cliente habilitado en la empresa, no archivado ni consumidor final y la empresa activa; si no, ninguna fila. Sin execute para la API.';
