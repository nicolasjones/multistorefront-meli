-- MSF-841 (tramo A, punto 3): campo «Eslogan» (`eslogan`, hasta 80 caracteres) en el contenido de la tienda.
--
-- El prototipo (MJC_*, SJ_*) muestra una frase corta bajo el nombre de la tienda. Es un texto comercial
-- más de `dominio.tienda_contenido`: texto plano, recortado, vacío por defecto (vacío = no se muestra).
--
-- Qué cambia:
--   * dominio.tienda_contenido.eslogan (columna con default '' + check de recorte y de 80 caracteres) y el
--     trigger de normalización, que lo recorta como a los demás textos.
--   * private.validar_tienda_contenido: valida el tope (22023, hint = 'eslogan'); un borrador guardado antes
--     de esta migración no trae la clave y vale ''.
--   * private.contenido_vivo (estado vivo = instantánea de versiones y vista previa) incluye `eslogan`.
--   * private.detalle_cambios_tienda: nuevo rótulo «eslogan» en el resumen de cambios sin publicar.
--   * public.guardar_tienda_contenido: CAMBIO DE FIRMA. Se agrega `p_eslogan text default null` AL FINAL
--     (null = '') y se elimina la firma vieja de 9 argumentos. Mantiene el permiso de F-TDA-06 (FR-052): NO es
--     ejecutable por authenticated ni anon; solo la llama public.publicar_tienda, que se recrea acá.
--   * publico.contenido_por_dominio: devuelve además `eslogan`. Cambia la tabla de salida: se elimina y se
--     recrea con los mismos grants (anon y authenticated).
--
-- Esquemas (Principio VII): tabla en `dominio`, lectura pública en `publico`, auxiliares en `private`.
-- Migración aditiva en datos; las filas existentes toman ''.
-- Reversión: recrear las funciones de 20261023100200 / 20270205110100 / 20270303200000 sin `eslogan` y,
-- recién entonces, `alter table dominio.tienda_contenido drop column eslogan`.

alter table dominio.tienda_contenido add column if not exists eslogan text not null default '';
alter table dominio.tienda_contenido drop constraint if exists tienda_contenido_eslogan_limite;
alter table dominio.tienda_contenido add constraint tienda_contenido_eslogan_limite check (
  eslogan = btrim(eslogan) and char_length(eslogan) <= 80
);

comment on column dominio.tienda_contenido.eslogan is
  'MSF-841: frase corta de la tienda (texto plano, recortado, hasta 80 caracteres). Vacío = no se muestra.';

create or replace function private.normalizar_tienda_contenido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.titulo := btrim(coalesce(new.titulo, ''));
  new.subtitulo := btrim(coalesce(new.subtitulo, ''));
  new.texto_boton := btrim(coalesce(new.texto_boton, ''));
  new.bienvenida := btrim(coalesce(new.bienvenida, ''));
  new.pie := btrim(coalesce(new.pie, ''));
  new.aviso_ficha := btrim(coalesce(new.aviso_ficha, ''));
  new.texto_boton_contacto := btrim(coalesce(new.texto_boton_contacto, ''));
  new.eslogan := btrim(coalesce(new.eslogan, ''));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_tienda_contenido() from public, anon, authenticated;

create or replace function private.contenido_vivo(p_empresa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'titulo', coalesce(c.titulo, ''),
    'subtitulo', coalesce(c.subtitulo, ''),
    'texto_boton', coalesce(c.texto_boton, ''),
    'boton_destino', coalesce(c.boton_destino, 'catalogo'),
    'bienvenida', coalesce(c.bienvenida, ''),
    'pie', coalesce(c.pie, ''),
    'aviso_ficha', coalesce(c.aviso_ficha, ''),
    'texto_boton_contacto', coalesce(c.texto_boton_contacto, ''),
    'eslogan', coalesce(c.eslogan, '')
  )
  from (select 1) base
  left join dominio.tienda_contenido c on c.empresa_id = p_empresa;
$$;

