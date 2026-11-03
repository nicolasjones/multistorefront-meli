-- F-CLI-18 (MSF-447): vista previa de la fusión (solo lectura). FR-012.
--
-- Esquemas (Principio VII): sin tablas nuevas; RPC de `public` de solo lectura.
--
-- Devuelve, para cada uno de los dos clientes, su Nº, nombre, cantidad de documentos de venta y cuentas web
-- (activas / total), para que el diálogo muestre «3 y 5 compras» y si hay que resolver la cuenta web. Mismas
-- validaciones de permiso (Administrador) y organización que `fusionar_clientes`; no escribe nada.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.vista_previa_fusion_clientes(uuid, uuid);

create or replace function public.vista_previa_fusion_clientes(p_conservar_id uuid, p_descartar_id uuid)
returns table (
  cliente_id uuid,
  numero integer,
  nombre text,
  documentos bigint,
  cuentas_web_activas bigint,
  cuentas_web_total bigint
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
         (select count(*) from public.cuentas_cliente cc where cc.cliente_id = c.id)
    from public.clientes c
   where c.id in (p_conservar_id, p_descartar_id) and c.organizacion_id = v_org
   order by (c.id = p_conservar_id) desc;
end;
$$;

comment on function public.vista_previa_fusion_clientes(uuid, uuid) is
  'F-CLI-18 (MSF-447): vista previa de solo lectura de la fusión (compras y cuentas web de cada cliente). Solo Administrador.';

revoke execute on function public.vista_previa_fusion_clientes(uuid, uuid) from public, anon;
grant execute on function public.vista_previa_fusion_clientes(uuid, uuid) to authenticated;
