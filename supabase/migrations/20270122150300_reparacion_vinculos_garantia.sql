-- F-SVC-21 (MSF-146, épica MSF-124): `public.obtener_vinculos_garantia`.
-- Esquema: sin tablas nuevas (solo lectura de `dominio.reparaciones`; Principio VII).
--
-- Acepta `lectura` o `edicion` en `service_tecnico`; la reparación debe ser de la organización de la sesión y de
-- una tienda accesible (si no, `P0002`). Devuelve `{ origen: {id, codigo} | null, reingresos: [{id, codigo,
-- estado, ingreso}] }`. Es una RPC aparte para no reemplazar `obtener_reparacion`.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.obtener_vinculos_garantia(uuid);

create or replace function public.obtener_vinculos_garantia(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_origen jsonb;
  v_reingresos jsonb;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las reparaciones' using errcode = '42501';
  end if;

  select * into v_rep
    from dominio.reparaciones r
   where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found
     or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;

  select jsonb_build_object('id', o.id, 'codigo', private.codigo_reparacion(o.numero)) into v_origen
    from dominio.reparaciones o
   where o.id = v_rep.reparacion_origen_id and o.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() a(id) where a.id = o.empresa_id);

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', h.id,
             'codigo', private.codigo_reparacion(h.numero),
             'estado', s.nombre,
             'ingreso', h.ingreso_en
           ) order by h.ingreso_en, h.numero, h.id), '[]'::jsonb)
    into v_reingresos
    from dominio.reparaciones h
    join dominio.estados_reparacion s on s.id = h.estado_id and s.organizacion_id = h.organizacion_id
   where h.reparacion_origen_id = p_reparacion
     and h.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() a(id) where a.id = h.empresa_id);

  return jsonb_build_object('origen', v_origen, 'reingresos', v_reingresos);
end;
$$;

comment on function public.obtener_vinculos_garantia(uuid) is
  'F-SVC-21: reparación de origen y reingresos por garantía de una reparación (lectura; solo tiendas accesibles).';

revoke execute on function public.obtener_vinculos_garantia(uuid) from public, anon;
grant execute on function public.obtener_vinculos_garantia(uuid) to authenticated;
