-- MSF-170 (revisión independiente, hallazgos 1 y 5): `exportar_actividad` cuenta y registra del lado servidor.
--
-- Antes (20270214300001, inmutable): la constancia `actividad.exportada` se escribía solo al entregar la última
-- página y `p_entregadas` / `p_exportacion` los mandaba el cliente; quien llamaba la RPC directo podía paginar y
-- parar antes sin constancia, o mandar `p_entregadas = 0` para saltear el tope de 50.000. Además la primera llamada
-- con un filtro que excedía el tope entregaba hasta 1000 filas sin constancia.
--
-- Ahora:
--   * `private.exportaciones_actividad` lleva `entregadas` y `cerrada` por id de corrida.
--   * La constancia se registra en la PRIMERA llamada de cada id (filtros + total, «Inició la exportación de N
--     registros…», con N = min(total, tope)). Cubre el abandono a mitad de camino y el filtro que excede el tope.
--   * El tope se aplica con el conteo del servidor. `p_entregadas` se IGNORA (se conserva en la firma por
--     compatibilidad). Un cliente que usa un id nuevo en cada página deja una constancia por página.
--   * El id se cierra al entregar la última fila o al llegar al tope; reutilizarlo lanza 22023 (también un
--     reintento de la última página: el comentario de 20270214300001 que decía lo contrario es inexacto).
--   * La respuesta suma `exportacion` (el id de la corrida).
--   * Purga (hallazgo 5): `private.depurar_registro_actividad` borra además las filas de
--     `exportaciones_actividad` con más de 30 días (decisión conservadora; un id viejo ya no sirve para nada).
--
-- Migración aditiva (misma firma que 20270214300001: `create or replace`).
-- REVERSIÓN (migración posterior): restaurar exportar_actividad de 20270214300001 y
-- private.depurar_registro_actividad de 20270207100002;
--   alter table private.exportaciones_actividad drop column cerrada, drop column entregadas;

alter table private.exportaciones_actividad
  add column if not exists entregadas integer not null default 0,
  add column if not exists cerrada boolean not null default false;

-- Las filas existentes ya estaban registradas (cerradas).
update private.exportaciones_actividad set cerrada = true;

