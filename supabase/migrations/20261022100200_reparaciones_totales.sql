-- F-SVC-06 (MSF-362, épica MSF-199): totales derivados de la reparación.
-- Esquema (Principio VII): columnas nuevas de `dominio.reparaciones` → `dominio` (la tabla ya vive ahí).
--
-- `total_mano_obra` y `total_repuestos` los mantiene solo `private.recalcular_totales_reparacion`, que
-- llaman las RPC de ítems en la misma transacción. Sin escritura directa (la tabla no tiene grants de
-- insert/update) y con `select` por columna para `authenticated`.
--
-- Migración aditiva (dos columnas con default, una función). Reversión (migración posterior):
--   drop function private.bloquear_reparacion_para_items(uuid);
--   drop function private.recalcular_totales_reparacion(uuid);
--   alter table dominio.reparaciones drop column total_repuestos, drop column total_mano_obra;

alter table dominio.reparaciones
  add column total_mano_obra numeric(14, 2) not null default 0 check (total_mano_obra >= 0),
  add column total_repuestos numeric(14, 2) not null default 0 check (total_repuestos >= 0);

comment on column dominio.reparaciones.total_mano_obra is
  'Suma de los ítems de mano de obra (ARS sin IVA). Derivada: la escribe private.recalcular_totales_reparacion.';
comment on column dominio.reparaciones.total_repuestos is
  'Suma de los ítems de repuestos (ARS sin IVA). Derivada: la escribe private.recalcular_totales_reparacion.';

grant select (total_mano_obra, total_repuestos) on dominio.reparaciones to authenticated;

create or replace function private.recalcular_totales_reparacion(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update dominio.reparaciones r
     set total_mano_obra = coalesce((
           select sum(i.subtotal) from dominio.reparacion_items i
            where i.reparacion_id = r.id and i.tipo = 'mano_obra'), 0),
         total_repuestos = coalesce((
           select sum(i.subtotal) from dominio.reparacion_items i
            where i.reparacion_id = r.id and i.tipo = 'repuesto'), 0)
   where r.id = p_id;
$$;

revoke execute on function private.recalcular_totales_reparacion(uuid) from public, anon, authenticated;

-- Compuerta común de las RPC de ítems: sesión con organización, nivel `edicion` de `service_tecnico`,
-- reparación de la organización bloqueada (`for update`, serializa cargas simultáneas), tienda accesible
-- y situación abierta (ni anulada ni entregada/cerrada: 55000, FR-024).
create or replace function private.bloquear_reparacion_para_items(p_id uuid)
returns dominio.reparaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_cierra boolean;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) is distinct from 'edicion' then
    raise exception 'Tu rol no puede modificar los ítems de una reparación' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  -- Una tienda inaccesible se trata como inexistente (no revela que existe), igual que obtener_reparacion.
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada: los ítems son de solo lectura' using errcode = '55000';
  end if;
  select s.cierra into v_cierra
    from dominio.estados_reparacion s
   where s.id = v_actual.estado_id and s.organizacion_id = v_org;
  if v_actual.entrega_real is not null or coalesce(v_cierra, false) then
    raise exception 'La reparación ya fue entregada o cerrada: los ítems son de solo lectura' using errcode = '55000';
  end if;
  return v_actual;
end;
$$;

revoke execute on function private.bloquear_reparacion_para_items(uuid) from public, anon, authenticated;
