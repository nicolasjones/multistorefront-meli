-- MSF-841 (tramo A, punto 2): color «Barra superior y pie» (`color_barra`) de la tienda.
--
-- El prototipo (MJC_*, SJ_*) pinta la barra superior y el pie con un color propio, distinto del primario.
-- Se agrega a la identidad visual: columna con default '#222222' y el mismo check de formato `#RRGGBB`.
--
-- Qué cambia:
--   * dominio.tienda_identidad.color_barra (columna + check).
--   * private.validar_tienda_identidad: valida/normaliza `color_barra`; si el borrador no trae la clave
--     (borradores guardados antes de esta migración) vale '#222222'.
--   * private.identidad_vivo (estado vivo = instantánea de versiones y vista previa) incluye `color_barra`.
--   * private.detalle_cambios_tienda: el cambio de la barra cuenta como «colores» (el rótulo del resumen
--     «N cambios sin publicar: colores, tipografías, …» no cambia de forma); un borrador sin la clave se
--     compara como '#222222' para no inventar un cambio.
--   * public.guardar_tienda_identidad: CAMBIO DE FIRMA. Se agrega `p_color_barra text default null` AL FINAL
--     (null = '#222222') y se elimina la firma vieja de 10 argumentos. Mantiene el permiso de F-TDA-06
--     (FR-052): NO es ejecutable por authenticated ni anon; solo la llama public.publicar_tienda
--     (SECURITY DEFINER), que se recrea acá con la firma nueva. Ningún otro código llama a la firma vieja.
--   * publico.identidad_por_dominio: devuelve además `color_barra` (lista blanca). Cambia la tabla de
--     salida, por eso se elimina y se recrea con los mismos grants (anon y authenticated).
--
-- Esquemas (Principio VII): tabla en `dominio`, lectura pública en `publico`, auxiliares en `private`.
-- Migración aditiva en datos; las filas existentes toman el default.
-- Reversión: recrear las funciones de 20261023100100 / 20270205110100 sin `color_barra` y, recién
-- entonces, `alter table dominio.tienda_identidad drop column color_barra`.

alter table dominio.tienda_identidad add column if not exists color_barra text not null default '#222222';
alter table dominio.tienda_identidad drop constraint if exists tienda_identidad_color_barra_formato;
alter table dominio.tienda_identidad add constraint tienda_identidad_color_barra_formato check (color_barra ~ '^#[0-9A-F]{6}$');

comment on column dominio.tienda_identidad.color_barra is
  'MSF-841: color de la barra superior y el pie de la tienda (#RRGGBB, mayúsculas). Por defecto #222222.';

create or replace function private.identidad_vivo(p_empresa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'color_primario', coalesce(i.color_primario, '#222222'),
    'color_primario_oscuro', coalesce(i.color_primario_oscuro, '#000000'),
    'color_acento', coalesce(i.color_acento, '#222222'),
    'color_fondo', coalesce(i.color_fondo, '#FFFFFF'),
    'color_barra', coalesce(i.color_barra, '#222222'),
    'tipografia_titulos', coalesce(i.tipografia_titulos, 'system-ui'),
    'tipografia_texto', coalesce(i.tipografia_texto, 'system-ui'),
    'logo_ruta', i.logo_ruta,
    'banner_ruta', i.banner_ruta,
    'banner_movil_ruta', i.banner_movil_ruta
  )
  from (select 1) base
  left join dominio.tienda_identidad i on i.empresa_id = p_empresa;
$$;

