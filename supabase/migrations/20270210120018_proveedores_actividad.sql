-- F-PRV-01 (MSF-336, épica MSF-205): actividad de proveedores.
-- Esquema: sin tablas nuevas (usa `dominio.proveedores` y `public.registro_actividad`; Principio VII).
--
-- Un disparador `security definer` registra `proveedor.creado|editado|desactivado|reactivado`
-- en la misma transacción, con la razón social (nunca ids ni CUIT en el detalle). Sin evento
-- si no hubo cambio real (`updated_at` no avanzó), así las operaciones idempotentes no duplican.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger proveedores_registrar_actividad_alta on dominio.proveedores;
--   drop trigger proveedores_registrar_actividad on dominio.proveedores;
--   drop function private.registrar_actividad_proveedor_alta();
--   drop function private.registrar_actividad_proveedor();

create or replace function private.registrar_actividad_proveedor_alta()
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
    new.organizacion_id, v_actor, 'proveedor.creado',
    format('Creó el proveedor %s', new.razon_social), null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_proveedor_alta() from public, anon, authenticated;

create trigger proveedores_registrar_actividad_alta
  after insert on dominio.proveedores
  for each row execute function private.registrar_actividad_proveedor_alta();

create or replace function private.registrar_actividad_proveedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_datos_cambian boolean;
begin
  if v_actor is null or new.updated_at is not distinct from old.updated_at then
    return new;
  end if;
  v_datos_cambian :=
    (new.razon_social, new.cuit, new.persona_contacto, new.correo, new.telefono, new.direccion, new.observaciones)
    is distinct from
    (old.razon_social, old.cuit, old.persona_contacto, old.correo, old.telefono, old.direccion, old.observaciones);

  if v_datos_cambian then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'proveedor.editado',
      format('Editó el proveedor %s', new.razon_social), null
    );
  end if;
  if new.activo is distinct from old.activo then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor,
      case when new.activo then 'proveedor.reactivado' else 'proveedor.desactivado' end,
      format('%s el proveedor %s', case when new.activo then 'Reactivó' else 'Desactivó' end, new.razon_social),
      null
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_proveedor() from public, anon, authenticated;

create trigger proveedores_registrar_actividad
  after update on dominio.proveedores
  for each row execute function private.registrar_actividad_proveedor();
