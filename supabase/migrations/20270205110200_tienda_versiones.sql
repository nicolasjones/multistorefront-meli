-- MSF-235 · F-TDA-07 (épica MSF-133, spec 20270125-100000-tienda-dominio-y-publicacion,
-- FR-071, FR-073…FR-075): versiones de la tienda y restauración como borrador.
--
-- Esquemas (Principio VII, re-verificado): SIN tablas nuevas ni alteradas. Lee `dominio.tienda_versiones` y
-- `dominio.tienda_borrador` (creadas por F-TDA-06, esquema `dominio`: entidades de negocio de la tienda) y escribe
-- solo en el borrador. RPC de la app en `public`.
--
-- Restaurar NO publica (FR-073): reemplaza el borrador entero con la instantánea de la versión elegida. Lo que la
-- instantánea no menciona del catálogo (solo guarda lo distinto del predeterminado) vuelve al predeterminado
-- (visible y no destacado) en el borrador, para que publicar deje la tienda tal como estaba en esa versión.
-- Productos y categorías que ya no existen se omiten (FR-074). El historial no se reescribe (FR-075): publicar
-- después crea una versión nueva con el número siguiente.
--
-- Migración aditiva (solo funciones). Reversión:
--   drop function public.restaurar_version_tienda(uuid, integer);
--   drop function public.listar_versiones_tienda(uuid);

-- ============================================================================
-- public.listar_versiones_tienda (FR-071)
-- ============================================================================

-- Últimas 100 versiones, la más nueva primero, con el nombre de quien publicó y la marca de vigente.
create or replace function public.listar_versiones_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver las versiones de esta tienda' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'numero', v.numero,
             'publicada_at', v.publicada_at,
             'publicada_por', private.nombre_usuario(v.publicada_por),
             'resumen', v.resumen,
             'vigente', v.numero = (select max(m.numero) from dominio.tienda_versiones m where m.empresa_id = p_empresa)
           ) order by v.numero desc)
      from (
        select t.* from dominio.tienda_versiones t
         where t.empresa_id = p_empresa and t.organizacion_id = v_org
         order by t.numero desc
         limit 100
      ) v
  ), '[]'::jsonb);
end;
$$;

-- ============================================================================
-- public.restaurar_version_tienda (FR-073, FR-074, FR-075)
-- ============================================================================

create or replace function public.restaurar_version_tienda(p_empresa uuid, p_numero integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_vigente integer;
  v_version dominio.tienda_versiones;
  v_identidad jsonb;
  v_contenido jsonb;
  v_catalogo jsonb;
  v_cats jsonb;
  v_prods jsonb;
  v_detalle jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_version from dominio.tienda_versiones v
   where v.empresa_id = p_empresa and v.organizacion_id = v_org and v.numero = p_numero;
  if not found then
    raise exception 'La versión no existe' using errcode = 'P0002';
  end if;
  select max(v.numero) into v_vigente from dominio.tienda_versiones v where v.empresa_id = p_empresa;
  if v_version.numero = v_vigente then
    raise exception 'La versión vigente ya es la que está publicada' using errcode = '22023';
  end if;

  v_identidad := case when jsonb_typeof(v_version.instantanea->'identidad') = 'object' then v_version.instantanea->'identidad' end;
  v_contenido := case when jsonb_typeof(v_version.instantanea->'contenido') = 'object' then v_version.instantanea->'contenido' end;

  -- Categorías: lo de la versión (si todavía existe) + lo vivo que la versión no menciona, vuelto al predeterminado.
  v_cats := coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible))
      from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
     where exists (select 1 from dominio.categorias k where k.id = x.id and k.organizacion_id = v_org)
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('id', ct.categoria_id, 'visible', true))
      from dominio.categorias_tienda ct
     where ct.empresa_id = p_empresa
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'categorias', '[]'::jsonb)) as x(id uuid)
          where x.id = ct.categoria_id)
  ), '[]'::jsonb);

  v_prods := coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible, 'destacado', x.destacado))
      from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
     where exists (
       select 1 from dominio.producto_empresa pe
        where pe.producto_id = x.id and pe.empresa_id = p_empresa and pe.organizacion_id = v_org
     )
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('id', pt.producto_id, 'visible', true, 'destacado', false))
      from dominio.productos_tienda pt
     where pt.empresa_id = p_empresa
       and not exists (
         select 1 from jsonb_to_recordset(coalesce(v_version.instantanea->'catalogo'->'productos', '[]'::jsonb)) as x(id uuid)
          where x.id = pt.producto_id)
  ), '[]'::jsonb);

  v_catalogo := jsonb_build_object('categorias', v_cats, 'productos', v_prods);

  -- Las áreas que no difieren de lo publicado se descartan; sin áreas, el borrador queda vacío (se reemplaza).
  v_detalle := private.detalle_cambios_tienda(p_empresa, v_identidad, v_contenido, v_catalogo);
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'identidad') then v_identidad := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'contenido') then v_contenido := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'catalogo') then v_catalogo := null; end if;

  if v_identidad is null and v_contenido is null and v_catalogo is null then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
  else
    insert into dominio.tienda_borrador as b (empresa_id, organizacion_id, identidad, contenido, catalogo, updated_by, updated_at)
    values (p_empresa, v_org, v_identidad, v_contenido, v_catalogo, (select auth.uid()), now())
    on conflict (empresa_id) do update set
      identidad = excluded.identidad,
      contenido = excluded.contenido,
      catalogo = excluded.catalogo,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.version_restaurada',
    format('Restauró la versión %s de la tienda de «%s» como borrador', p_numero, v_empresa),
    p_empresa
  );

  return jsonb_build_object('numero', p_numero, 'hay_borrador', jsonb_array_length(v_detalle) > 0);
end;
$$;

-- ============================================================================
-- Permisos y comentarios
-- ============================================================================

revoke execute on function public.listar_versiones_tienda(uuid) from public, anon;
revoke execute on function public.restaurar_version_tienda(uuid, integer) from public, anon;
grant execute on function public.listar_versiones_tienda(uuid) to authenticated;
grant execute on function public.restaurar_version_tienda(uuid, integer) to authenticated;

comment on function public.listar_versiones_tienda(uuid) is
  'MSF-235 (F-TDA-07, FR-071): últimas 100 versiones de la tienda de la empresa, más nueva primero, con autor y marca de vigente.';
comment on function public.restaurar_version_tienda(uuid, integer) is
  'MSF-235 (F-TDA-07, FR-073…FR-075): carga la versión elegida como borrador (reemplaza el actual), omitiendo productos y categorías eliminados. No publica ni reescribe el historial.';