create or replace function private.validar_tienda_identidad(p_org uuid, p_empresa uuid, p_datos jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_primario text := upper(btrim(coalesce(p_datos->>'color_primario', '')));
  v_oscuro text := upper(btrim(coalesce(p_datos->>'color_primario_oscuro', '')));
  v_acento text := upper(btrim(coalesce(p_datos->>'color_acento', '')));
  v_fondo text := upper(btrim(coalesce(p_datos->>'color_fondo', '')));
  -- Un borrador guardado antes de MSF-841 no trae la clave: vale el color por defecto de la barra.
  v_barra text := upper(btrim(coalesce(p_datos->>'color_barra', '#222222')));
  v_titulos text := p_datos->>'tipografia_titulos';
  v_texto text := p_datos->>'tipografia_texto';
  v_logo text := p_datos->>'logo_ruta';
  v_banner text := p_datos->>'banner_ruta';
  v_banner_movil text := p_datos->>'banner_movil_ruta';
  v_prefijo text;
  v_ruta text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos de la identidad tienen un formato inválido' using errcode = '22023';
  end if;
  if v_primario !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_oscuro !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color primario oscuro debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_acento !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de acento debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_fondo !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de fondo debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_barra !~ '^#[0-9A-F]{6}$' then
    raise exception 'El color de la barra superior y pie debe tener el formato #RRGGBB' using errcode = '22023';
  end if;
  if v_titulos is null or v_titulos not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
       'Bricolage Grotesque', 'DM Sans') then
    raise exception 'La tipografía de los títulos no está en la lista' using errcode = '22023';
  end if;
  if v_texto is null or v_texto not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans',
       'Bricolage Grotesque', 'DM Sans') then
    raise exception 'La tipografía del texto no está en la lista' using errcode = '22023';
  end if;

  v_prefijo := p_org::text || '/' || p_empresa::text || '/';
  foreach v_ruta in array array[v_logo, v_banner, v_banner_movil] loop
    if v_ruta is not null and (left(v_ruta, length(v_prefijo)) <> v_prefijo or substr(v_ruta, length(v_prefijo) + 1) !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*$' or length(v_ruta) > 200) then
      raise exception 'La imagen debe estar en la carpeta de la empresa' using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'color_primario', v_primario,
    'color_primario_oscuro', v_oscuro,
    'color_acento', v_acento,
    'color_fondo', v_fondo,
    'color_barra', v_barra,
    'tipografia_titulos', v_titulos,
    'tipografia_texto', v_texto,
    'logo_ruta', v_logo,
    'banner_ruta', v_banner,
    'banner_movil_ruta', v_banner_movil
  );
end;
$$;