create or replace function private.validar_tienda_contenido(p_datos jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_titulo text := btrim(coalesce(p_datos->>'titulo', ''));
  v_subtitulo text := btrim(coalesce(p_datos->>'subtitulo', ''));
  v_texto_boton text := btrim(coalesce(p_datos->>'texto_boton', ''));
  v_destino text := coalesce(nullif(btrim(coalesce(p_datos->>'boton_destino', '')), ''), 'catalogo');
  v_bienvenida text := btrim(coalesce(p_datos->>'bienvenida', ''));
  v_pie text := btrim(coalesce(p_datos->>'pie', ''));
  v_aviso text := btrim(coalesce(p_datos->>'aviso_ficha', ''));
  v_contacto text := btrim(coalesce(p_datos->>'texto_boton_contacto', ''));
  -- Un borrador guardado antes de MSF-841 no trae la clave: vale vacío.
  v_eslogan text := btrim(coalesce(p_datos->>'eslogan', ''));
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos del contenido tienen un formato inválido' using errcode = '22023';
  end if;
  if char_length(v_titulo) > 120 then
    raise exception 'El título no puede superar los 120 caracteres' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_subtitulo) > 300 then
    raise exception 'El subtítulo no puede superar los 300 caracteres' using errcode = '22023', hint = 'subtitulo';
  end if;
  if char_length(v_texto_boton) > 120 then
    raise exception 'El texto del botón no puede superar los 120 caracteres' using errcode = '22023', hint = 'texto_boton';
  end if;
  if v_destino not in ('catalogo') then
    raise exception 'El destino del botón no es válido' using errcode = '22023', hint = 'boton_destino';
  end if;
  if char_length(v_bienvenida) > 300 then
    raise exception 'El mensaje de bienvenida no puede superar los 300 caracteres' using errcode = '22023', hint = 'bienvenida';
  end if;
  if char_length(v_pie) > 300 then
    raise exception 'El texto del pie no puede superar los 300 caracteres' using errcode = '22023', hint = 'pie';
  end if;
  if char_length(v_aviso) > 300 then
    raise exception 'El aviso de la ficha no puede superar los 300 caracteres' using errcode = '22023', hint = 'aviso_ficha';
  end if;
  if char_length(v_contacto) > 120 then
    raise exception 'El texto del botón de contacto no puede superar los 120 caracteres' using errcode = '22023', hint = 'texto_boton_contacto';
  end if;
  if char_length(v_eslogan) > 80 then
    raise exception 'El eslogan no puede superar los 80 caracteres' using errcode = '22023', hint = 'eslogan';
  end if;
  return jsonb_build_object(
    'titulo', v_titulo,
    'subtitulo', v_subtitulo,
    'texto_boton', v_texto_boton,
    'boton_destino', v_destino,
    'bienvenida', v_bienvenida,
    'pie', v_pie,
    'aviso_ficha', v_aviso,
    'texto_boton_contacto', v_contacto,
    'eslogan', v_eslogan
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
      case when p_contenido->>'texto_boton_contacto' is distinct from v_vivo->>'texto_boton_contacto' then 'botón de contacto' end,
      case when coalesce(p_contenido->>'eslogan', '') is distinct from v_vivo->>'eslogan' then 'eslogan' end
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

-- Cambio de firma: la versión de 9 argumentos desaparece.
drop function if exists public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text);

