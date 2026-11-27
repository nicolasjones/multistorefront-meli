-- Estados de consulta configurables conectados a `dominio.consultas.estado` (MSF-595).
--
-- Hasta ahora `consultas.estado` tenía un check cerrado ('nueva', 'en_curso', 'resuelta') y `actualizar_consulta` solo
-- admitía esos tres, así que los estados de la lista configurable (`dominio.estados_consulta`) no se podían usar.
--
-- Qué hace:
--   1. `dominio.estados_consulta.clave` (nueva): identificador estable del estado, el valor que guarda `consultas.estado`.
--      Los tres de base conservan sus claves históricas (`nueva`, `en_curso`, `resuelta`); un estado creado por el
--      Administrador usa su propio id como clave, así renombrarlo no deja consultas huérfanas. La clave no cambia nunca.
--   2. Siembra los tres estados de base en cada organización (existentes y nuevas) como `es_sistema`: no se desactivan
--      ni se renombran (el mecanismo es el de 20270507000400). Si una organización ya había creado un estado con el
--      mismo nombre, esa fila se adopta como el de base (se reactiva y se marca de sistema), sin duplicar.
--   3. Quita el check cerrado de `consultas.estado`; queda solo una guarda de formato. La validez del valor la decide
--      `actualizar_consulta`: acepta cualquier estado ACTIVO de la organización, o el que la consulta ya tiene aunque
--      se haya desactivado después (sigue mostrándose y se puede guardar sin cambiarlo).
--   4. `actualizar_consulta`: `PT404` si el estado no existe en la organización; `PT412` (detail `estado`) si está
--      desactivado. El `PT412` sin detail sigue siendo el conflicto de edición (sello `updated_at`).
--
-- Esquema (Principio VII): ninguna tabla nueva; la columna va en `dominio.estados_consulta`. Sin cambios de RLS ni de
-- grants. La siembra de organizaciones nuevas es un trigger `security definer` con `search_path` vacío.
--
-- Migración aditiva. Reversión (migración posterior; antes, pasar a mano las consultas con estados propios a uno de base):
--   alter table dominio.consultas drop constraint consultas_estado_formato;
--   alter table dominio.consultas add constraint consultas_estado_check check (estado in ('nueva', 'en_curso', 'resuelta'));
--   drop trigger organizaciones_sembrar_estados_consulta on public.organizaciones;
--   drop function private.sembrar_estados_consulta_organizacion();
--   drop function private.sembrar_estados_consulta(uuid);
--   y volver a aplicar actualizar_consulta (20270507450000) y proteger_estado_consulta_sistema (20270507000400);
--   las filas sembradas se pueden dejar (es_sistema) o borrar como postgres; después
--   alter table dominio.estados_consulta drop column clave;

-- 1. clave -------------------------------------------------------------------------------------------------------
alter table dominio.estados_consulta add column if not exists clave text;
update dominio.estados_consulta set clave = id::text where clave is null;
alter table dominio.estados_consulta alter column clave set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'estados_consulta_clave_formato' and conrelid = 'dominio.estados_consulta'::regclass
  ) then
    alter table dominio.estados_consulta
      add constraint estados_consulta_clave_formato check (clave ~ '^[A-Za-z0-9_-]{1,64}$');
  end if;
end $$;

create unique index if not exists estados_consulta_clave_uq on dominio.estados_consulta (organizacion_id, clave);

comment on column dominio.estados_consulta.clave is
  'Valor estable que guarda dominio.consultas.estado. Los de base: nueva, en_curso, resuelta; los demás, el id del estado. No cambia.';

-- La clave de un estado nuevo es su id (si no viene dada, solo la siembra de base la da).
create or replace function private.normalizar_estado_consulta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.clave is null then
    new.clave := new.id::text;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_estado_consulta() from public, anon, authenticated;