-- [{area, campos: [texto…]}] solo con las áreas del borrador que difieren de lo publicado. Nombres de
-- campos, nunca valores (D4).
create or replace function private.detalle_cambios_tienda(p_empresa uuid, p_identidad jsonb, p_contenido jsonb, p_catalogo jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vivo jsonb;
  v_campos text[];
  v_detalle jsonb := '[]'::jsonb;
  v_cats integer;
  v_prods integer;
  v_dest integer;
begin
  if p_identidad is not null then
    v_vivo := private.identidad_vivo(p_empresa);
    v_campos := array_remove(array[
      case when (p_identidad->>'color_primario', p_identidad->>'color_primario_oscuro', p_identidad->>'color_acento', p_identidad->>'color_fondo',
                 coalesce(p_identidad->>'color_barra', '#222222'))
             is distinct from (v_vivo->>'color_primario', v_vivo->>'color_primario_oscuro', v_vivo->>'color_acento', v_vivo->>'color_fondo',
                               v_vivo->>'color_barra')
           then 'colores' end,
      case when (p_identidad->>'tipografia_titulos', p_identidad->>'tipografia_texto')
             is distinct from (v_vivo->>'tipografia_titulos', v_vivo->>'tipografia_texto')
           then 'tipografías' end,
      case when p_identidad->>'logo_ruta' is distinct from v_vivo->>'logo_ruta' then 'logo' end,
      case when p_identidad->>'banner_ruta' is distinct from v_vivo->>'banner_ruta' then 'banner' end,
      case when p_identidad->>'banner_movil_ruta' is distinct from v_vivo->>'banner_movil_ruta' then 'banner móvil' end
    ], null);
    if cardinality(v_campos) > 0 then
      v_detalle := v_detalle || jsonb_build_array(jsonb_build_object('area', 'identidad', 'campos', to_jsonb(v_campos)));
    end if;
  end if;

  if p_contenido is not null then
    v_vivo := private.contenido_vivo(p_empresa);
    v_campos := array_remove(array[
      case when (p_contenido->>'titulo', p_contenido->>'subtitulo') is distinct from (v_vivo->>'titulo', v_vivo->>'subtitulo')
           then 'texto del banner' end,
      case when (p_contenido->>'texto_boton', p_contenido->>'boton_destino') is distinct from (v_vivo->>'texto_boton', v_vivo->>'boton_destino')
           then 'botón del banner' end,
      case when p_contenido->>'bienvenida' is distinct from v_vivo->>'bienvenida' then 'mensaje de bienvenida' end,
      case when p_contenido->>'pie' is distinct from v_vivo->>'pie' then 'pie de página' end,
      case when p_contenido->>'aviso_ficha' is distinct from v_vivo->>'aviso_ficha' then 'aviso de la ficha' end,
      case when p_contenido->>'texto_boton_contacto' is distinct from v_vivo->>'texto_boton_contacto' then 'botón de contacto' end
    ], null);
    if cardinality(v_campos) > 0 then
      v_detalle := v_detalle || jsonb_build_array(jsonb_build_object('area', 'contenido', 'campos', to_jsonb(v_campos)));
    end if;
  end if;

  if p_catalogo is not null then
    select count(*) into v_cats
      from jsonb_to_recordset(coalesce(p_catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
      left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = x.id
     where x.visible is distinct from coalesce(ct.visible, true);
    select count(*) filter (where x.visible is distinct from coalesce(pt.visible, true)),
           count(*) filter (where x.destacado is distinct from coalesce(pt.destacado, false))
      into v_prods, v_dest
      from jsonb_to_recordset(coalesce(p_catalogo->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
      left join dominio.productos_tienda pt on pt.empresa_id = p_empresa and pt.producto_id = x.id;
    v_campos := array_remove(array[
      case when v_cats > 0 then case when v_cats = 1 then '1 categoría' else v_cats || ' categorías' end end,
      case when v_prods > 0 then case when v_prods = 1 then '1 producto visible' else v_prods || ' productos visibles' end end,
      case when v_dest > 0 then case when v_dest = 1 then '1 destacado' else v_dest || ' destacados' end end
    ], null);
    if cardinality(v_campos) > 0 then
      v_detalle := v_detalle || jsonb_build_array(jsonb_build_object('area', 'catalogo', 'campos', to_jsonb(v_campos)));
    end if;
  end if;

  return v_detalle;
end;
$$;

-- Cambio de firma: la versión de 10 argumentos desaparece.
drop function if exists public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text);

create or replace function public.guardar_tienda_identidad(
  p_empresa_id uuid,
  p_color_primario text,
  p_color_primario_oscuro text,
  p_color_acento text,
  p_color_fondo text,
  p_tipografia_titulos text,
  p_tipografia_texto text,
  p_logo_ruta text default null,
  p_banner_ruta text default null,
  p_banner_movil_ruta text default null,
  p_color_barra text default null
)
returns dominio.tienda_identidad
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_d jsonb;
  v_actual dominio.tienda_identidad;
  v_fila dominio.tienda_identidad;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la identidad de la tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
  from dominio.empresas e
  where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  v_d := private.validar_tienda_identidad(v_org, p_empresa_id, jsonb_build_object(
    'color_primario', p_color_primario,
    'color_primario_oscuro', p_color_primario_oscuro,
    'color_acento', p_color_acento,
    'color_fondo', p_color_fondo,
    'color_barra', p_color_barra,
    'tipografia_titulos', p_tipografia_titulos,
    'tipografia_texto', p_tipografia_texto,
    'logo_ruta', p_logo_ruta,
    'banner_ruta', p_banner_ruta,
    'banner_movil_ruta', p_banner_movil_ruta
  ));

  -- Serializa guardados concurrentes de la misma empresa.
  perform 1 from dominio.empresas where id = p_empresa_id for update;
  select * into v_actual from dominio.tienda_identidad where empresa_id = p_empresa_id;

  if found
     and v_actual.color_primario = v_d->>'color_primario'
     and v_actual.color_primario_oscuro = v_d->>'color_primario_oscuro'
     and v_actual.color_acento = v_d->>'color_acento'
     and v_actual.color_fondo = v_d->>'color_fondo'
     and v_actual.color_barra = v_d->>'color_barra'
     and v_actual.tipografia_titulos = v_d->>'tipografia_titulos'
     and v_actual.tipografia_texto = v_d->>'tipografia_texto'
     and v_actual.logo_ruta is not distinct from v_d->>'logo_ruta'
     and v_actual.banner_ruta is not distinct from v_d->>'banner_ruta'
     and v_actual.banner_movil_ruta is not distinct from v_d->>'banner_movil_ruta' then
    return v_actual;
  end if;

  insert into dominio.tienda_identidad as ti (
    empresa_id, organizacion_id, color_primario, color_primario_oscuro, color_acento, color_fondo, color_barra,
    tipografia_titulos, tipografia_texto, logo_ruta, banner_ruta, banner_movil_ruta
  ) values (
    p_empresa_id, v_org, v_d->>'color_primario', v_d->>'color_primario_oscuro', v_d->>'color_acento', v_d->>'color_fondo', v_d->>'color_barra',
    v_d->>'tipografia_titulos', v_d->>'tipografia_texto', v_d->>'logo_ruta', v_d->>'banner_ruta', v_d->>'banner_movil_ruta'
  )
  on conflict (empresa_id) do update set
    color_primario = excluded.color_primario,
    color_primario_oscuro = excluded.color_primario_oscuro,
    color_acento = excluded.color_acento,
    color_fondo = excluded.color_fondo,
    color_barra = excluded.color_barra,
    tipografia_titulos = excluded.tipografia_titulos,
    tipografia_texto = excluded.tipografia_texto,
    logo_ruta = excluded.logo_ruta,
    banner_ruta = excluded.banner_ruta,
    banner_movil_ruta = excluded.banner_movil_ruta,
    updated_at = now()
  returning ti.* into v_fila;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.identidad_actualizada',
    format('Actualizó la identidad visual de la tienda de «%s»', v_empresa),
    p_empresa_id
  );
  return v_fila;
end;
$$;

create or replace function public.publicar_tienda(p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_b dominio.tienda_borrador;
  v_cambios jsonb;
  v_cats jsonb;
  v_prods jsonb;
  v_numero integer;
  v_areas text[];
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede publicar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;
  if not found then
    return jsonb_build_object('version', null);
  end if;

  v_cambios := private.resumen_cambios_tienda(private.detalle_cambios_tienda(p_empresa, v_b.identidad, v_b.contenido, v_b.catalogo));
  if (v_cambios->>'total')::integer = 0 then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
    return jsonb_build_object('version', null);
  end if;

  -- Una tienda creada después de la migración no tiene versión 1: se guarda el estado de antes de publicar para
  -- poder volver a él (FR-058).
  if not exists (select 1 from dominio.tienda_versiones v where v.empresa_id = p_empresa) then
    insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, publicada_at, publicada_por, resumen, cambios, instantanea)
    values (p_empresa, v_org, 1, now(), null, 'Configuración inicial', '[]'::jsonb, private.instantanea_tienda(p_empresa));
  end if;

  if v_b.identidad is not null then
    perform public.guardar_tienda_identidad(
      p_empresa,
      v_b.identidad->>'color_primario', v_b.identidad->>'color_primario_oscuro', v_b.identidad->>'color_acento',
      v_b.identidad->>'color_fondo', v_b.identidad->>'tipografia_titulos', v_b.identidad->>'tipografia_texto',
      v_b.identidad->>'logo_ruta', v_b.identidad->>'banner_ruta', v_b.identidad->>'banner_movil_ruta',
      coalesce(v_b.identidad->>'color_barra', '#222222')
    );
  end if;
  if v_b.contenido is not null then
    perform public.guardar_tienda_contenido(
      p_empresa,
      v_b.contenido->>'titulo', v_b.contenido->>'subtitulo', v_b.contenido->>'texto_boton', v_b.contenido->>'boton_destino',
      v_b.contenido->>'bienvenida', v_b.contenido->>'pie', v_b.contenido->>'aviso_ficha', v_b.contenido->>'texto_boton_contacto'
    );
  end if;
  if v_b.catalogo is not null then
    -- Un producto o categoría que desapareció desde que se guardó el borrador se omite (no traba la publicación).
    v_cats := coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible))
        from jsonb_to_recordset(coalesce(v_b.catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
       where exists (select 1 from dominio.categorias k where k.id = x.id and k.organizacion_id = v_org)
    ), '[]'::jsonb);
    v_prods := coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible, 'destacado', x.destacado))
        from jsonb_to_recordset(coalesce(v_b.catalogo->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
       where exists (
         select 1 from dominio.producto_empresa pe
          where pe.producto_id = x.id and pe.empresa_id = p_empresa and pe.organizacion_id = v_org
       )
    ), '[]'::jsonb);
    perform public.guardar_catalogo_tienda(p_empresa, v_cats, v_prods);
  end if;

  select coalesce(max(v.numero), 0) + 1 into v_numero from dominio.tienda_versiones v where v.empresa_id = p_empresa;
  insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, publicada_at, publicada_por, resumen, cambios, instantanea)
  values (p_empresa, v_org, v_numero, now(), (select auth.uid()), v_cambios->>'resumen', v_cambios->'detalle', private.instantanea_tienda(p_empresa));

  delete from dominio.tienda_borrador where empresa_id = p_empresa;

  v_areas := array(select e->>'area' from jsonb_array_elements(v_cambios->'detalle') e);
  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.publicada',
    format('Publicó la versión %s de la tienda de «%s» (%s)', v_numero, v_empresa, private.unir_lista_es(v_areas)),
    p_empresa
  );

  return jsonb_build_object('version', v_numero);
