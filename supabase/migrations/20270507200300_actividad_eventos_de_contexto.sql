-- MSF-985 (seguimiento de MSF-618, épica MSF-585): las filas «Cambio de empresa activa»
-- no ocupan la lista de Actividad.
--
-- Qué se decide: el evento `usuario.empresa_activa_cambiada` SE SIGUE REGISTRANDO —lo escriben
-- `public.cambiar_empresa_activa` y `public.usar_todas_las_empresas` en la misma transacción del
-- cambio— pero NO aparece en el listado ni en el CSV, salvo que se pida ese tipo explícitamente
-- (filtro «Tipo» de la pantalla). Razón: la empresa activa decide el rol con el que la persona
-- opera en las secciones por empresa, así que el cambio es trazabilidad de contexto y el
-- registro tiene que quedar; pero con varias personas alternando entre tiendas las filas llenaban
-- el historial de cambios que no son de negocio (MSF-618, devolución del Revisor del PR #638).
--
-- Esquemas (Principio VII): no crea ni altera tablas. Redefine dos funciones de lectura con la
-- MISMA firma (`public.listar_actividad` y `public.exportar_actividad`) y agrega un helper en
-- `private`. `public.registro_actividad` no se toca: los eventos de contexto siguen guardados.
--
-- Migración aditiva. Camino de reversión (en una migración posterior, no en este PR):
--   drop function private.tipos_de_contexto_actividad();
--   -- y recrear public.listar_actividad con la definición de 20261016120000 y
--   -- public.exportar_actividad con la de 20270421000200 (sin la línea de contexto).
-- Con eso las filas vuelven a la lista como antes.

-- ============================================================================
-- tipos_de_contexto_actividad: los tipos de evento que no son un cambio de negocio.
-- Es la única fuente de verdad: el listado y el CSV se guían por esta lista.
-- ============================================================================

create or replace function private.tipos_de_contexto_actividad()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['usuario.empresa_activa_cambiada'];
$$;

comment on function private.tipos_de_contexto_actividad() is
  'MSF-985: tipos de evento que son cambio de contexto y no cambio de negocio. Se siguen registrando y se pueden pedir por tipo, pero no ocupan la lista de Actividad ni el CSV.';

revoke all on function private.tipos_de_contexto_actividad() from public, anon;
grant execute on function private.tipos_de_contexto_actividad() to authenticated;

-- ============================================================================
-- listar_actividad: los eventos de contexto salen solo si se piden por tipo.
-- ============================================================================

create or replace function public.listar_actividad(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_actor uuid default null,
  p_tipo text default null,
  p_texto text default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  creado_en timestamptz,
  tipo text,
  empresa_id uuid,
  empresa_nombre text,
  actor_id uuid,
  actor_nombre text,
  detalle text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre, r.actor_id, r.actor_nombre, r.detalle,
    count(*) over ()
  from public.registro_actividad r
  left join dominio.empresas e on e.id = r.empresa_id
  where r.organizacion_id = (select private.organizacion_id())
    and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
    and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
    and (p_empresa is null or r.empresa_id = p_empresa)
    and (p_actor is null or r.actor_id = p_actor)
    and (p_tipo is null or r.tipo = p_tipo)
    and (r.tipo <> all (private.tipos_de_contexto_actividad()) or p_tipo = r.tipo)
    and (
      p_texto is null or btrim(p_texto) = ''
      or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like
        '%' || replace(replace(replace(translate(lower(left(btrim(p_texto), 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        escape '\'
    )
  order by r.creado_en desc, r.id desc
  limit least(greatest(coalesce(p_tamano, 10), 1), 100)
  offset (greatest(coalesce(p_pagina, 1), 1) - 1) * least(greatest(coalesce(p_tamano, 10), 1), 100);
$$;

comment on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) is
  'Historial de actividad paginado en servidor (F-AUD-01, FR-003; MSF-985: los eventos de contexto no ocupan la lista salvo que se pidan por tipo). Security invoker: la RLS de registro_actividad decide quién ve qué. Fechas en America/Argentina/Buenos_Aires.';

revoke execute on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.listar_actividad(date, date, uuid, uuid, text, text, integer, integer) to authenticated;

-- ============================================================================
-- exportar_actividad: el CSV sale con las mismas filas que la pantalla (FR-013),
-- así que tampoco incluye los eventos de contexto salvo que se pidan por tipo.
-- ============================================================================

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
  v_recientes integer;
  v_repetida integer;
  v_hash text;
  v_hash_guardado text;
  v_corte_guardado timestamptz;
  v_limite_hora constant integer := 60;
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

  -- Serializa las exportaciones de la misma persona: el conteo del límite por hora corre en READ COMMITTED y no ve
  -- filas sin commit de otras transacciones; sin este candado N sesiones en paralelo con ids nuevos pasarían todas.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || (select auth.uid())::text, 0));

  -- El conteo y el cierre viven en el servidor: `p_entregadas` se ignora (queda solo por compatibilidad de firma).
  -- La primera llamada de un id crea su fila (y con ella la constancia); un id ya cerrado se rechaza.
  insert into private.exportaciones_actividad (id, organizacion_id, usuario_id)
  values (v_id, v_org, (select auth.uid()))
  on conflict (organizacion_id, usuario_id, id) do nothing;
  get diagnostics v_filas_nuevas = row_count;
  v_nueva := v_filas_nuevas > 0;

  -- Límite de constancias por persona y hora: el tope de 50.000 es de UX; el control real es el rastro, y esto evita
  -- bajar todo el historial en tandas con un id nuevo por llamada.
  if v_nueva then
    select count(*)::integer into v_recientes
      from private.exportaciones_actividad x
     where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.creado_en > now() - interval '1 hour';
    if v_recientes > v_limite_hora then
      raise exception 'Superaste el límite de % exportaciones por hora: esperá un rato e intentá de nuevo', v_limite_hora using errcode = '22023';
    end if;
  end if;

  -- Es un reintento de la misma página solo si el cursor es el mismo y el límite no baja: así el crédito de la última
  -- entrega no se puede reciclar (repetir con un límite menor restaba mucho y sumaba poco).
  select x.entregadas, x.cerrada,
         case when not v_nueva and x.cursor_id is not distinct from p_cursor_id and p_limite >= x.ultima_entrega
              then x.ultima_entrega else 0 end,
         x.filtros_hash, x.corte
    into v_entregadas, v_cerrada, v_repetida, v_hash_guardado, v_corte_guardado
    from private.exportaciones_actividad x
   where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.id = v_id
   for update;
  if v_cerrada then
    raise exception 'Esa exportación ya está registrada: iniciá una nueva' using errcode = '22023';
  end if;
  -- Repetir la misma página (mismo id y mismo cursor) no suma otra vez lo entregado.
  v_entregadas := v_entregadas - v_repetida;

  -- Los filtros quedan fijados en la primera llamada del id (la constancia los describe): cambiarlos a mitad de camino
  -- se rechaza. El corte también queda fijado: las llamadas siguientes usan el guardado y ignoran p_corte.
  v_hash := md5(jsonb_build_array(p_desde, p_hasta, p_empresa, p_actor, p_tipo, v_texto)::text);
  if v_nueva or v_hash_guardado is null then
    v_corte := coalesce(p_corte, now());
    update private.exportaciones_actividad x
       set filtros_hash = v_hash, corte = v_corte
     where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.id = v_id;
  elsif v_hash_guardado <> v_hash then
    raise exception 'Los filtros no coinciden con los de la exportación iniciada: iniciá una nueva' using errcode = '22023';
  else
    v_corte := v_corte_guardado;
  end if;
  v_lim := greatest(least(p_limite, v_tope - v_entregadas), 0);
  v_patron := case when v_texto is null then null else
    '%' || replace(replace(replace(translate(lower(left(v_texto, 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Total real del filtro: solo si se pide (primera llamada). Mismo filtro que `listar_actividad`.
  if p_con_total or v_nueva then
    select count(*)::integer into v_total
      from public.registro_actividad r
     where r.organizacion_id = v_org
       and (r.empresa_id is null or r.empresa_id in (select private.empresas_de_actividad()))
       and r.creado_en <= v_corte
       and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_actor is null or r.actor_id = p_actor)
       and (p_tipo is null or r.tipo = p_tipo)
       and (r.tipo <> all (private.tipos_de_contexto_actividad()) or p_tipo = r.tipo)
       and (v_patron is null or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like v_patron escape '\');
  end if;

  -- Página por cursor: v_lim + 1 filas para saber si hay más sin contar todo.
  with pagina as (
    select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre as empresa_nombre, r.actor_nombre, r.detalle
      from public.registro_actividad r
      left join dominio.empresas e on e.id = r.empresa_id
     where r.organizacion_id = v_org
       and (r.empresa_id is null or r.empresa_id in (select private.empresas_de_actividad()))
       and r.creado_en <= v_corte
       and (p_cursor_id is null or (r.creado_en, r.id) < (p_cursor_creado_en, p_cursor_id))
       and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_actor is null or r.actor_id = p_actor)
       and (p_tipo is null or r.tipo = p_tipo)
       and (r.tipo <> all (private.tipos_de_contexto_actividad()) or p_tipo = r.tipo)
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
         cursor_creado_en = p_cursor_creado_en,
         cursor_id = p_cursor_id,
         ultima_entrega = v_n,
         cerrada = (not v_hay_mas or v_acumuladas >= v_tope)
   where x.organizacion_id = v_org and x.usuario_id = (select auth.uid()) and x.id = v_id;

  if v_nueva then
    if p_desde is not null then v_filtros := v_filtros || ('desde el ' || to_char(p_desde, 'DD/MM/YYYY')); end if;
    if p_hasta is not null then v_filtros := v_filtros || ('hasta el ' || to_char(p_hasta, 'DD/MM/YYYY')); end if;
    if p_empresa is not null then
      select e.nombre into v_nombre from dominio.empresas e
       where e.id = p_empresa and e.organizacion_id = v_org
         and e.id in (select private.empresas_de_actividad());
      v_filtros := v_filtros || ('tienda ' || coalesce(v_nombre, 'no disponible'));
    end if;
    if p_actor is not null then
      select r.actor_nombre into v_nombre
        from public.registro_actividad r
       where r.organizacion_id = v_org
         and (r.empresa_id is null or r.empresa_id in (select private.empresas_de_actividad()))
         and r.actor_id = p_actor and r.actor_nombre is not null
       order by r.creado_en desc limit 1;
      v_filtros := v_filtros || ('usuario ' || coalesce(v_nombre, 'no disponible'));
    end if;
    if p_tipo is not null then v_filtros := v_filtros || ('tipo ' || left(p_tipo, 60)); end if;
    if v_texto is not null then v_filtros := v_filtros || ('texto «' || left(v_texto, 50) || '»'); end if;

    perform private.registrar_actividad(
      'actividad.exportada',
      left(
        format('Inició la exportación de %s %s de la actividad a CSV%s%s',
          v_total,
          case when v_total = 1 then 'registro' else 'registros' end,
          case when v_total > v_tope then format(' (supera el tope de %s)', v_tope) else '' end,
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
  'F-AUD-03 + MSF-968 + MSF-985: filas del historial de actividad para exportar a CSV, paginadas por cursor (creado_en, id). Conteo, tope de 50.000, límite de 60 exportaciones nuevas por persona y hora (con candado asesor) y cierre del id del lado servidor (p_entregadas se ignora). La constancia actividad.exportada se registra en la primera llamada de cada p_exportacion, que fija filtros y corte; filtros distintos o un id cerrado se rechazan (22023). Exige nivel edición en Actividad y la acción exportar (42501). Solo incluye eventos de empresas accesibles de quien exporta y los de toda la organización (sin empresa). Los eventos de contexto no entran salvo que se pidan por tipo (MSF-985), igual que en la pantalla.';
