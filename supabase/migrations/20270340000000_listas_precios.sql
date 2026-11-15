-- F-PRE-14 (MSF-442, épica MSF-373, spec 20270327-100000-listas-de-precios-por-cliente, Fase 1): listas de precios.
-- Una lista es un porcentaje de ajuste sobre el precio central (decisión de Nicolás, 2026-11-15). Esta fase solo crea
-- las listas y su administración: NO toca `precio_para`, `precio_para_calculo` ni `precio_linea_venta`; ningún precio
-- ni lo que se cobra cambia (el motor llega en la Fase 3, detrás de la bandera `listas_precios`).
--
-- Esquemas (Principio VII, verificado objeto por objeto):
--   * `dominio.listas_precios`: regla comercial del negocio (política de precios), como `precios_empresa` y
--     `promociones_precio` → `dominio`.
--   * `public.listas_precios_resumen` (vista), `public.guardar_lista_precios`, `archivar_lista_precios`,
--     `restaurar_lista_precios`: superficie de lectura y ejecución sin datos propios → `public`.
--   * `private.cantidad_clientes_lista`: cálculo interno (sin `execute` para `anon`/`authenticated`).
--   * Fila `listas_precios` en `public.banderas_plataforma`: dato de plataforma (apagada por defecto).
--
-- Seguridad (RF-LP-1): RLS por organización y sección (`clientes` o `ventas` en lectura/edición); `authenticated` solo
-- lee; sin política `DELETE` ni escritura directa (solo las RPC `security definer`); `anon` sin privilegios. Solo el rol
-- Administrador escribe (`42501`); la organización y el actor salen de la sesión, nunca de un parámetro.
--
-- Bandera (D13): apagada, `guardar_lista_precios` responde `55000`; archivar y restaurar siguen permitidos.
-- Encender: update public.banderas_plataforma set activa = true where clave = 'listas_precios';
--
-- Migración aditiva e idempotente. Reversión (migración posterior; exportar antes los datos):
--   drop view public.listas_precios_resumen;
--   drop function public.restaurar_lista_precios(uuid, timestamptz);
--   drop function public.archivar_lista_precios(uuid, timestamptz);
--   drop function public.guardar_lista_precios(uuid, text, text, numeric, timestamptz);
--   drop function private.cantidad_clientes_lista(uuid);
--   drop trigger listas_precios_tocar on dominio.listas_precios;
--   drop function private.tocar_lista_precios();
--   drop table dominio.listas_precios;
--   delete from public.banderas_plataforma where clave = 'listas_precios';
--   delete from public.tipos_evento_actividad where tipo like 'lista_precios.%';

create table if not exists dominio.listas_precios (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Sin espacios sobrantes (lo normaliza la RPC); único por organización sin distinguir mayúsculas.
  nombre text not null,
  descripcion text,
  -- Porcentaje con signo sobre el precio central: negativo = descuento, positivo = recargo. numeric(5,2) = 2 decimales.
  ajuste_pct numeric(5, 2) not null,
  archivada_en timestamptz,
  creada_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listas_precios_nombre_ck check (nombre = btrim(nombre) and char_length(nombre) between 1 and 80),
  constraint listas_precios_descripcion_ck check (descripcion is null or char_length(descripcion) <= 300),
  constraint listas_precios_ajuste_ck check (ajuste_pct between -90.00 and 100.00),
  -- Destino de las FK compuestas que llevan la organización (clientes.lista_precio_id, Fase 2).
  constraint listas_precios_id_organizacion_uq unique (id, organizacion_id)
);

comment on table dominio.listas_precios is
  'F-PRE-14: lista de precios = porcentaje de ajuste (-90 a +100, 2 decimales) sobre el precio central; una por nombre y organización. Se archiva, no se borra (sin política DELETE). Se escribe solo por RPC. Spec 20270327-100000-listas-de-precios-por-cliente.';

create unique index if not exists listas_precios_nombre_uq
  on dominio.listas_precios (organizacion_id, lower(nombre));
create index if not exists listas_precios_organizacion_id_idx
  on dominio.listas_precios (organizacion_id);

-- updated_at avanza solo ante un cambio real (bloqueo optimista; repetir lo mismo es idempotente).
create or replace function private.tocar_lista_precios()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.nombre, new.descripcion, new.ajuste_pct, new.archivada_en)
     is not distinct from (old.nombre, old.descripcion, old.ajuste_pct, old.archivada_en) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_lista_precios() from public, anon, authenticated;

drop trigger if exists listas_precios_tocar on dominio.listas_precios;
create trigger listas_precios_tocar
  before update on dominio.listas_precios
  for each row execute function private.tocar_lista_precios();

alter table dominio.listas_precios enable row level security;

