-- F-SVC-03 (MSF-303, épica MSF-182): anulación de una reparación (`anular_reparacion`).
-- Esquema: sin tablas nuevas (Principio VII: `dominio.reparaciones` y `dominio.reparacion_historial`).
--
-- SECURITY DEFINER con control explícito (organización, `edicion` en `service_tecnico`, tienda
-- accesible) y bloqueo de la fila. Motivo obligatorio (hasta 500 caracteres, 22023 con `hint`
-- `motivo`). Guarda `anulada_en`/`anulada_motivo` y escribe el evento `anulacion` (con el motivo en
-- `nota`) en la misma transacción. Irreversible: no hay RPC inversa y una reparación ya anulada se
-- rechaza (55000). Queda de solo lectura porque `actualizar_reparacion`, `cambiar_estado_reparacion`
-- y `registrar_entrega_reparacion` rechazan las anuladas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.anular_reparacion(uuid, text);

create or replace function public.anular_reparacion(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede anular reparaciones' using errcode = '42501';
  end if;

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
  if v_actual.anulada_en is not null then
    raise exception 'La reparación ya está anulada' using errcode = '55000';
  end if;
  if v_motivo = '' then
    raise exception 'Indicá el motivo de la anulación' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 500 then
    raise exception 'Máximo 500 caracteres' using errcode = '22023', hint = 'motivo';
  end if;

  update dominio.reparaciones
     set anulada_en = now(), anulada_motivo = v_motivo
   where id = p_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, nota, usuario_id, creado_en)
  values (v_org, p_id, 'anulacion', v_actual.estado_id, v_actual.estado_id, v_motivo, (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$$;

comment on function public.anular_reparacion(uuid, text) is
  'F-SVC-03: anula con motivo obligatorio; irreversible; la reparación queda de solo lectura. Solo con edición en Service técnico.';

revoke execute on function public.anular_reparacion(uuid, text) from public, anon;
grant execute on function public.anular_reparacion(uuid, text) to authenticated;
