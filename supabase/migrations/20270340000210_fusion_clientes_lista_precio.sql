-- F-CLI-21 (MSF-453, spec 20270327-100000-listas-de-precios-por-cliente, Fase 2, T012): fusión de clientes y listas de precios.
-- El cliente que se CONSERVA mantiene su lista; el cliente absorbido (que se archiva) pierde la suya, para que una lista no quede
-- «con clientes asignados» por un cliente que ya no existe a efectos prácticos. La vista previa informa si las listas difieren.
-- `fusionar_clientes`: misma firma y mismos grants que 20270205110203, solo agrega `lista_precio_id = null` al archivar al
-- descartado. `vista_previa_fusion_clientes` suma `lista_precio_id` y `lista_nombre` AL FINAL (cambia el tipo de retorno: se
-- recrea con drop + create).
--
-- Esquemas (Principio VII): sin tablas nuevas; RPC de `public`. Migración aditiva.
-- Reversión (migración posterior): restaurar ambas funciones desde 20270205110203 y 20270205110204.

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
  v_act_c integer;
  v_tot_c integer;
  v_act_d integer;
  v_tot_d integer;
  v_gana uuid;
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

  -- FR-009 (D1: un usuario de Auth por cliente): si los dos tienen cuenta web hay que quedarse con UNA persona de
  -- acceso. Con las dos activas debe elegirla quien fusiona; si solo un lado tiene cuentas activas, prevalece esa.
  select count(*) filter (where cc.estado = 'activa'), count(*) into v_act_c, v_tot_c
    from public.cuentas_cliente cc where cc.cliente_id = p_conservar_id;
  select count(*) filter (where cc.estado = 'activa'), count(*) into v_act_d, v_tot_d
    from public.cuentas_cliente cc where cc.cliente_id = p_descartar_id;

  if p_cuenta_web_de is not null and p_cuenta_web_de not in (p_conservar_id, p_descartar_id) then
    raise exception 'La cuenta web elegida debe ser la de uno de los dos clientes' using errcode = '22023';
  end if;

  if v_tot_c > 0 and v_tot_d > 0 then
    if p_cuenta_web_de is not null then
      v_gana := p_cuenta_web_de;
    elsif v_act_c > 0 and v_act_d > 0 then
      raise exception 'Los dos clientes tienen cuenta web activa: elegí cuál se mantiene' using errcode = '22023';
    elsif v_act_d > 0 then
      v_gana := p_descartar_id;
    else
      v_gana := p_conservar_id;
    end if;
    -- La cuenta no elegida se da de baja (se elimina; el usuario de Auth queda sin uso).
    delete from public.cuentas_cliente cc
     where cc.cliente_id = case when v_gana = p_conservar_id then p_descartar_id else p_conservar_id end;
    get diagnostics v_bajas = row_count;
  end if;

  -- FR-006: todo en esta transacción (si algo falla, no queda nada a medias).
  update dominio.comprobantes_venta cv
     set cliente_id = p_conservar_id
   where cv.cliente_id = p_descartar_id and cv.organizacion_id = v_org;
  get diagnostics v_docs = row_count;

  -- La cuenta web que queda pasa al cliente conservado y la tienda se habilita en él (si no lo estaba).
  insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
  select p_conservar_id, cc.empresa_id, cc.organizacion_id
    from public.cuentas_cliente cc
   where cc.cliente_id = p_descartar_id
  on conflict (cliente_id, empresa_id) do nothing;

  update public.cuentas_cliente cc
     set cliente_id = p_conservar_id
   where cc.cliente_id = p_descartar_id and cc.organizacion_id = v_org;
  get diagnostics v_cuentas = row_count;

  -- Campañas: MSF-155 no se entregó y no existe tabla de campañas; no hay nada que reasignar.

  -- FR-007: el descartado se archiva (no se borra) y conserva sus datos de ficha.
  update public.clientes c
     set archivado_en = now(), lista_precio_id = null
   where c.id = p_descartar_id and c.organizacion_id = v_org;

  -- FR-008: evento en la misma transacción, con ambos clientes (nombre y Nº; nunca DNI/CUIT).
  perform private.registrar_actividad_fusion_clientes(v_org, (select auth.uid()), p_conservar_id, p_descartar_id);

  return jsonb_build_object(
    'documentos_reasignados', v_docs,
    'cuentas_reasignadas', v_cuentas,
    'campanas_reasignadas', 0, 'cuentas_dadas_de_baja', v_bajas
  );
end;
$$;

comment on function public.fusionar_clientes(uuid, uuid, uuid) is
  'F-CLI-18 (MSF-447): fusiona dos clientes de la organización de la sesión (solo Administrador): reasigna documentos de venta y cuenta web al conservado y archiva al descartado, todo en una transacción.';

revoke execute on function public.fusionar_clientes(uuid, uuid, uuid) from public, anon;
grant execute on function public.fusionar_clientes(uuid, uuid, uuid) to authenticated;

drop function if exists public.vista_previa_fusion_clientes(uuid, uuid);

create or replace function public.vista_previa_fusion_clientes(p_conservar_id uuid, p_descartar_id uuid)
returns table (
  cliente_id uuid,
  numero integer,
  nombre text,
  documentos bigint,
  cuentas_web_activas bigint,
  cuentas_web_total bigint,
  lista_precio_id uuid,
  lista_nombre text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
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
  if (select count(*) from public.clientes c
       where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org) <> 2 then
    raise exception 'Alguno de los clientes no existe' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.clientes c
              where c.id in (p_conservar_id, p_descartar_id) and c.archivado_en is not null) then
    raise exception 'Alguno de los clientes ya está archivado' using errcode = '22023';
  end if;

  return query
  select c.id, c.numero, c.nombre,
         (select count(*) from dominio.comprobantes_venta cv
           where cv.cliente_id = c.id and cv.organizacion_id = v_org),
         (select count(*) from public.cuentas_cliente cc
           where cc.cliente_id = c.id and cc.estado = 'activa'),
         (select count(*) from public.cuentas_cliente cc where cc.cliente_id = c.id),
         c.lista_precio_id,
         (select l.nombre from dominio.listas_precios l where l.id = c.lista_precio_id)
    from public.clientes c
   where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org
   order by (c.id = p_conservar_id) desc;
end;
$$;

comment on function public.vista_previa_fusion_clientes(uuid, uuid) is
  'F-CLI-18 (MSF-447): vista previa de solo lectura de la fusión (compras y cuentas web de cada cliente). Solo Administrador.';

revoke execute on function public.vista_previa_fusion_clientes(uuid, uuid) from public, anon;
grant execute on function public.vista_previa_fusion_clientes(uuid, uuid) to authenticated;
