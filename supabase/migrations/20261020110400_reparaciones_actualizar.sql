-- F-SVC-02 (MSF-283, épica MSF-182): edición de la reparación (`actualizar_reparacion`).
-- Esquema: sin tablas nuevas (usa `dominio.reparaciones`; Principio VII).
--
-- SECURITY DEFINER (la tabla no admite update directo) con control explícito: organización de la
-- sesión, nivel `edicion` de `service_tecnico` y tienda accesible. Bloqueo optimista: el llamador
-- envía el `updated_at` que leyó; si cambió se rechaza con 40001 y no se pisa nada. No edita
-- reparaciones anuladas (55000) ni cambia número, tienda ni estado (el estado va por F-SVC-03).
-- Costos: `null` = sin cambio; un valor exige la acción `ver_costos` (42501 si no la tiene).
-- Los errores de validación llevan en `hint` el campo afectado.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.actualizar_reparacion(uuid, timestamptz, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date, date);

create or replace function public.actualizar_reparacion(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_cliente_id uuid,
  p_modelo_id uuid,
  p_contacto text default '',
  p_numero_serie text default null,
  p_accesorios text default '',
  p_falla text default '',
  p_costo_mano_obra numeric default null,
  p_costo_repuestos numeric default null,
  p_tecnico_id uuid default null,
  p_ingreso_en date default null,
  p_entrega_prevista date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_ingreso date;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede editar reparaciones' using errcode = '42501';
  end if;

  -- Serializa ediciones concurrentes de la misma reparación.
  select * into v_actual
    from dominio.reparaciones r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_actual.empresa_id) then
    raise exception 'No tenés acceso a la tienda de esta reparación' using errcode = '42501';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La reparación fue modificada por otra persona' using errcode = '40001';
  end if;
  if v_actual.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede editar' using errcode = '55000';
  end if;

  if p_cliente_id is null then
    raise exception 'Elegí el cliente' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_cliente_id <> v_actual.cliente_id and not exists (
    select 1 from public.clientes c
     where c.id = p_cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente no existe o está archivado' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_modelo_id is null then
    raise exception 'Elegí el modelo' using errcode = '22023', hint = 'modelo_id';
  end if;
  if p_modelo_id <> v_actual.modelo_id and not exists (
    select 1 from dominio.modelos_equipo m
     where m.id = p_modelo_id and m.organizacion_id = v_org and m.activo
  ) then
    raise exception 'El modelo no existe o está desactivado' using errcode = '22023', hint = 'modelo_id';
  end if;
  if p_costo_mano_obra < 0 then
    raise exception 'El costo de mano de obra no puede ser negativo' using errcode = '22023', hint = 'costo_mano_obra';
  end if;
  if p_costo_repuestos < 0 then
    raise exception 'El costo de repuestos no puede ser negativo' using errcode = '22023', hint = 'costo_repuestos';
  end if;
  if (p_costo_mano_obra is not null or p_costo_repuestos is not null)
     and not (select private.puede_accion('service_tecnico', 'ver_costos')) then
    raise exception 'Tu rol no puede cargar costos internos' using errcode = '42501';
  end if;
  if p_tecnico_id is not null and p_tecnico_id is distinct from v_actual.tecnico_id
     and not private.es_tecnico_de_service(p_tecnico_id) then
    raise exception 'El técnico no es válido' using errcode = '22023', hint = 'tecnico_id';
  end if;
  v_ingreso := coalesce(p_ingreso_en, v_actual.ingreso_en);
  if p_entrega_prevista is not null and p_entrega_prevista < v_ingreso then
    raise exception 'La entrega prevista no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_prevista';
  end if;

  update dominio.reparaciones
     set cliente_id = p_cliente_id,
         modelo_id = p_modelo_id,
         contacto = coalesce(p_contacto, ''),
         numero_serie = p_numero_serie,
         accesorios = coalesce(p_accesorios, ''),
         falla = coalesce(p_falla, ''),
         costo_mano_obra = coalesce(p_costo_mano_obra, costo_mano_obra),
         costo_repuestos = coalesce(p_costo_repuestos, costo_repuestos),
         tecnico_id = p_tecnico_id,
         ingreso_en = v_ingreso,
         entrega_prevista = p_entrega_prevista
   where id = p_id;

  return private.reparacion_json(p_id);
end;
$$;

comment on function public.actualizar_reparacion(uuid, timestamptz, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date, date) is
  'F-SVC-02: edita una reparación con bloqueo optimista (40001); rechaza anuladas (55000); no cambia número, tienda ni estado; costos solo con ver_costos.';

revoke execute on function public.actualizar_reparacion(uuid, timestamptz, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date, date) from public, anon;
grant execute on function public.actualizar_reparacion(uuid, timestamptz, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date, date) to authenticated;
