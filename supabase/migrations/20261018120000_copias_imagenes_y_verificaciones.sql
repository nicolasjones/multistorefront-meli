-- Copias de imágenes y verificación de restauración (épica MSF-457, F-OPS-01).
-- Spec: specs/20261018-120000-operacion-copias-y-documentacion.
--
-- Esquema (Constitución, Principio VII): las dos tablas son de plataforma
-- (backups, transversal) → `public`. Ninguna va en `dominio`. `respaldos`
-- (spec 011) no se altera. Migración aditiva.
--
-- Reversión (orden inverso; nada se destruye en el mismo PR que lo crea):
--   drop function public.finalizar_verificacion_error(bigint, text);
--   drop function public.finalizar_verificacion_completado(bigint, integer, text);
--   drop function public.iniciar_verificacion_restauracion();
--   drop function public.finalizar_respaldo_imagenes_error(bigint, text);
--   drop function public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text);
--   drop function public.iniciar_respaldo_imagenes(text);
--   drop table public.verificaciones_restauracion;
--   drop table public.respaldos_imagenes;

-- ============================================================================
-- Tablas
-- ============================================================================

create table public.respaldos_imagenes (
  id bigint generated always as identity primary key,
  origen text not null check (origen in ('programado', 'manual')),
  estado text not null default 'en_progreso' check (estado in ('en_progreso', 'completado', 'error')),
  iniciado_en timestamptz not null default clock_timestamp(),
  finalizado_en timestamptz,
  cantidad_objetos bigint check (cantidad_objetos >= 0),
  tamano_bytes bigint check (tamano_bytes >= 0),
  ubicacion text,
  motivo_error text,
  constraint respaldos_imagenes_estado_consistente check (
    (estado = 'en_progreso' and finalizado_en is null
      and cantidad_objetos is null and tamano_bytes is null
      and ubicacion is null and motivo_error is null)
    or (estado = 'completado' and finalizado_en is not null
      and cantidad_objetos is not null and tamano_bytes is not null
      and ubicacion is not null and motivo_error is null)
    or (estado = 'error' and finalizado_en is not null and motivo_error is not null)
  )
);

comment on table public.respaldos_imagenes is
  'Historial de copias de los objetos de Storage (épica MSF-457, F-OPS-01). Escrita únicamente por Kestra (rol kestra_backups) vía las funciones *_respaldo_imagenes_*; nunca por un authenticated. Solo el superadmin la lee.';

create unique index respaldos_imagenes_un_solo_en_progreso
  on public.respaldos_imagenes (estado)
  where estado = 'en_progreso';

create table public.verificaciones_restauracion (
  id bigint generated always as identity primary key,
  respaldo_id bigint not null references public.respaldos (id),
  estado text not null default 'en_progreso' check (estado in ('en_progreso', 'completado', 'error')),
  iniciado_en timestamptz not null default clock_timestamp(),
  finalizado_en timestamptz,
  duracion_segundos integer check (duracion_segundos >= 0),
  detalle text,
  motivo_error text,
  constraint verificaciones_restauracion_estado_consistente check (
    (estado = 'en_progreso' and finalizado_en is null
      and duracion_segundos is null and motivo_error is null)
    or (estado = 'completado' and finalizado_en is not null
      and duracion_segundos is not null and motivo_error is null)
    or (estado = 'error' and finalizado_en is not null and motivo_error is not null)
  )
);

comment on table public.verificaciones_restauracion is
  'Resultado de restaurar la última copia de la base en un Postgres efímero y aislado (épica MSF-457, F-OPS-01). Escrita únicamente por Kestra (rol kestra_backups); solo el superadmin la lee.';

create index verificaciones_restauracion_respaldo_idx
  on public.verificaciones_restauracion (respaldo_id);

create unique index verificaciones_restauracion_una_en_progreso
  on public.verificaciones_restauracion (estado)
  where estado = 'en_progreso';

-- ============================================================================
-- Funciones: copia de imágenes (public, security definer, search_path = '')
-- ============================================================================

create or replace function public.iniciar_respaldo_imagenes(p_origen text)
returns public.respaldos_imagenes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_respaldo public.respaldos_imagenes;
begin
  if p_origen not in ('programado', 'manual') then
    raise exception 'Origen de respaldo inválido: %', p_origen using errcode = '22023';
  end if;

  -- Auto-sana una fila colgada por una caída real del proceso (mismo
  -- criterio que public.iniciar_respaldo, spec 011).
  update public.respaldos_imagenes
    set estado = 'error',
        finalizado_en = clock_timestamp(),
        motivo_error = 'Copia de imágenes interrumpida: quedó en progreso más de 3 horas sin resolverse (probable caída del proceso que la ejecutaba).'
    where estado = 'en_progreso'
      and iniciado_en < clock_timestamp() - interval '3 hours';

  begin
    insert into public.respaldos_imagenes (origen, estado, iniciado_en)
    values (p_origen, 'en_progreso', clock_timestamp())
    returning * into v_respaldo;
  exception
    when unique_violation then
      raise exception 'Ya hay una copia de imágenes en progreso' using errcode = '55006';
  end;

  return v_respaldo;
end;
$$;

comment on function public.iniciar_respaldo_imagenes(text) is
  'Primer paso del flow respaldo-imagenes. Si ya hay una copia en progreso (no vencida) corta con errcode 55006 y el flow termina sin copiar nada.';

