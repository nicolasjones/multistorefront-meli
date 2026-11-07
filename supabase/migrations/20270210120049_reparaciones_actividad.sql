-- F-SVC-02 (MSF-283, épica MSF-182): actividad de reparaciones.
-- Esquema: sin tablas nuevas (usa `dominio.reparaciones` y `public.registro_actividad`; Principio VII).
--
-- Disparadores `security definer` que registran `reparacion.creada` y `reparacion.editada` en la
-- MISMA transacción que la operación (FR-020), con el código visible (R-0001), nunca ids. Sin
-- evento si no hubo cambio de datos editables (`updated_at` no avanzó o solo cambió estado /
-- entrega / anulación, que registra F-SVC-03). Sin sesión (`auth.uid()` nulo) no se registra nada.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger reparaciones_registrar_actividad_alta on dominio.reparaciones;
--   drop trigger reparaciones_registrar_actividad on dominio.reparaciones;
--   drop function private.registrar_actividad_reparacion_alta();
--   drop function private.registrar_actividad_reparacion();

create or replace function private.registrar_actividad_reparacion_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'reparacion.creada',
    format('Creó la reparación %s', private.codigo_reparacion(new.numero)), new.empresa_id
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_reparacion_alta() from public, anon, authenticated;

create trigger reparaciones_registrar_actividad_alta
  after insert on dominio.reparaciones
  for each row execute function private.registrar_actividad_reparacion_alta();

create or replace function private.registrar_actividad_reparacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or new.updated_at is not distinct from old.updated_at then
    return new;
  end if;
  if (new.cliente_id, new.contacto, new.modelo_id, new.numero_serie, new.accesorios, new.falla,
      new.costo_mano_obra, new.costo_repuestos, new.tecnico_id, new.ingreso_en, new.entrega_prevista)
     is distinct from
     (old.cliente_id, old.contacto, old.modelo_id, old.numero_serie, old.accesorios, old.falla,
      old.costo_mano_obra, old.costo_repuestos, old.tecnico_id, old.ingreso_en, old.entrega_prevista) then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'reparacion.editada',
      format('Editó la reparación %s', private.codigo_reparacion(new.numero)), new.empresa_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_reparacion() from public, anon, authenticated;

create trigger reparaciones_registrar_actividad
  after update on dominio.reparaciones
  for each row execute function private.registrar_actividad_reparacion();