create or replace function public.guardar_tienda_contenido(
  p_empresa_id uuid,
  p_titulo text,
  p_subtitulo text,
  p_texto_boton text,
  p_boton_destino text,
  p_bienvenida text,
  p_pie text,
  p_aviso_ficha text,
  p_texto_boton_contacto text,
  p_eslogan text default null
)
returns dominio.tienda_contenido
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_nuevo dominio.tienda_contenido;
  v_d jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar el contenido de la tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
    from dominio.empresas e
   where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  v_d := private.validar_tienda_contenido(jsonb_build_object(
    'titulo', p_titulo,
    'subtitulo', p_subtitulo,
    'texto_boton', p_texto_boton,
    'boton_destino', p_boton_destino,
    'bienvenida', p_bienvenida,
    'pie', p_pie,
    'aviso_ficha', p_aviso_ficha,
    'texto_boton_contacto', p_texto_boton_contacto,
    'eslogan', p_eslogan
  ));

  -- El upsert toma el bloqueo de la fila: dos guardados simultáneos se serializan. El `where`
  -- del DO UPDATE evita escribir (y auditar) cuando nada cambió → idempotente.
  insert into dominio.tienda_contenido as c (
    empresa_id, organizacion_id, titulo, subtitulo, texto_boton, boton_destino,
    bienvenida, pie, aviso_ficha, texto_boton_contacto, eslogan
  ) values (
    p_empresa_id, v_org, v_d->>'titulo', v_d->>'subtitulo', v_d->>'texto_boton', v_d->>'boton_destino',
    v_d->>'bienvenida', v_d->>'pie', v_d->>'aviso_ficha', v_d->>'texto_boton_contacto', v_d->>'eslogan'
  )
  on conflict (empresa_id) do update set
    titulo = excluded.titulo,
    subtitulo = excluded.subtitulo,
    texto_boton = excluded.texto_boton,
    boton_destino = excluded.boton_destino,
    bienvenida = excluded.bienvenida,
    pie = excluded.pie,
    aviso_ficha = excluded.aviso_ficha,
    texto_boton_contacto = excluded.texto_boton_contacto,
    eslogan = excluded.eslogan
  where (c.titulo, c.subtitulo, c.texto_boton, c.boton_destino, c.bienvenida, c.pie, c.aviso_ficha, c.texto_boton_contacto, c.eslogan)
    is distinct from
    (excluded.titulo, excluded.subtitulo, excluded.texto_boton, excluded.boton_destino, excluded.bienvenida, excluded.pie, excluded.aviso_ficha, excluded.texto_boton_contacto, excluded.eslogan)
  returning * into v_nuevo;

  if v_nuevo.empresa_id is null then
    -- Sin cambios: no se duplica la auditoría.
    select * into v_nuevo from dominio.tienda_contenido where empresa_id = p_empresa_id;
    return v_nuevo;
  end if;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.contenido_actualizado',
    format('Actualizó los textos de la tienda de «%s»', v_empresa),
    p_empresa_id
  );
  return v_nuevo;
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
      v_b.contenido->>'bienvenida', v_b.contenido->>'pie', v_b.contenido->>'aviso_ficha', v_b.contenido->>'texto_boton_contacto',
      coalesce(v_b.contenido->>'eslogan', '')
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

revoke execute on function private.contenido_vivo(uuid) from public, anon, authenticated;
revoke execute on function private.validar_tienda_contenido(jsonb) from public, anon, authenticated;
revoke execute on function private.detalle_cambios_tienda(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- FR-052: la RPC viva solo la ejecuta public.publicar_tienda.
revoke execute on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.publicar_tienda(uuid) from public, anon;
grant execute on function public.publicar_tienda(uuid) to authenticated;

comment on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text, text) is
  'F-TDA-03 + MSF-841: guarda los textos comerciales de la tienda (con eslogan). Solo la ejecuta publicar_tienda. 42501 sin permiso, 22023 con hint = campo si un valor es inválido.';

-- ============================================================================
-- publico.contenido_por_dominio con `eslogan` (lista blanca de columnas)
-- ============================================================================

drop function if exists publico.contenido_por_dominio(text);

create function publico.contenido_por_dominio(host text)
returns table (
  titulo text,
  subtitulo text,
  texto_boton text,
  boton_destino text,
  bienvenida text,
  pie text,
  aviso_ficha text,
  texto_boton_contacto text,
  eslogan text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(c.titulo, ''),
    coalesce(c.subtitulo, ''),
    coalesce(c.texto_boton, ''),
    coalesce(c.boton_destino, 'catalogo'),
    coalesce(c.bienvenida, ''),
    coalesce(c.pie, ''),
    coalesce(c.aviso_ficha, ''),
    coalesce(c.texto_boton_contacto, ''),
    coalesce(c.eslogan, '')
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_contenido c on c.empresa_id = t.empresa_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.contenido_por_dominio(text) from public;
grant execute on function publico.contenido_por_dominio(text) to anon, authenticated;

comment on function publico.contenido_por_dominio(text) is
  'MSF-294 + MSF-841: textos comerciales públicos por host (con eslogan). Lista blanca de columnas; vacío si el dominio no existe o la empresa está desactivada.';