revoke execute on function public.iniciar_respaldo_imagenes(text) from public, authenticated, anon;
grant execute on function public.iniciar_respaldo_imagenes(text) to kestra_backups;

create or replace function public.finalizar_respaldo_imagenes_completado(
  p_id bigint,
  p_cantidad_objetos bigint,
  p_tamano_bytes bigint,
  p_ubicacion text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos_imagenes
  set estado = 'completado',
      finalizado_en = clock_timestamp(),
      cantidad_objetos = p_cantidad_objetos,
      tamano_bytes = p_tamano_bytes,
      ubicacion = p_ubicacion
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text) is
  'No-op si la fila no está en_progreso (no pisa un estado ya resuelto).';

revoke execute on function public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_imagenes_completado(bigint, bigint, bigint, text) to kestra_backups;

create or replace function public.finalizar_respaldo_imagenes_error(p_id bigint, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.respaldos_imagenes
  set estado = 'error',
      finalizado_en = clock_timestamp(),
      motivo_error = coalesce(nullif(btrim(p_motivo), ''), 'Error sin detalle')
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_respaldo_imagenes_error(bigint, text) is
  'Llamada desde el bloque errors: del flow: cualquier falla deja la fila en error, nunca en en_progreso.';

revoke execute on function public.finalizar_respaldo_imagenes_error(bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_respaldo_imagenes_error(bigint, text) to kestra_backups;

-- ============================================================================
-- Funciones: verificación de restauración
-- ============================================================================

-- Elige la última copia de base completada y abre la verificación. Devuelve
-- lo que el flow necesita para traer el archivo (id, respaldo e ubicación).
create or replace function public.iniciar_verificacion_restauracion()
returns table (id bigint, respaldo_id bigint, ubicacion text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_respaldo public.respaldos;
  v_id bigint;
begin
  update public.verificaciones_restauracion v
    set estado = 'error',
        finalizado_en = clock_timestamp(),
        motivo_error = 'Verificación interrumpida: quedó en progreso más de 3 horas sin resolverse (probable caída del proceso que la ejecutaba).'
    where v.estado = 'en_progreso'
      and v.iniciado_en < clock_timestamp() - interval '3 hours';

  select * into v_respaldo
  from public.respaldos r
  where r.estado = 'completado'
  order by r.finalizado_en desc, r.id desc
  limit 1;

  if not found then
    raise exception 'No hay ninguna copia de la base completada para verificar' using errcode = 'P0002';
  end if;

  begin
    insert into public.verificaciones_restauracion (respaldo_id, estado, iniciado_en)
    values (v_respaldo.id, 'en_progreso', clock_timestamp())
    returning verificaciones_restauracion.id into v_id;
  exception
    when unique_violation then
      raise exception 'Ya hay una verificación de restauración en progreso' using errcode = '55006';
  end;

  return query select v_id, v_respaldo.id, v_respaldo.ubicacion;
end;
$$;

comment on function public.iniciar_verificacion_restauracion() is
  'Primer paso del flow verificar-restauracion. Sin copia completada corta con P0002; con otra verificación en curso, con 55006.';

revoke execute on function public.iniciar_verificacion_restauracion() from public, authenticated, anon;
grant execute on function public.iniciar_verificacion_restauracion() to kestra_backups;

create or replace function public.finalizar_verificacion_completado(
  p_id bigint,
  p_duracion_segundos integer,
  p_detalle text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.verificaciones_restauracion
  set estado = 'completado',
      finalizado_en = clock_timestamp(),
      duracion_segundos = p_duracion_segundos,
      detalle = p_detalle
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_verificacion_completado(bigint, integer, text) is
  'No-op si la fila no está en_progreso.';

revoke execute on function public.finalizar_verificacion_completado(bigint, integer, text) from public, authenticated, anon;
grant execute on function public.finalizar_verificacion_completado(bigint, integer, text) to kestra_backups;

create or replace function public.finalizar_verificacion_error(p_id bigint, p_motivo text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.verificaciones_restauracion
  set estado = 'error',
      finalizado_en = clock_timestamp(),
      motivo_error = coalesce(nullif(btrim(p_motivo), ''), 'Error sin detalle')
  where id = p_id and estado = 'en_progreso';
$$;

comment on function public.finalizar_verificacion_error(bigint, text) is
  'Llamada desde el bloque errors: del flow verificar-restauracion.';

revoke execute on function public.finalizar_verificacion_error(bigint, text) from public, authenticated, anon;
grant execute on function public.finalizar_verificacion_error(bigint, text) to kestra_backups;

-- ============================================================================
-- RLS: solo el superadmin lee; sin policies de escritura
-- ============================================================================

alter table public.respaldos_imagenes enable row level security;
alter table public.verificaciones_restauracion enable row level security;

create policy respaldos_imagenes_select on public.respaldos_imagenes
  for select to authenticated
  using ((select private.is_superadmin()));

create policy verificaciones_restauracion_select on public.verificaciones_restauracion
  for select to authenticated
  using ((select private.is_superadmin()));

-- ============================================================================
-- Grants (sin privilegios para anon)
-- ============================================================================

revoke all on table public.respaldos_imagenes from anon, authenticated;
revoke all on table public.verificaciones_restauracion from anon, authenticated;
grant select on table public.respaldos_imagenes to authenticated;
grant select on table public.verificaciones_restauracion to authenticated;
