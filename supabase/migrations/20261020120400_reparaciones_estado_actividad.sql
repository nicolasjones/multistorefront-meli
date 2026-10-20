-- F-SVC-03 (MSF-303, épica MSF-182): actividad de estado, entrega y anulación de reparaciones.
-- Esquema: sin tablas nuevas (usa `dominio.reparaciones` y `public.registro_actividad`; Principio VII).
--
-- Un único disparador `security definer` sobre `dominio.reparaciones` registra, en la MISMA
-- transacción que la RPC, `reparacion.anulada` (cuando se completa `anulada_en`), `reparacion.entregada`
-- (cuando se completa `entrega_real`; la entrega también cambia el estado y NO genera además
-- `reparacion.estado_cambiado`) o `reparacion.estado_cambiado` (cuando cambia `estado_id`). El detalle usa
-- el código visible (R-0001) y los nombres de los estados, nunca ids. Sin sesión (`auth.uid()` nulo)
-- no registra nada. No interfiere con `reparacion.editada`, que mira solo los datos editables.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger reparaciones_registrar_actividad_estado on dominio.reparaciones;
--   drop function private.registrar_actividad_reparacion_estado();

create or replace function private.registrar_actividad_reparacion_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_codigo text := private.codigo_reparacion(new.numero);
  v_anterior text;
  v_nuevo text;
begin
  if v_actor is null then
    return new;
  end if;

  if new.anulada_en is not null and old.anulada_en is null then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'reparacion.anulada',
      format('Anuló la reparación %s: %s', v_codigo, coalesce(new.anulada_motivo, '')), new.empresa_id
    );
  elsif new.entrega_real is not null and old.entrega_real is null then
    select s.nombre into v_nuevo from dominio.estados_reparacion s where s.id = new.estado_id;
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'reparacion.entregada',
      format('Entregó la reparación %s (%s) a %s', v_codigo, coalesce(v_nuevo, ''), coalesce(new.entregado_por, '')),
      new.empresa_id
    );
  elsif new.estado_id is distinct from old.estado_id then
    select s.nombre into v_anterior from dominio.estados_reparacion s where s.id = old.estado_id;
    select s.nombre into v_nuevo from dominio.estados_reparacion s where s.id = new.estado_id;
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'reparacion.estado_cambiado',
      format('Cambió la reparación %s de %s a %s', v_codigo, coalesce(v_anterior, ''), coalesce(v_nuevo, '')),
      new.empresa_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_reparacion_estado() from public, anon, authenticated;

create trigger reparaciones_registrar_actividad_estado
  after update on dominio.reparaciones
  for each row execute function private.registrar_actividad_reparacion_estado();