drop policy if exists listas_precios_select on dominio.listas_precios;
create policy listas_precios_select on dominio.listas_precios
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (
      (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
      or (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    )
  );

grant usage on schema dominio to authenticated;

-- Solo lectura para el rol de la API: se escribe por las RPC (security definer) que validan el rol.
revoke all on dominio.listas_precios from public, anon, authenticated;
grant select on dominio.listas_precios to authenticated;

-- Bandera de apagado (D13): apagada por defecto en cada entorno.
insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('listas_precios', false, 'Listas de precios por cliente: crear y editar listas, asignarlas a clientes y que el motor de precio las aplique.')
on conflict (clave) do nothing;

-- Eventos de Actividad (RF-PRE-14-4). Editar el porcentaje es sensible: exige valor anterior y nuevo.
insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('lista_precios.creada', false, 'Lista de precios creada'),
  ('lista_precios.editada', true, 'Lista de precios editada (porcentaje anterior y nuevo)'),
  ('lista_precios.archivada', false, 'Lista de precios archivada'),
  ('lista_precios.restaurada', false, 'Lista de precios restaurada')
on conflict (tipo) do nothing;

-- Clientes con esa lista (activos y archivados). En la Fase 1 todavía no existe `clientes.lista_precio_id`, así que
-- no hay ninguno; la migración de la Fase 2 la redefine con el conteo real. Sin acceso directo: la usa la RPC.
create or replace function private.cantidad_clientes_lista(p_lista uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select 0::bigint;
$$;

revoke execute on function private.cantidad_clientes_lista(uuid) from public, anon, authenticated;

-- Vista de lectura con la cantidad de clientes por lista. security_invoker: hereda la RLS de la tabla.
create or replace view public.listas_precios_resumen
with (security_invoker = true) as
select
  l.id,
  l.nombre,
  l.descripcion,
  l.ajuste_pct,
  l.archivada_en,
  l.updated_at,
  0::bigint as clientes_asignados
from dominio.listas_precios l;

comment on view public.listas_precios_resumen is
  'F-PRE-14: listas de precios con la cantidad de clientes asignados. security_invoker: la RLS de dominio.listas_precios decide quién lee.';

revoke all on public.listas_precios_resumen from public, anon, authenticated;
grant select on public.listas_precios_resumen to authenticated;

-- Texto del porcentaje con signo para la Actividad: «-20,00 %» / «+10,50 %».
create or replace function private.texto_ajuste_lista(p_ajuste numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_ajuste > 0 then '+' else '' end || replace(to_char(p_ajuste, 'FM990.00'), '.', ',') || ' %';
$$;

revoke execute on function private.texto_ajuste_lista(numeric) from public, anon, authenticated;

create or replace function public.guardar_lista_precios(
  p_id uuid,
  p_nombre text,
  p_descripcion text,
  p_ajuste_pct numeric,
  p_actualizado timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_descripcion text := nullif(btrim(coalesce(p_descripcion, '')), '');
  v_actual dominio.listas_precios;
  v_existente dominio.listas_precios;
  v_id uuid;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede crear o editar listas de precios' using errcode = '42501';
  end if;
  if not (select private.bandera_activa('listas_precios')) then
    raise exception 'Las listas de precios están desactivadas en este entorno' using errcode = '55000';
  end if;
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 80 then
    raise exception 'El nombre de la lista debe tener entre 1 y 80 caracteres' using errcode = '22023';
  end if;
  if v_descripcion is not null and char_length(v_descripcion) > 300 then
    raise exception 'La descripción no puede superar los 300 caracteres' using errcode = '22023';
  end if;
  if p_ajuste_pct is null or p_ajuste_pct < -90 or p_ajuste_pct > 100 then
    raise exception 'El ajuste debe estar entre -90 %% y +100 %%' using errcode = '23514';
  end if;
  if round(p_ajuste_pct, 2) <> p_ajuste_pct then
    raise exception 'El ajuste admite hasta 2 decimales' using errcode = '22003';
  end if;

  if p_id is null then
    select * into v_existente
      from dominio.listas_precios x
     where x.organizacion_id = v_organizacion and lower(x.nombre) = lower(v_nombre);
    if found then
      -- Idempotencia del alta: la misma lista (mismos datos) se devuelve tal cual.
      if v_existente.ajuste_pct = round(p_ajuste_pct, 2)
         and v_existente.descripcion is not distinct from v_descripcion
         and v_existente.archivada_en is null then
        return v_existente.id;
      end if;
      raise exception 'Ya existe una lista con ese nombre' using errcode = '23505';
    end if;

    insert into dominio.listas_precios (organizacion_id, nombre, descripcion, ajuste_pct, creada_por)
    values (v_organizacion, v_nombre, v_descripcion, round(p_ajuste_pct, 2), v_actor)
    returning id into v_id;

    perform private.insertar_cambio_actividad(
      v_organizacion, v_actor, 'lista_precios.creada',
      'Creó la lista de precios «' || v_nombre || '» (' || private.texto_ajuste_lista(round(p_ajuste_pct, 2)) || ')',
      null,
      jsonb_build_object('nombre', v_nombre, 'ajuste_pct', round(p_ajuste_pct, 2))
    );
    return v_id;
  end if;

  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'P0002';
  end if;

  -- Guardar lo que ya está guardado es idempotente.
  if (v_actual.nombre, v_actual.descripcion, v_actual.ajuste_pct)
     is not distinct from (v_nombre, v_descripcion, round(p_ajuste_pct, 2)) then
    return v_actual.id;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = '40001';
  end if;
  if exists (
    select 1 from dominio.listas_precios x
     where x.organizacion_id = v_organizacion and lower(x.nombre) = lower(v_nombre) and x.id <> v_actual.id
  ) then
    raise exception 'Ya existe una lista con ese nombre' using errcode = '23505';
  end if;

  update dominio.listas_precios
     set nombre = v_nombre, descripcion = v_descripcion, ajuste_pct = round(p_ajuste_pct, 2)
   where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.editada',
    'Editó la lista de precios «' || v_nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct)
      || ' → ' || private.texto_ajuste_lista(round(p_ajuste_pct, 2)) || ')',
    jsonb_build_object('nombre', v_actual.nombre, 'ajuste_pct', v_actual.ajuste_pct),
    jsonb_build_object('nombre', v_nombre, 'ajuste_pct', round(p_ajuste_pct, 2))
  );
  return v_actual.id;
end;
$$;

create or replace function public.archivar_lista_precios(p_id uuid, p_actualizado timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.listas_precios;
  v_clientes bigint;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede archivar listas de precios' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'P0002';
  end if;
  -- Archivar lo ya archivado no falla.
  if v_actual.archivada_en is not null then
    return;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = '40001';
  end if;
  v_clientes := (select private.cantidad_clientes_lista(v_actual.id));
  if v_clientes > 0 then
    raise exception 'No se puede archivar: % cliente(s) usan esta lista. Reasignalos o quitales la lista primero.', v_clientes
      using errcode = '23503', hint = 'clientes_asignados';
  end if;

  update dominio.listas_precios set archivada_en = now() where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.archivada',
    'Archivó la lista de precios «' || v_actual.nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct) || ')',
    jsonb_build_object('archivada', false), jsonb_build_object('archivada', true)
  );
end;
$$;

create or replace function public.restaurar_lista_precios(p_id uuid, p_actualizado timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actual dominio.listas_precios;
begin
  if v_organizacion is null or v_actor is null or not (select private.es_administrador_de(v_organizacion)) then
    raise exception 'Solo un administrador puede restaurar listas de precios' using errcode = '42501';
  end if;
  select * into v_actual
    from dominio.listas_precios x
   where x.id = p_id and x.organizacion_id = v_organizacion
     for update;
  if not found then
    raise exception 'La lista de precios no existe' using errcode = 'P0002';
  end if;
  if v_actual.archivada_en is null then
    return;
  end if;
  if v_actual.updated_at is distinct from p_actualizado then
    raise exception 'La lista fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.listas_precios set archivada_en = null where id = v_actual.id;

  perform private.insertar_cambio_actividad(
    v_organizacion, v_actor, 'lista_precios.restaurada',
    'Restauró la lista de precios «' || v_actual.nombre || '» (' || private.texto_ajuste_lista(v_actual.ajuste_pct) || ')',
    jsonb_build_object('archivada', true), jsonb_build_object('archivada', false)
  );
end;
$$;

revoke execute on function public.guardar_lista_precios(uuid, text, text, numeric, timestamptz) from public, anon;
revoke execute on function public.archivar_lista_precios(uuid, timestamptz) from public, anon;
revoke execute on function public.restaurar_lista_precios(uuid, timestamptz) from public, anon;
grant execute on function public.guardar_lista_precios(uuid, text, text, numeric, timestamptz) to authenticated;
grant execute on function public.archivar_lista_precios(uuid, timestamptz) to authenticated;
grant execute on function public.restaurar_lista_precios(uuid, timestamptz) to authenticated;

comment on function public.guardar_lista_precios(uuid, text, text, numeric, timestamptz) is
  'F-PRE-14: crea (p_id null) o edita una lista de precios. Solo Administrador; 55000 con la bandera listas_precios apagada; 40001 si cambió mientras editabas.';
