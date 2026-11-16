-- F-SVC-11 (MSF-402, épica MSF-217, FR-022, FR-023, FR-024): anular una reparación devuelve sus repuestos al stock.
--
-- Esquema: sin tablas nuevas (Principio VII; escribe `dominio.reparaciones`, `dominio.reparacion_historial`,
-- `dominio.reparacion_items` y, por `private.devolver_stock_item_reparacion`, el stock y su libro, todo en `dominio`).
--
-- `anular_reparacion(p_id, p_motivo, p_consumidos uuid[] default '{}')`: en la misma transacción que la anulación,
-- cada repuesto `descontado` cuyo id NO viene en `p_consumidos` vuelve a su depósito original y queda `devuelto`; los
-- que vienen quedan `consumido` y NO vuelven (FR-023). Un id de `p_consumidos` que no sea un repuesto `descontado` de
-- esta reparación es `22023` (hint `consumidos`) y no se anula nada. Pendientes, libres y mano de obra no mueven stock
-- (FR-024). Una reparación ya entregada conserva el comportamiento de MSF-182 (se puede anular) pero NO devuelve stock:
-- sus ítems son de solo lectura y los consumidos no se pueden marcar (`22023`).
--
-- CONTRATO que cambia (alto riesgo, gate humano): la firma `(uuid, text)` desaparece y la de 3 parámetros suma
-- `p_consumidos` con default; `apps/web/src/lib/reparaciones.ts` se actualiza en el mismo cambio.
--
-- Migración aditiva en datos. Reversión (migración posterior; las devoluciones ya hechas no se deshacen solas):
--   drop function public.anular_reparacion(uuid, text, uuid[]);
--   restaurar `anular_reparacion(uuid, text)` de 20261020120300_reparaciones_anular.sql (con grants).

drop function if exists public.anular_reparacion(uuid, text);

create or replace function public.anular_reparacion(p_id uuid, p_motivo text, p_consumidos uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.reparaciones;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_consumidos uuid[] := coalesce(p_consumidos, '{}');
  v_entregada boolean;
  v_item uuid;
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

  v_entregada := v_actual.entrega_real is not null
    or exists (select 1 from dominio.estados_reparacion s
                where s.id = v_actual.estado_id and s.organizacion_id = v_org and s.cierra);

  -- Los consumidos deben ser repuestos descontados de ESTA reparación (y sin repetir).
  if cardinality(v_consumidos) > 0 and (
       v_entregada
       or (select count(distinct c) from unnest(v_consumidos) c) <> cardinality(v_consumidos)
       or (select count(*) from dominio.reparacion_items i
            where i.reparacion_id = p_id and i.organizacion_id = v_org
              and i.stock_estado = 'descontado' and i.id = any (v_consumidos)) <> cardinality(v_consumidos)) then
    raise exception 'Solo se puede marcar como consumido un repuesto descontado de esta reparación'
      using errcode = '22023', hint = 'consumidos';
  end if;

  update dominio.reparaciones
     set anulada_en = now(), anulada_motivo = v_motivo
   where id = p_id;

  if not v_entregada then
    for v_item in
      select i.id from dominio.reparacion_items i
       where i.reparacion_id = p_id and i.organizacion_id = v_org and i.stock_estado = 'descontado'
       order by i.producto_id, i.id
    loop
      if v_item = any (v_consumidos) then
        update dominio.reparacion_items set stock_estado = 'consumido' where id = v_item;
      else
        perform private.devolver_stock_item_reparacion(v_org, v_item);
      end if;
    end loop;
  end if;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_anterior_id, estado_nuevo_id, nota, usuario_id, creado_en)
  values (v_org, p_id, 'anulacion', v_actual.estado_id, v_actual.estado_id, v_motivo, (select auth.uid()), clock_timestamp());

  return private.reparacion_json(p_id);
end;
$$;

comment on function public.anular_reparacion(uuid, text, uuid[]) is
  'F-SVC-11: anula con motivo obligatorio; devuelve al stock los repuestos descontados salvo los marcados consumidos; irreversible. Solo con edición en Service técnico.';

revoke execute on function public.anular_reparacion(uuid, text, uuid[]) from public, anon;
grant execute on function public.anular_reparacion(uuid, text, uuid[]) to authenticated;
