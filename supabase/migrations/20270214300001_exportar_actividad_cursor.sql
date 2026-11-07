-- MSF-278 (fix de la revisión retroactiva): `exportar_actividad` pagina por cursor y registra la constancia una vez.
--
-- Qué corrige respecto de 20270210110000 (inmutable):
--   1. Rendimiento: antes cada lote recalculaba TODO el filtro (`count(*) over ()` + `row_number()` sobre todas las
--      filas, hasta 50 veces por archivo). Ahora cada lote lee solo su página con un cursor (creado_en, id) y LIMIT
--      (usa los índices de registro_actividad), y el total se calcula solo cuando se pide (`p_con_total`, primera
--      llamada).
--   2. Constancia idempotente: `actividad.exportada` se registra una sola vez por exportación. El cliente genera un
--      id por corrida (`p_exportacion`); `private.exportaciones_actividad` lo guarda con clave primaria y un reintento
--      de la última página (mismo id) no vuelve a registrar. Sin id, la función genera uno propio.
--   3. Permiso a prueba de NULL: `nivel_seccion`/`puede_accion` se comparan con `coalesce`, de modo que un NULL nunca
--      deja pasar a alguien (un `or` con NULL no lanzaría 42501). El superadmin en modo soporte (organización activa)
--      resuelve 'edicion' y `true` por esas funciones; queda cubierto en el pgTAP.
--
-- Contrato nuevo (reemplaza al de 9 parámetros, que se elimina):
--   p_corte timestamptz        instante de corte (la primera respuesta lo devuelve; el cliente lo reenvía)
--   p_cursor_creado_en/_id     la fila `siguiente` de la respuesta anterior (null en la primera)
--   p_limite                   1..1000
--   p_entregadas               filas ya entregadas en la corrida (para aplicar el tope de 50.000 por archivo)
--   p_exportacion uuid         id de la corrida (idempotencia de la constancia)
--   p_con_total boolean        pide el total real del filtro (solo en la primera llamada)
-- Devuelve { filas, total (null si no se pidió), tope, recortado (null si no se pidió), corte, hay_mas, siguiente }.
--
-- Esquemas (Principio VII): una tabla nueva en `private` (sin acceso para los roles de la API; RLS activa y sin
-- políticas). Función `security definer` con `search_path = ''`.
--
-- REVERSIÓN (migración posterior):
--   drop function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean);
--   drop table private.exportaciones_actividad;

create table if not exists private.exportaciones_actividad (
  id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  usuario_id uuid,
  creado_en timestamptz not null default now()
);
comment on table private.exportaciones_actividad is
  'MSF-278: exportaciones de actividad ya registradas (una fila por id de corrida). Hace idempotente el evento actividad.exportada ante reintentos.';
alter table private.exportaciones_actividad enable row level security;
revoke all on private.exportaciones_actividad from public, anon, authenticated;

drop function if exists public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, integer, integer);

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
  v_exportables integer;
  v_filtros text[] := '{}';
  v_nombre text;
  v_nueva boolean := false;
  v_filas_nuevas integer;
begin
  if v_org is null
     or (select auth.uid()) is null
     or coalesce((select private.nivel_seccion('actividad')), 'ninguno') <> 'edicion'
     or not coalesce((select private.puede_accion('actividad', 'exportar')), false) then
    raise exception 'Solo quien administra la actividad puede exportarla' using errcode = '42501';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000
     or p_entregadas is null or p_entregadas < 0
     or (p_cursor_creado_en is null) <> (p_cursor_id is null) then
    raise exception 'Paginación inválida: el límite va de 1 a 1000, las entregadas no pueden ser negativas y el cursor lleva fecha e id' using errcode = '22023';
  end if;

  v_corte := coalesce(p_corte, now());
  v_lim := greatest(least(p_limite, v_tope - p_entregadas), 0);
  v_patron := case when v_texto is null then null else
    '%' || replace(replace(replace(translate(lower(left(v_texto, 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Total real del filtro: solo si se pide (primera llamada). Mismo filtro que `listar_actividad`.
  if p_con_total then
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

  v_exportables := p_entregadas + v_n;

  -- Última entrega del archivo (no hay más filas o se llegó al tope): constancia, una sola vez por exportación.
  if v_n > 0 and (not v_hay_mas or v_exportables >= v_tope) then
    insert into private.exportaciones_actividad (id, organizacion_id, usuario_id)
    values (coalesce(p_exportacion, gen_random_uuid()), v_org, (select auth.uid()))
    on conflict (id) do nothing;
    get diagnostics v_filas_nuevas = row_count;
    v_nueva := v_filas_nuevas > 0;
  end if;

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
        format('Exportó %s %s de la actividad a CSV%s',
          v_exportables,
          case when v_exportables = 1 then 'registro' else 'registros' end,
          case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end),
        480)
    );
  end if;

  return jsonb_build_object(
    'filas', v_filas,
    'total', v_total,
    'tope', v_tope,
    'recortado', case when p_con_total then v_total > v_tope else null end,
    'corte', v_corte,
    'hay_mas', v_hay_mas and v_exportables < v_tope,
    'siguiente', v_siguiente
  );
end;
$$;

comment on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) is
  'F-AUD-03: filas del historial de actividad para exportar a CSV, paginadas por cursor (creado_en, id) con corte estable y los mismos filtros que listar_actividad. El total real solo se calcula con p_con_total. Tope 50.000 filas por archivo. Exige nivel edición en Actividad y la acción exportar (42501). Registra actividad.exportada una sola vez por p_exportacion, al entregar la última fila.';

revoke execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) from public, anon;
grant execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, timestamptz, uuid, integer, integer, uuid, boolean) to authenticated;