create or replace function public.exportar_actividad(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_actor uuid default null,
  p_tipo text default null,
  p_texto text default null,
  p_corte timestamptz default null,
  p_cursor_creado_en timestamptz default null,
  p_cursor_id uuid default null,
  p_limite integer default 1000,
  p_entregadas integer default 0,
  p_exportacion uuid default null,
  p_con_total boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_tope constant integer := 50000;
  v_corte timestamptz;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_patron text;
  v_total integer;
  v_lim integer;
  v_filas jsonb;
  v_n integer;
  v_hay_mas boolean;
  v_ult_creado timestamptz;
  v_ult_id uuid;
  v_siguiente jsonb := null;
  v_filtros text[] := '{}';
  v_nombre text;
  v_nueva boolean := false;
  v_filas_nuevas integer;
  v_id uuid := coalesce(p_exportacion, gen_random_uuid());
  v_entregadas integer;
  v_cerrada boolean;
  v_acumuladas integer;
begin
  if v_org is null
     or (select auth.uid()) is null
     or coalesce((select private.nivel_seccion('actividad')), 'ninguno') <> 'edicion'
     or not coalesce((select private.puede_accion('actividad', 'exportar')), false) then
    raise exception 'Solo quien administra la actividad puede exportarla' using errcode = '42501';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000
     or (p_cursor_creado_en is null) <> (p_cursor_id is null) then
    raise exception 'Paginación inválida: el límite va de 1 a 1000 y el cursor lleva fecha e id' using errcode = '22023';
  end if;

  -- El conteo y el cierre viven en el servidor: `p_entregadas` se ignora (queda solo por compatibilidad de firma).
  -- La primera llamada de un id crea su fila (y con ella la constancia); un id ya cerrado se rechaza.
  insert into private.exportaciones_actividad (id, organizacion_id, usuario_id)
  values (v_id, v_org, (select auth.uid()))
  on conflict (organizacion_id, usuario_id, id) do nothing;
  get diagnostics v_filas_nuevas = row_count;
  v_nueva := v_filas_nuevas > 0;

  select x.entregadas, x.cerrada into v_entregadas, v_cerrada
    from private.exportaciones_actividad x
   where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.id = v_id
   for update;
  if v_cerrada then
    raise exception 'Esa exportación ya está registrada: iniciá una nueva' using errcode = '22023';
  end if;

  v_corte := coalesce(p_corte, now());
  v_lim := greatest(least(p_limite, v_tope - v_entregadas), 0);
  v_patron := case when v_texto is null then null else
    '%' || replace(replace(replace(translate(lower(left(v_texto, 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Total real del filtro: solo si se pide (primera llamada). Mismo filtro que `listar_actividad`.
  if p_con_total or v_nueva then
    select count(*)::integer into v_total
      from public.registro_actividad r
     where r.organizacion_id = v_org
       and r.creado_en <= v_corte
       and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_actor is null or r.actor_id = p_actor)
       and (p_tipo is null or r.tipo = p_tipo)
       and (v_patron is null or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like v_patron escape '\');
  end if;

  -- Página por cursor: v_lim + 1 filas para saber si hay más sin contar todo.
  with pagina as (
    select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre as empresa_nombre, r.actor_nombre, r.detalle
      from public.registro_actividad r
      left join dominio.empresas e on e.id = r.empresa_id
     where r.organizacion_id = v_org
       and r.creado_en <= v_corte
       and (p_cursor_id is null or (r.creado_en, r.id) < (p_cursor_creado_en, p_cursor_id))
       and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_actor is null or r.actor_id = p_actor)
       and (p_tipo is null or r.tipo = p_tipo)
       and (v_patron is null or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like v_patron escape '\')
     order by r.creado_en desc, r.id desc
     limit v_lim + 1
  ), numeradas as (
    select p.*, row_number() over (order by p.creado_en desc, p.id desc) as pos from pagina p
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'creado_en', n.creado_en,
               'tipo', n.tipo,
               'empresa_id', n.empresa_id,
               'empresa_nombre', n.empresa_nombre,
               'actor_nombre', n.actor_nombre,
               'detalle', n.detalle
             ) order by n.pos
           ) filter (where n.pos <= v_lim),
           '[]'::jsonb),
         (count(*) filter (where n.pos <= v_lim))::integer,
         coalesce(bool_or(n.pos > v_lim), false),
         (array_agg(n.creado_en order by n.pos desc) filter (where n.pos <= v_lim))[1],
         (array_agg(n.id order by n.pos desc) filter (where n.pos <= v_lim))[1]
    into v_filas, v_n, v_hay_mas, v_ult_creado, v_ult_id
    from numeradas n;

  if v_hay_mas and v_ult_id is not null then
    v_siguiente := jsonb_build_object('creado_en', v_ult_creado, 'id', v_ult_id);
  end if;

  v_acumuladas := v_entregadas + v_n;

  -- Se cierra el id al entregar la última fila o al llegar al tope: no se puede reutilizar.
  update private.exportaciones_actividad x
     set entregadas = v_acumuladas,
         cerrada = (not v_hay_mas or v_acumuladas >= v_tope)
   where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.id = v_id;

  if v_nueva then
    if p_desde is not null then v_filtros := v_filtros || ('desde el ' || to_char(p_desde, 'DD/MM/YYYY')); end if;
    if p_hasta is not null then v_filtros := v_filtros || ('hasta el ' || to_char(p_hasta, 'DD/MM/YYYY')); end if;
    if p_empresa is not null then
      select e.nombre into v_nombre from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
      v_filtros := v_filtros || ('tienda ' || coalesce(v_nombre, 'no disponible'));
    end if;
    if p_actor is not null then
      select r.actor_nombre into v_nombre
        from public.registro_actividad r
       where r.organizacion_id = v_org and r.actor_id = p_actor and r.actor_nombre is not null
       order by r.creado_en desc limit 1;
      v_filtros := v_filtros || ('usuario ' || coalesce(v_nombre, 'no disponible'));
    end if;
    if p_tipo is not null then v_filtros := v_filtros || ('tipo ' || left(p_tipo, 60)); end if;
    if v_texto is not null then v_filtros := v_filtros || ('texto «' || left(v_texto, 50) || '»'); end if;

    perform private.registrar_actividad(
      'actividad.exportada',
      left(
        format('Inició la exportación de %s %s de la actividad a CSV%s',
          least(v_total, v_tope),
          case when least(v_total, v_tope) = 1 then 'registro' else 'registros' end,
          case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end),
        480)
    );
  end if;

  return jsonb_build_object(
    'filas', v_filas,
    'total', v_total,
    'tope', v_tope,
    'recortado', case when p_con_total then v_total > v_tope else null end,
    'exportacion', v_id,
    'corte', v_corte,
    'hay_mas', v_hay_mas and v_acumuladas < v_tope,
    'siguiente', v_siguiente
  );
end;
$$;

comment on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) is
  'F-AUD-03: filas del historial de actividad para exportar a CSV, paginadas por cursor (creado_en, id) con corte estable y los mismos filtros que listar_actividad. Conteo, tope de 50.000 y cierre del id del lado servidor (p_entregadas se ignora). La constancia actividad.exportada se registra en la primera llamada de cada p_exportacion; un id cerrado se rechaza (22023). Exige nivel edición en Actividad y la acción exportar (42501).';

revoke execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) from public, anon;
grant execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) to authenticated;

-- Depuración: además de los eventos de 24 meses, purga las exportaciones de más de 30 días.
create or replace function private.depurar_registro_actividad(p_hasta timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corte timestamptz := least(p_hasta, pg_catalog.now()) - interval '24 months';
  v_total integer := 0;
  r record;
begin
  -- Solo el rol de Sistema (el de Kestra o un worker de la plataforma), igual que purgar_evidencias_ia.
  if not exists (
    select 1 from pg_catalog.pg_roles ro
    where ro.rolname in ('workers_orquestacion', 'kestra_orquestacion')
      and pg_catalog.pg_has_role(session_user, ro.oid, 'member')
  ) then
    raise exception 'Runtime no autorizado para depurar el registro de actividad' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('msf.depurando_actividad', 'on', true);

  begin
  for r in
    with borradas as (
      delete from public.registro_actividad a
      where a.creado_en < v_corte
      returning a.organizacion_id
    )
    select b.organizacion_id, count(*)::integer as cantidad
    from borradas b
    group by b.organizacion_id
  loop
    v_total := v_total + r.cantidad;
    perform private.insertar_actividad(
      r.organizacion_id,
      null,
      'sistema.depurada',
      format('Depuró %s %s con más de 24 meses', r.cantidad, case when r.cantidad = 1 then 'evento' else 'eventos' end)
    );
  end loop;
  exception when others then
    -- Que la marca no sobreviva a un error capturado por quien llama dentro de la misma transacción.
    perform pg_catalog.set_config('msf.depurando_actividad', 'off', true);
    raise;
  end;

  perform pg_catalog.set_config('msf.depurando_actividad', 'off', true);

  delete from private.exportaciones_actividad x where x.creado_en < least(p_hasta, pg_catalog.now()) - interval '30 days';

  return v_total;
end;
$$;

comment on function private.depurar_registro_actividad(timestamptz) is
  'F-AUD-02 (FR-008): borra los eventos con más de 24 meses respecto de p_hasta y deja un evento sistema.depurada por organización; purga además las exportaciones de actividad con más de 30 días. Solo workers_orquestacion / kestra_orquestacion; idempotente. Devuelve la cantidad de eventos borrada.';