end;
$$;

revoke execute on function private.identidad_vivo(uuid) from public, anon, authenticated;
revoke execute on function private.validar_tienda_identidad(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.detalle_cambios_tienda(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- FR-052: la RPC viva solo la ejecuta public.publicar_tienda.
revoke execute on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.publicar_tienda(uuid) from public, anon;
grant execute on function public.publicar_tienda(uuid) to authenticated;

comment on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text, text) is
  'F-TDA-02 + MSF-841: guarda la identidad visual de la tienda de una empresa (estado completo, con color de barra). Solo la ejecuta publicar_tienda. 42501 sin permiso, P0002 empresa inexistente, 22023 datos inválidos.';

-- ============================================================================
-- publico.identidad_por_dominio con `color_barra` (lista blanca de columnas)
-- ============================================================================

drop function if exists publico.identidad_por_dominio(text);

create function publico.identidad_por_dominio(host text)
returns table (
  color_primario text,
  color_primario_oscuro text,
  color_acento text,
  color_fondo text,
  color_barra text,
  tipografia_titulos text,
  tipografia_texto text,
  logo_ruta text,
  banner_ruta text,
  banner_movil_ruta text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(i.color_primario, '#222222'),
    coalesce(i.color_primario_oscuro, '#000000'),
    coalesce(i.color_acento, '#222222'),
    coalesce(i.color_fondo, '#FFFFFF'),
    coalesce(i.color_barra, '#222222'),
    coalesce(i.tipografia_titulos, 'system-ui'),
    coalesce(i.tipografia_texto, 'system-ui'),
    i.logo_ruta,
    i.banner_ruta,
    i.banner_movil_ruta
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_identidad i on i.empresa_id = t.empresa_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.identidad_por_dominio(text) from public;
grant execute on function publico.identidad_por_dominio(text) to anon, authenticated;

comment on function publico.identidad_por_dominio(text) is
  'F-TDA-02 + MSF-841: identidad pública de la tienda por host (lista blanca de columnas, con color de barra; rutas del bucket público). Vacío si el dominio no existe o la empresa está desactivada.';