-- Guarda de estados de sistema: mismos casos que 20270507000400, con mensajes que valen para el flujo completo de la
-- consulta (no solo «Cerrar») y la clave inmutable para quien usa la app. Quien usa la app tampoco puede elegir la clave de un estado nuevo.
create or replace function private.proteger_estado_consulta_sistema()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.es_sistema and current_user in ('authenticated', 'anon') then
      raise exception 'Un estado de sistema solo se crea por migración' using errcode = '23514';
    end if;
    if new.clave is distinct from new.id::text and current_user in ('authenticated', 'anon') then
      raise exception 'La clave de un estado la asigna el sistema' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Única excepción: el borrado en cascada al eliminar la organización (cuando se dispara, ya no existe).
    if old.es_sistema and exists (select 1 from public.organizaciones o where o.id = old.organizacion_id) then
      raise exception 'El estado «%» es de sistema: lo necesita el flujo de las consultas y no se puede borrar', old.nombre
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.clave is distinct from old.clave and current_user in ('authenticated', 'anon') then
    raise exception 'La clave de un estado no se puede cambiar' using errcode = '23514';
  end if;
  if new.es_sistema is distinct from old.es_sistema and current_user in ('authenticated', 'anon') then
    raise exception 'No se puede cambiar si un estado es de sistema' using errcode = '23514';
  end if;
  if old.es_sistema then
    if not new.activo then
      raise exception 'El estado «%» es de sistema: lo necesita el flujo de las consultas y no se puede desactivar', old.nombre
        using errcode = '23514';
    end if;
    if new.nombre is distinct from old.nombre then
      raise exception 'El estado «%» es de sistema: lo necesita el flujo de las consultas y no se puede renombrar', old.nombre
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.proteger_estado_consulta_sistema() from public, anon, authenticated;

