-- F-AUD-03 (MSF-278, épica MSF-170, spec 20261102-100000-auditoria-avanzada-y-soporte): exportar la actividad a
-- CSV. FR-010, FR-011, SC-004, SC-005.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla. `public.exportar_actividad` es una
-- función de SOLO LECTURA en `public` sobre `public.registro_actividad` y `dominio.empresas`; lo único que escribe
-- es UNA fila de actividad (`actividad.exportada`) por `private.registrar_actividad`. El tipo se da de alta, sin
-- ser sensible, en `public.tipos_evento_actividad`.
--
-- Filtros: los mismos que `public.listar_actividad` (período, tienda, usuario, tipo y texto), con la misma zona
-- horaria (America/Argentina/Buenos_Aires) y el mismo orden, así que `total` coincide con el «N» del listado (SC-004).
--
-- Permiso: se exige el nivel «edición» en Actividad Y la acción `exportar` (RF-AUD-03-2 y CA-AUD-03-2 de la
-- historia: solo el Administrador; el Operador de solo lectura no exporta aunque la matriz le dé `exportar`).
-- `42501` en cualquier otro caso. `anon` y `public` no ejecutan.
--
-- Por qué `security definer` (el spec decía `security invoker`): la historia exige registrar `actividad.exportada`
-- y `authenticated` no puede insertar en `registro_actividad`. La función NO delega en RLS: acota TODA lectura a la
-- organización de la sesión (`private.organizacion_id()`) y chequea el permiso de forma explícita.
--
-- Páginas estables: el historial sigue creciendo mientras se exporta y eso correría las páginas (filas repetidas
-- o salteadas). La primera llamada fija un instante de corte (`corte`) que el cliente reenvía en las siguientes
-- (`p_corte`): solo se lee lo anterior o igual al corte. Tope: 50.000 filas por archivo; `total` es el real, así
-- que si lo supera el cliente avisa que se recortó y pide acotar el filtro (CA-AUD-03-3).
--
-- El evento `actividad.exportada` se registra UNA vez, en la llamada que entrega la última fila del archivo, con los
-- filtros usados (sin ids ni UUID: nombres legibles).
--
-- Migración aditiva. REVERSIÓN (migración posterior):
--   drop function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, integer, integer);
--   delete from public.tipos_evento_actividad where tipo = 'actividad.exportada';

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('actividad.exportada', false, 'Exportación del historial de actividad a CSV')
on conflict (tipo) do nothing;

create or replace function public.exportar_actividad(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_actor uuid default null,
  p_tipo text default null,
  p_texto text default null,
  p_corte timestamptz default null,
  p_desplazamiento integer default 0,
  p_limite integer default 1000
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
  v_filas jsonb;
  v_entregadas integer;
  v_exportables integer;
  v_filtros text[] := '{}';
  v_nombre text;
begin
  if v_org is null
     or (select auth.uid()) is null
     or (select private.nivel_seccion('actividad')) <> 'edicion'
     or not (select private.puede_accion('actividad', 'exportar')) then
    raise exception 'Solo quien administra la actividad puede exportarla' using errcode = '42501';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000
     or p_desplazamiento is null or p_desplazamiento < 0 then
    raise exception 'Paginación inválida: el límite va de 1 a 1000 y el desplazamiento no puede ser negativo' using errcode = '22023';
  end if;

  v_corte := coalesce(p_corte, now());
  -- Mismo patrón de búsqueda que `listar_actividad`: sin tildes, sin distinguir mayúsculas y con `% _ \` escapados.
  v_patron := case when v_texto is null then null else
    '%' || replace(replace(replace(translate(lower(left(v_texto, 100)), 'áéíóúü', 'aeiouu'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  with filtradas as (
    select r.id, r.creado_en, r.tipo, r.empresa_id, e.nombre as empresa_nombre, r.actor_nombre, r.detalle
      from public.registro_actividad r
      left join dominio.empresas e on e.id = r.empresa_id
     where r.organizacion_id = v_org
       and r.creado_en <= v_corte
       and (p_desde is null or r.creado_en >= (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_hasta is null or r.creado_en < ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
       and (p_empresa is null or r.empresa_id = p_empresa)
       and (p_actor is null or r.actor_id = p_actor)
       and (p_tipo is null or r.tipo = p_tipo)
       and (v_patron is null or translate(lower(r.detalle), 'áéíóúü', 'aeiouu') like v_patron escape '\')
  ), numeradas as (
    select f.*,
           count(*) over () as total,
           row_number() over (order by f.creado_en desc, f.id desc) as pos
      from filtradas f
  )
  select coalesce(max(n.total), 0)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'creado_en', n.creado_en,
               'tipo', n.tipo,
               'empresa_id', n.empresa_id,
               'empresa_nombre', n.empresa_nombre,
               'actor_nombre', n.actor_nombre,
               'detalle', n.detalle
             ) order by n.pos
           ) filter (where n.pos > p_desplazamiento and n.pos <= least(p_desplazamiento + p_limite, v_tope)),
           '[]'::jsonb),
         (count(*) filter (where n.pos > p_desplazamiento and n.pos <= least(p_desplazamiento + p_limite, v_tope)))::integer
    into v_total, v_filas, v_entregadas
    from numeradas n;

  v_exportables := least(v_total, v_tope);

  -- Última entrega del archivo: se deja constancia de la exportación, con los filtros en palabras.
  if v_entregadas > 0 and p_desplazamiento + v_entregadas >= v_exportables then
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
    'recortado', v_total > v_tope,
    'corte', v_corte
  );
end;
$$;

comment on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, integer, integer) is
  'F-AUD-03: filas del historial de actividad para exportar a CSV, con los mismos filtros que listar_actividad, en lotes (p_desplazamiento/p_limite ≤ 1000) y con instante de corte estable. Tope 50.000 filas; total es el real. Exige nivel edición en Actividad y la acción exportar (42501). Registra actividad.exportada al entregar la última fila.';

revoke execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, integer, integer) from public, anon;
grant execute on function public.exportar_actividad(date, date, uuid, uuid, text, text, timestamptz, integer, integer) to authenticated;
