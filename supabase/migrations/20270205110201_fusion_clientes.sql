-- Renumerada al integrar la base `dokploy` (máxima `20270203120000`): antes `20270115100000_fusion_clientes.sql`;
-- la versión vieja quedó bajo la cola aplicada y el aplicador la salteaba.
--
-- F-CLI-18 (MSF-447, épica MSF-445, spec 20261029-100000-mejoras-de-clientes-y-proveedores): fusión de clientes
-- duplicados. FR-006, FR-007, FR-010, FR-011.
--
-- Esquemas (Principio VII), verificados objeto por objeto: no se crea ninguna tabla. Las RPC viven en `public`
-- (plataforma: operan sobre public.clientes y public.cuentas_cliente); dominio.comprobantes_venta (`dominio`) solo
-- cambia el cliente_id de sus filas. Sin cambios de esquema de datos.
--
-- `public.fusionar_clientes(p_conservar_id, p_descartar_id, p_cuenta_web_de)`: solo Administrador (se verifica en la
-- base), bloquea ambas filas por id, valida, reasigna documentos de venta y cuenta web al conservado y archiva al
-- descartado. No existe tabla de campañas (MSF-155 sin entregar): no hay nada que reasignar. Esta primera versión
-- rechaza si los dos tienen cuenta web; la siguiente migración resuelve la cuenta a mantener (FR-009).
--
-- Migración aditiva (funciones nuevas). Reversión (migración posterior; los datos ya fusionados no se restauran
-- sin respaldo):
--   drop function public.fusionar_clientes(uuid, uuid, uuid);

create or replace function public.fusionar_clientes(
  p_conservar_id uuid,
  p_descartar_id uuid,
  p_cuenta_web_de uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_docs integer;
  v_cuentas integer;
  v_bajas integer := 0;
  v_existen integer;
  v_archivados integer;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo el Administrador puede fusionar clientes' using errcode = '42501';
  end if;
  if p_conservar_id is null or p_descartar_id is null then
    raise exception 'Elegí los dos clientes a fusionar' using errcode = '22023';
  end if;
  if p_conservar_id = p_descartar_id then
    raise exception 'No se puede fusionar un cliente consigo mismo' using errcode = '22023';
  end if;

  -- FR-011: bloquea ambas filas en orden por id (sin interbloqueos entre dos fusiones cruzadas).
  perform 1 from (
    select c.id from public.clientes c
     where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org
     order by c.id for update
  ) bloqueo;

  select count(*), count(*) filter (where c.archivado_en is not null) into v_existen, v_archivados
    from public.clientes c
   where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org;
  if v_existen <> 2 then
    raise exception 'Alguno de los clientes no existe' using errcode = 'P0002';
  end if;
  if v_archivados > 0 then
    raise exception 'Alguno de los clientes ya está archivado (¿la fusión ya se hizo?)' using errcode = '22023';
  end if;

  -- Hasta la migración de cuenta web: no se fusionan clientes que ambos tengan cuenta web.
  if exists (select 1 from public.cuentas_cliente cc where cc.cliente_id = p_conservar_id)
     and exists (select 1 from public.cuentas_cliente cc where cc.cliente_id = p_descartar_id) then
    raise exception 'Los dos clientes tienen cuenta web: elegí cuál se mantiene' using errcode = '22023';
  end if;

  -- FR-006: todo en esta transacción (si algo falla, no queda nada a medias).
  update dominio.comprobantes_venta cv
     set cliente_id = p_conservar_id
   where cv.cliente_id = p_descartar_id and cv.organizacion_id = v_org;
  get diagnostics v_docs = row_count;

  update public.cuentas_cliente cc
     set cliente_id = p_conservar_id
   where cc.cliente_id = p_descartar_id and cc.organizacion_id = v_org;
  get diagnostics v_cuentas = row_count;

  -- Campañas: MSF-155 no se entregó y no existe tabla de campañas; no hay nada que reasignar.

  -- FR-007: el descartado se archiva (no se borra) y conserva sus datos de ficha.
  update public.clientes c
     set archivado_en = now()
   where c.id = p_descartar_id and c.organizacion_id = v_org;

  return jsonb_build_object(
    'documentos_reasignados', v_docs,
    'cuentas_reasignadas', v_cuentas,
    'campanas_reasignadas', 0
  );
end;
$$;

comment on function public.fusionar_clientes(uuid, uuid, uuid) is
  'F-CLI-18 (MSF-447): fusiona dos clientes de la organización de la sesión (solo Administrador): reasigna documentos de venta y cuenta web al conservado y archiva al descartado, todo en una transacción.';

revoke execute on function public.fusionar_clientes(uuid, uuid, uuid) from public, anon;
grant execute on function public.fusionar_clientes(uuid, uuid, uuid) to authenticated;
