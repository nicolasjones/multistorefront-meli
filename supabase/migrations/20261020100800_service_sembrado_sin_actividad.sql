-- F-SVC-01 (MSF-254, épica MSF-182): el sembrado de Service técnico no registra actividad.
-- Esquema: sin tablas nuevas (Principio VII); solo redefine funciones `private`.
--
-- Hallazgo de revisión: el sembrado corre en un trigger `after insert` de `public.organizaciones`; si
-- la organización la crea una persona con sesión, `auth.uid()` no es nulo y los triggers de alta
-- registraban 14 eventos («Creó el modelo…», «Creó el estado…») a su nombre. Ahora el trigger del
-- sembrado marca `app.sembrando` (local a la transacción) y los triggers de alta lo respetan. La marca se
-- limpia al terminar para no silenciar lo que la misma transacción haga después.
--
-- Migración aditiva (create or replace). Reversión: volver a las definiciones de
-- 20261020100300 (`sembrar_service_trigger`) y 20261020100600 (`registrar_actividad_*_alta`).

create or replace function private.sembrar_service_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.sembrando', '1', true);
  perform private.sembrar_service(new.id);
  perform set_config('app.sembrando', '', true);
  return new;
end;
$$;

revoke execute on function private.sembrar_service_trigger() from public, anon, authenticated;

create or replace function private.registrar_actividad_modelo_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce(current_setting('app.sembrando', true), '') = '1' then
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

create or replace function private.registrar_actividad_estado_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce(current_setting('app.sembrando', true), '') = '1' then
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
