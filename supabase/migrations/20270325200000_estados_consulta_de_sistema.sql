-- Estados de consulta «de sistema» (F-CFG-01, endurecimiento): un estado que el flujo de la consulta
-- necesita (p. ej. el que usa la acción «Cerrar») no puede desactivarse, renombrarse ni borrarse desde
-- la lista configurable, porque se rompería el cierre.
--
-- Hoy `dominio.estados_consulta` no tiene estados sembrados y ningún flujo los usa todavía: la
-- migración deja el MECANISMO (columna `es_sistema` + guarda en la base) listo; el primer estado de
-- sistema lo marca la migración de la funcionalidad que lo necesite, nunca la app.
--
-- Esquema (Principio VII): la tabla ya vive en `dominio`; no se crea ninguna. RLS y grants de la
-- tabla no cambian (select/insert/update a authenticated, sin delete, nada a anon).
-- La guarda es un trigger `security invoker` (corre también por las RPC de la lista, que son
-- `security invoker`): errores 23514 con mensaje en castellano que la interfaz muestra tal cual.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger estados_consulta_proteger_sistema on dominio.estados_consulta;
--   drop function private.proteger_estado_consulta_sistema();
--   alter table dominio.estados_consulta drop column es_sistema;

alter table dominio.estados_consulta
  add column if not exists es_sistema boolean not null default false;

comment on column dominio.estados_consulta.es_sistema is
  'Estado que el flujo de la consulta necesita (p. ej. el de «Cerrar»): no se desactiva, renombra ni borra. Solo lo marca una migración.';

create or replace function private.proteger_estado_consulta_sistema()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Marcar un estado como de sistema es cosa de migraciones, no de quien usa la app.
    if new.es_sistema and current_user in ('authenticated', 'anon') then
      raise exception 'Un estado de sistema solo se crea por migración' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.es_sistema then
      raise exception 'El estado «%» es de sistema: lo necesita el cierre de las consultas y no se puede borrar', old.nombre
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.es_sistema is distinct from old.es_sistema and current_user in ('authenticated', 'anon') then
    raise exception 'No se puede cambiar si un estado es de sistema' using errcode = '23514';
  end if;
  if old.es_sistema then
    if not new.activo then
      raise exception 'El estado «%» es de sistema: lo necesita el cierre de las consultas y no se puede desactivar', old.nombre
        using errcode = '23514';
    end if;
    if new.nombre is distinct from old.nombre then
      raise exception 'El estado «%» es de sistema: lo necesita el cierre de las consultas y no se puede renombrar', old.nombre
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.proteger_estado_consulta_sistema() from public, anon, authenticated;

drop trigger if exists estados_consulta_proteger_sistema on dominio.estados_consulta;
create trigger estados_consulta_proteger_sistema
  before insert or update or delete on dominio.estados_consulta
  for each row execute function private.proteger_estado_consulta_sistema();
