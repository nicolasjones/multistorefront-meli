-- F-SVC-01 (MSF-254, épica MSF-182): actividad de modelos de equipo y estados de reparación.
-- Esquema: sin tablas nuevas (usa `dominio.modelos_equipo`, `dominio.estados_reparacion` y
-- `public.registro_actividad`; Principio VII).
--
-- Disparadores `security definer` que registran `modelo.creado|editado|desactivado|reactivado` y
-- `estado.creado|editado|desactivado|reactivado|reordenado` en la MISMA transacción, con el nombre
-- visible (nunca ids). Sin evento si no hubo cambio real (`updated_at` no avanzó), así las
-- operaciones idempotentes no duplican. Sin sesión (`auth.uid()` nulo: sembrado, migraciones) no se
-- registra nada.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger modelos_equipo_registrar_actividad_alta on dominio.modelos_equipo;
--   drop trigger modelos_equipo_registrar_actividad on dominio.modelos_equipo;
--   drop trigger estados_reparacion_registrar_actividad_alta on dominio.estados_reparacion;
--   drop trigger estados_reparacion_registrar_actividad on dominio.estados_reparacion;
--   drop function private.registrar_actividad_modelo_alta();
--   drop function private.registrar_actividad_modelo();
--   drop function private.registrar_actividad_estado_alta();
--   drop function private.registrar_actividad_estado();

create or replace function private.registrar_actividad_modelo_alta()
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
    new.organizacion_id, v_actor, 'modelo.creado',
    format('Creó el modelo %s %s', new.equipo, new.modelo), null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_modelo_alta() from public, anon, authenticated;

create trigger modelos_equipo_registrar_actividad_alta
  after insert on dominio.modelos_equipo
  for each row execute function private.registrar_actividad_modelo_alta();

create or replace function private.registrar_actividad_modelo()
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
  if (new.equipo, new.modelo, new.mano_obra_base) is distinct from (old.equipo, old.modelo, old.mano_obra_base) then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'modelo.editado',
      format('Editó el modelo %s %s', new.equipo, new.modelo), null
    );
  end if;
  if new.activo is distinct from old.activo then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor,
      case when new.activo then 'modelo.reactivado' else 'modelo.desactivado' end,
      format('%s el modelo %s %s', case when new.activo then 'Reactivó' else 'Desactivó' end, new.equipo, new.modelo),
      null
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_modelo() from public, anon, authenticated;

create trigger modelos_equipo_registrar_actividad
  after update on dominio.modelos_equipo
  for each row execute function private.registrar_actividad_modelo();

create or replace function private.registrar_actividad_estado_alta()
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
    new.organizacion_id, v_actor, 'estado.creado',
    format('Creó el estado de reparación %s', new.nombre), null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_estado_alta() from public, anon, authenticated;

create trigger estados_reparacion_registrar_actividad_alta
  after insert on dominio.estados_reparacion
  for each row execute function private.registrar_actividad_estado_alta();

create or replace function private.registrar_actividad_estado()
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
  if (new.nombre, new.descripcion, new.avisa_cliente) is distinct from (old.nombre, old.descripcion, old.avisa_cliente) then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'estado.editado',
      format('Editó el estado de reparación %s', new.nombre), null
    );
  end if;
  if new.orden is distinct from old.orden then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'estado.reordenado',
      format('Reordenó el estado de reparación %s (lugar %s → %s)', new.nombre, old.orden, new.orden), null
    );
  end if;
  if new.activo is distinct from old.activo then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor,
      case when new.activo then 'estado.reactivado' else 'estado.desactivado' end,
      format('%s el estado de reparación %s', case when new.activo then 'Reactivó' else 'Desactivó' end, new.nombre),
      null
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_estado() from public, anon, authenticated;

create trigger estados_reparacion_registrar_actividad
  after update on dominio.estados_reparacion
  for each row execute function private.registrar_actividad_estado();