-- 2. siembra de los estados de base ---------------------------------------------------------------------------------
create or replace function private.sembrar_estados_consulta(p_organizacion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base record;
  v_id uuid;
begin
  for v_base in
    select * from (values ('nueva', 'Nueva', -3), ('en_curso', 'En curso', -2), ('resuelta', 'Resuelta', -1)) b (clave, nombre, orden)
  loop
    -- Ya sembrado.
    if exists (select 1 from dominio.estados_consulta e where e.organizacion_id = p_organizacion and e.clave = v_base.clave) then
      continue;
    end if;
    -- Un estado propio con ese nombre se adopta como el de base (se reactiva y se marca de sistema).
    select e.id into v_id from dominio.estados_consulta e
     where e.organizacion_id = p_organizacion and lower(btrim(e.nombre)) = lower(v_base.nombre);
    if v_id is not null then
      update dominio.estados_consulta set activo = true where id = v_id and not activo;
      -- La guarda de la clave y de `es_sistema` frena a quien usa la app, no a esta función (dueño de la tabla).
      update dominio.estados_consulta set clave = v_base.clave, es_sistema = true where id = v_id;
    else
      insert into dominio.estados_consulta (organizacion_id, nombre, orden, clave, es_sistema)
      values (p_organizacion, v_base.nombre, v_base.orden, v_base.clave, true);
    end if;
  end loop;
end;
$$;

revoke execute on function private.sembrar_estados_consulta(uuid) from public, anon, authenticated;

create or replace function private.sembrar_estados_consulta_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_estados_consulta(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_estados_consulta_organizacion() from public, anon, authenticated;

drop trigger if exists organizaciones_sembrar_estados_consulta on public.organizaciones;
create trigger organizaciones_sembrar_estados_consulta
  after insert on public.organizaciones
  for each row execute function private.sembrar_estados_consulta_organizacion();

select private.sembrar_estados_consulta(o.id) from public.organizaciones o;

-- 3. consultas.estado sin el check cerrado ---------------------------------------------------------------------------
alter table dominio.consultas drop constraint if exists consultas_estado_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'consultas_estado_formato' and conrelid = 'dominio.consultas'::regclass
  ) then
    alter table dominio.consultas
      add constraint consultas_estado_formato check (estado ~ '^[A-Za-z0-9_-]{1,64}$');
  end if;
end $$;

comment on column dominio.consultas.estado is
  'Clave de un estado de dominio.estados_consulta de la organización (nueva, en_curso y resuelta de base). Lo valida public.actualizar_consulta.';

-- 4. actualizar_consulta ----------------------------------------------------------------------------------------------
create or replace function public.actualizar_consulta(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
  p_nota_interna text,
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.consultas%rowtype;
  v_nota text := nullif(btrim(coalesce(p_nota_interna, '')), '');
  v_empresa text;
  v_responsable text;
  v_nuevo timestamptz;
  v_nombre_estado text;
  v_activo boolean;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  if p_estado is null or btrim(p_estado) = '' or length(p_estado) > 64 then
    raise exception 'Estado inválido' using errcode = '22023', detail = 'estado';
  end if;
  if length(coalesce(v_nota, '')) > 2000 then
    raise exception 'La nota interna es demasiado larga' using errcode = '22023', detail = 'nota_interna';
  end if;

  select * into v_c from dominio.consultas c
  where c.id = p_id and c.organizacion_id = v_org
  for update;

  -- Inexistente, de otra organización o de una empresa sin acceso: misma respuesta.
  if not found or not exists (
    select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id
  ) then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  -- El estado debe ser uno de la organización y estar activo; el que la consulta ya tiene se acepta aunque se haya
  -- desactivado después (no se la deja sin poder guardar la nota o el responsable).
  select e.nombre, e.activo into v_nombre_estado, v_activo
    from dominio.estados_consulta e
   where e.organizacion_id = v_org and e.clave = p_estado;
  if not found then
    raise exception 'El estado elegido no existe' using errcode = 'PT404', detail = 'estado';
  end if;
  if not v_activo and p_estado is distinct from v_c.estado then
    raise exception 'El estado elegido está desactivado' using errcode = 'PT412', detail = 'estado';
  end if;

  -- Solo se valida si el responsable cambia: quien ya estaba asignado puede haber perdido
  -- elegibilidad y aun así se puede editar estado o nota sin reasignar.
  if p_responsable_id is not null
     and p_responsable_id is distinct from v_c.responsable_id
     and not exists (
    select 1 from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id
  ) then
    raise exception 'El responsable no es válido para esta empresa' using errcode = '22023', detail = 'responsable_id';
  end if;

  -- Idempotente: sin cambios no hay conflicto posible ni escritura.
  if (v_c.estado, v_c.responsable_id, v_c.nota_interna)
     is not distinct from (p_estado, p_responsable_id, v_nota) then
    return v_c.updated_at;
  end if;

  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'La consulta fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.consultas
     set estado = p_estado, responsable_id = p_responsable_id, nota_interna = v_nota
   where id = p_id
  returning updated_at into v_nuevo;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;

  if v_c.estado is distinct from p_estado then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.estado_cambiado',
      format('Cambió el estado de una consulta de «%s» a «%s»', v_empresa, v_nombre_estado),
      v_c.empresa_id);
  end if;
  if v_c.responsable_id is distinct from p_responsable_id then
    select r.nombre into v_responsable
      from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id;
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.asignada',
      case when p_responsable_id is null
        then format('Quitó el responsable de una consulta de «%s»', v_empresa)
        else format('Asignó una consulta de «%s» a %s', v_empresa, v_responsable) end,
      v_c.empresa_id);
  end if;
  if v_c.nota_interna is distinct from v_nota then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.nota_actualizada',
      format('Actualizó la nota interna de una consulta de «%s»', v_empresa),
      v_c.empresa_id);
  end if;

  return v_nuevo;
end;
$$;

comment on function public.actualizar_consulta(uuid, text, uuid, text, timestamptz) is
  'MSF-186/MSF-595: cambia estado (la clave de un estado activo de la organización, o el que la consulta ya tiene), responsable y nota interna (sección consultas = edición). PT412 si el sello updated_at no coincide o, con detail estado, si el estado está desactivado; PT404 si el estado no existe; 42501 sin permiso o sin acceso; 22023 datos inválidos. Registra consulta.estado_cambiado / consulta.asignada / consulta.nota_actualizada solo si el valor cambió.';
