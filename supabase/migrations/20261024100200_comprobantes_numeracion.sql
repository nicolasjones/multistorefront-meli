-- F-VTA-05 (MSF-273, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-004):
-- numeración correlativa de comprobantes por organización, empresa y tipo.
--
-- Esquema (Principio VII): `dominio.comprobantes_venta_numeracion` es el contador del documento de
-- venta → `dominio`. RLS activa y SIN políticas ni grants: nadie la lee ni escribe directo; solo
-- `private.siguiente_numero_comprobante` (`security definer`). `anon` y `authenticated` sin privilegios.
--
-- Concurrencia: un único `insert ... on conflict do update` toma el bloqueo de la fila del contador, así
-- dos altas simultáneas se serializan y reciben números distintos y consecutivos. Si la transacción de
-- alta se revierte, el contador también (no hay saltos).
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes si hay datos):
--   drop function private.siguiente_numero_comprobante(uuid, text);
--   drop table dominio.comprobantes_venta_numeracion;
--   drop index dominio.empresas_id_organizacion_uq;   -- solo si ninguna otra FK lo usa

create unique index if not exists empresas_id_organizacion_uq
  on dominio.empresas (id, organizacion_id);

create table dominio.comprobantes_venta_numeracion (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  tipo text not null check (tipo in ('factura', 'presupuesto')),
  ultimo integer not null default 0 check (ultimo >= 0),
  primary key (organizacion_id, empresa_id, tipo),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.comprobantes_venta_numeracion is
  'Contador correlativo de comprobantes por organización, empresa y tipo (F-VTA-05). Sin acceso directo: solo private.siguiente_numero_comprobante.';

alter table dominio.comprobantes_venta_numeracion enable row level security;
-- Sin políticas: con RLS activa y sin política, ningún rol sin BYPASSRLS lee ni escribe.
revoke all on dominio.comprobantes_venta_numeracion from anon, authenticated, public;

-- Siguiente número del contador de la empresa y tipo. La organización sale de la sesión.
create or replace function private.siguiente_numero_comprobante(p_empresa_id uuid, p_tipo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_numero integer;
begin
  if v_org is null then
    raise exception 'Se necesita una sesión con organización' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('factura', 'presupuesto') then
    raise exception 'El tipo de comprobante no es válido' using errcode = '22023';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org) then
    raise exception 'La tienda no existe' using errcode = '22023';
  end if;

  insert into dominio.comprobantes_venta_numeracion as n (organizacion_id, empresa_id, tipo, ultimo)
  values (v_org, p_empresa_id, p_tipo, 1)
  on conflict (organizacion_id, empresa_id, tipo) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;

  return v_numero;
end;
$$;

revoke execute on function private.siguiente_numero_comprobante(uuid, text) from public, anon, authenticated;

comment on function private.siguiente_numero_comprobante(uuid, text) is
  'Correlativo transaccional por organización, empresa y tipo (F-VTA-05, FR-004). Solo la llaman las RPC security definer de comprobantes.';
