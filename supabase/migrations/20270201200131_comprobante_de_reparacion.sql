-- F-SVC-13 (MSF-418, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-004):
-- `public.comprobante_de_reparacion`, el comprobante vigente de una reparación para la tarjeta «Comprobante
-- asociado» del detalle.
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `dominio.comprobantes_venta` (`dominio`).
--
-- Devuelve `{ id, numero, tipo, estado, total, empresa_id, empresa }` del comprobante no anulado con origen en la
-- reparación, o `null` si no hay. Exige `service_tecnico` en `lectura` o más y una tienda accesible (P0002 si la
-- reparación no existe o no es accesible, 42501 sin permiso). El enlace a Ventas lo decide la pantalla según su
-- permiso en `ventas`; esta función solo expone los datos de cabecera (sin líneas ni cliente).
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.comprobante_de_reparacion(uuid);

create or replace function public.comprobante_de_reparacion(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_c dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las reparaciones' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.organizacion_id = v_org and c.origen_tipo = 'reparacion' and c.origen_id = v_rep.id
     and c.estado <> 'anulada';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_c.id,
    'numero', v_c.numero,
    'tipo', v_c.tipo,
    'estado', v_c.estado,
    'total', v_c.total_con_iva,
    'empresa_id', v_c.empresa_id,
    'empresa', (select e.nombre from dominio.empresas e where e.id = v_c.empresa_id and e.organizacion_id = v_org)
  );
end;
$$;

revoke execute on function public.comprobante_de_reparacion(uuid) from public, anon;
grant execute on function public.comprobante_de_reparacion(uuid) to authenticated;

comment on function public.comprobante_de_reparacion(uuid) is
  'F-SVC-13: comprobante vigente (no anulado) de una reparación, o null. Exige service_tecnico en lectura o más y tienda accesible.';
