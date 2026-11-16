-- MSF-216 · F-TDA-06 (épica MSF-133, spec 20270125-100000-tienda-dominio-y-publicacion,
-- FR-050…FR-066, FR-070): borrador, vista previa y publicación de la tienda.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * `dominio.tienda_borrador` -> `dominio`: cambios preparados de la tienda de una empresa (entidad de negocio).
--   * `dominio.tienda_versiones` -> `dominio`: historial de publicaciones de esa tienda (entidad de negocio).
--   * `publico` sigue SIN tablas y ninguna de sus funciones lee estas dos (FR-061).
--   * RPC de la app en `public`; auxiliares en `private`.
--
-- Modelo: borrador único por empresa; cada área (`identidad`, `contenido`, `catalogo`) guarda su valor
-- COMPLETO (jsonb). Un área ausente (null) = sin cambios. Al guardar un área igual a lo publicado, el área
-- se descarta; sin áreas, el borrador desaparece (así «hay borrador» siempre significa «hay cambios»).
-- `catalogo` = {categorias:[{id,visible}], productos:[{id,visible,destacado}]}: lo que la gestión quiere
-- para esos elementos; el resto queda como está. Precios, stock y estado activo NO pasan por el borrador
-- (FR-063): se leen siempre en vivo.
--
-- RLS: lectura por organización y sección Empresas; NINGUNA política ni privilegio de escritura (solo se
-- escribe por RPC SECURITY DEFINER, así la auditoría nunca se omite) y `anon` no recibe nada.
--
-- BREAKING (FR-052): `public.guardar_tienda_identidad`, `public.guardar_tienda_contenido` y
-- `public.guardar_catalogo_tienda` dejan de ser ejecutables por `authenticated`; solo las ejecuta
-- `public.publicar_tienda` (SECURITY DEFINER). La firma no cambia. Sus validaciones se extraen a
-- `private.validar_tienda_*` (mismos mensajes) y las comparten con `guardar_borrador_tienda`.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   grant execute on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) to authenticated;
--   grant execute on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) to authenticated;
--   grant execute on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) to authenticated;
--   drop function public.rutas_tienda_sin_referencia(uuid, text[]);
--   drop function public.vista_previa_tienda(uuid);
--   drop function public.publicar_tienda(uuid);
--   drop function public.descartar_borrador_tienda(uuid);
--   drop function public.obtener_borrador_tienda(uuid);
--   drop function public.guardar_borrador_tienda(uuid, text, jsonb);
--   drop function private.catalogo_tienda_efectivo_borrador(uuid, jsonb);
--   drop function private.resumen_cambios_tienda(jsonb);
--   drop function private.detalle_cambios_tienda(uuid, jsonb, jsonb, jsonb);
--   drop function private.unir_lista_es(text[]);
--   drop function private.nombre_usuario(uuid);
--   drop function private.instantanea_tienda(uuid);
--   drop function private.catalogo_vivo(uuid);
--   drop function private.contenido_vivo(uuid);
--   drop function private.identidad_vivo(uuid);
--   (y reponer public.listar_catalogo_tienda y los cuerpos de las tres guardar_* desde sus migraciones de origen:
--    20261023100100, 20261023100200 y 20261023100300)
--   drop function private.validar_catalogo_tienda(uuid, uuid, jsonb, jsonb);
--   drop function private.validar_tienda_contenido(jsonb);
--   drop function private.validar_tienda_identidad(uuid, uuid, jsonb);
--   drop table dominio.tienda_versiones;
--   drop table dominio.tienda_borrador;

-- ============================================================================
-- Tablas (FR-050, FR-058)
-- ============================================================================

create table if not exists dominio.tienda_borrador (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  identidad jsonb,
  contenido jsonb,
  catalogo jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint tienda_borrador_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_borrador_identidad_objeto check (identidad is null or jsonb_typeof(identidad) = 'object'),
  constraint tienda_borrador_contenido_objeto check (contenido is null or jsonb_typeof(contenido) = 'object'),
  constraint tienda_borrador_catalogo_objeto check (catalogo is null or jsonb_typeof(catalogo) = 'object')
);

comment on table dominio.tienda_borrador is
  'MSF-216 (F-TDA-06): cambios preparados (sin publicar) de la tienda de una empresa, por área. Sin fila = nada para publicar. Se escribe solo por public.guardar_borrador_tienda y se borra al publicar o descartar.';

create index if not exists tienda_borrador_organizacion_id_idx on dominio.tienda_borrador (organizacion_id);

create table if not exists dominio.tienda_versiones (
  empresa_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  numero integer not null,
  publicada_at timestamptz not null default now(),
  publicada_por uuid,
  resumen text not null,
  cambios jsonb not null default '[]'::jsonb,
  instantanea jsonb not null,
  primary key (empresa_id, numero),
  constraint tienda_versiones_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint tienda_versiones_numero_positivo check (numero > 0)
);

comment on table dominio.tienda_versiones is
  'MSF-216 (F-TDA-06): cada publicación de la tienda de una empresa (número correlativo, autor, resumen e instantánea de identidad, contenido y catálogo visible/destacado; sin precios, stock ni activo). Se escribe solo por public.publicar_tienda.';
comment on column dominio.tienda_versiones.instantanea is
  'Estado vivo tras publicar: {identidad, contenido, catalogo}. En catalogo solo van las filas que difieren del valor predeterminado (visible y no destacado); lo ausente es el predeterminado.';

create index if not exists tienda_versiones_organizacion_id_idx on dominio.tienda_versiones (organizacion_id);

alter table dominio.tienda_borrador enable row level security;
alter table dominio.tienda_versiones enable row level security;

drop policy if exists tienda_borrador_select on dominio.tienda_borrador;
create policy tienda_borrador_select on dominio.tienda_borrador
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

drop policy if exists tienda_versiones_select on dominio.tienda_versiones;
create policy tienda_versiones_select on dominio.tienda_versiones
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_borrador, dominio.tienda_versiones from public, anon, authenticated;
grant select on dominio.tienda_borrador, dominio.tienda_versiones to authenticated;

-- ============================================================================
-- Estado vivo de cada área (misma forma que guarda el borrador)
-- ============================================================================

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
    'tipografia_titulos', coalesce(i.tipografia_titulos, 'system-ui'),
    'tipografia_texto', coalesce(i.tipografia_texto, 'system-ui'),
    'logo_ruta', i.logo_ruta,
    'banner_ruta', i.banner_ruta,
    'banner_movil_ruta', i.banner_movil_ruta
  )
  from (select 1) base
  left join dominio.tienda_identidad i on i.empresa_id = p_empresa;
$$;

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
    'texto_boton_contacto', coalesce(c.texto_boton_contacto, '')
  )
  from (select 1) base
  left join dominio.tienda_contenido c on c.empresa_id = p_empresa;
$$;

-- Solo las filas que difieren del predeterminado (visible y no destacado).
create or replace function private.catalogo_vivo(p_empresa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', ct.categoria_id, 'visible', ct.visible) order by ct.categoria_id)
        from dominio.categorias_tienda ct
       where ct.empresa_id = p_empresa
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('id', pt.producto_id, 'visible', pt.visible, 'destacado', pt.destacado) order by pt.producto_id)
        from dominio.productos_tienda pt
       where pt.empresa_id = p_empresa
    ), '[]'::jsonb)
  );
$$;

create or replace function private.instantanea_tienda(p_empresa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'identidad', private.identidad_vivo(p_empresa),
    'contenido', private.contenido_vivo(p_empresa),
    'catalogo', private.catalogo_vivo(p_empresa)
  );
$$;

-- Nombre visible de una persona (mismo criterio que el registro de actividad).
create or replace function private.nombre_usuario(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), u.email::text)
    from auth.users u
    left join public.perfiles_usuario p on p.user_id = u.id
   where u.id = p_user;
$$;

revoke execute on function private.identidad_vivo(uuid) from public, anon, authenticated;
revoke execute on function private.contenido_vivo(uuid) from public, anon, authenticated;
revoke execute on function private.catalogo_vivo(uuid) from public, anon, authenticated;
revoke execute on function private.instantanea_tienda(uuid) from public, anon, authenticated;
revoke execute on function private.nombre_usuario(uuid) from public, anon, authenticated;

-- ============================================================================
-- Versión 1 de las tiendas existentes (FR-058): «Configuración inicial»
-- ============================================================================

insert into dominio.tienda_versiones (empresa_id, organizacion_id, numero, publicada_at, publicada_por, resumen, cambios, instantanea)
select t.empresa_id, t.organizacion_id, 1, now(), null, 'Configuración inicial', '[]'::jsonb, private.instantanea_tienda(t.empresa_id)
  from dominio.tiendas t
on conflict (empresa_id, numero) do nothing;

-- ============================================================================
-- Validaciones compartidas (FR-050): las mismas reglas por la ruta del borrador y la de publicar
-- ============================================================================

-- Identidad: devuelve el valor normalizado (colores en mayúsculas). 22023 con los mismos mensajes de siempre.
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
  if v_titulos is null or v_titulos not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans') then
    raise exception 'La tipografía de los títulos no está en la lista' using errcode = '22023';
  end if;
  if v_texto is null or v_texto not in (
       'system-ui', 'Barlow', 'Barlow Condensed', 'Playfair Display', 'Lato', 'Sora', 'Instrument Sans') then
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
    'tipografia_titulos', v_titulos,
    'tipografia_texto', v_texto,
    'logo_ruta', v_logo,
    'banner_ruta', v_banner,
    'banner_movil_ruta', v_banner_movil
  );
end;
$$;

-- Contenido: devuelve el valor recortado. 22023 con `hint` = campo, como siempre.
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
  return jsonb_build_object(
    'titulo', v_titulo,
    'subtitulo', v_subtitulo,
    'texto_boton', v_texto_boton,
    'boton_destino', v_destino,
    'bienvenida', v_bienvenida,
    'pie', v_pie,
    'aviso_ficha', v_aviso,
    'texto_boton_contacto', v_contacto
  );
end;
$$;

-- Catálogo: valida formato, repetidos y pertenencia; devuelve {categorias, productos} normalizado.
create or replace function private.validar_catalogo_tienda(p_org uuid, p_empresa uuid, p_categorias jsonb, p_productos jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cats jsonb := coalesce(p_categorias, '[]'::jsonb);
  v_prods jsonb := coalesce(p_productos, '[]'::jsonb);
begin
  if jsonb_typeof(v_cats) <> 'array' or jsonb_typeof(v_prods) <> 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  -- Valida el formato sin tablas temporales (la función puede llamarse varias veces por transacción).
  begin
    perform 1 from jsonb_to_recordset(v_cats) as x(id uuid, visible boolean);
    perform 1 from jsonb_to_recordset(v_prods) as x(id uuid, visible boolean, destacado boolean);
  exception when others then
    raise exception 'Los cambios tienen un formato inválido' using errcode = '22023';
  end;

  if exists (select 1 from jsonb_to_recordset(v_cats) as x(id uuid, visible boolean) where x.id is null or x.visible is null)
     or exists (select 1 from jsonb_to_recordset(v_prods) as x(id uuid, visible boolean, destacado boolean)
                 where x.id is null or x.visible is null or x.destacado is null) then
    raise exception 'Los cambios tienen valores vacíos' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(v_cats) as x(id uuid)) <> (select count(distinct x.id) from jsonb_to_recordset(v_cats) as x(id uuid))
     or (select count(*) from jsonb_to_recordset(v_prods) as x(id uuid)) <> (select count(distinct x.id) from jsonb_to_recordset(v_prods) as x(id uuid)) then
    raise exception 'Hay elementos repetidos en los cambios' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_cats) as c(id uuid)
     where not exists (select 1 from dominio.categorias k where k.id = c.id and k.organizacion_id = p_org)
  ) then
    raise exception 'Alguna categoría no existe o no pertenece a tu organización' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_prods) as c(id uuid)
     where not exists (
       select 1 from dominio.producto_empresa pe
        where pe.producto_id = c.id and pe.empresa_id = p_empresa and pe.organizacion_id = p_org
     )
  ) then
    raise exception 'Algún producto no pertenece a esta tienda' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible) order by x.id)
        from jsonb_to_recordset(v_cats) as x(id uuid, visible boolean)
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'visible', x.visible, 'destacado', x.destacado) order by x.id)
        from jsonb_to_recordset(v_prods) as x(id uuid, visible boolean, destacado boolean)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function private.validar_tienda_identidad(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.validar_tienda_contenido(jsonb) from public, anon, authenticated;
revoke execute on function private.validar_catalogo_tienda(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ============================================================================
-- Las tres RPC vivas ahora usan los validadores y dejan de ser llamables desde el navegador (FR-052)
-- ============================================================================

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
  p_banner_movil_ruta text default null
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
     and v_actual.tipografia_titulos = v_d->>'tipografia_titulos'
     and v_actual.tipografia_texto = v_d->>'tipografia_texto'
     and v_actual.logo_ruta is not distinct from v_d->>'logo_ruta'
     and v_actual.banner_ruta is not distinct from v_d->>'banner_ruta'
     and v_actual.banner_movil_ruta is not distinct from v_d->>'banner_movil_ruta' then
    return v_actual;
  end if;

  insert into dominio.tienda_identidad as ti (
    empresa_id, organizacion_id, color_primario, color_primario_oscuro, color_acento, color_fondo,
    tipografia_titulos, tipografia_texto, logo_ruta, banner_ruta, banner_movil_ruta
  ) values (
    p_empresa_id, v_org, v_d->>'color_primario', v_d->>'color_primario_oscuro', v_d->>'color_acento', v_d->>'color_fondo',
    v_d->>'tipografia_titulos', v_d->>'tipografia_texto', v_d->>'logo_ruta', v_d->>'banner_ruta', v_d->>'banner_movil_ruta'
  )
  on conflict (empresa_id) do update set
    color_primario = excluded.color_primario,
    color_primario_oscuro = excluded.color_primario_oscuro,
    color_acento = excluded.color_acento,
    color_fondo = excluded.color_fondo,
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

create or replace function public.guardar_tienda_contenido(
  p_empresa_id uuid,
  p_titulo text,
  p_subtitulo text,
  p_texto_boton text,
  p_boton_destino text,
  p_bienvenida text,
  p_pie text,
  p_aviso_ficha text,
  p_texto_boton_contacto text
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
    'texto_boton_contacto', p_texto_boton_contacto
  ));

  -- El upsert toma el bloqueo de la fila: dos guardados simultáneos se serializan. El `where`
  -- del DO UPDATE evita escribir (y auditar) cuando nada cambió → idempotente.
  insert into dominio.tienda_contenido as c (
    empresa_id, organizacion_id, titulo, subtitulo, texto_boton, boton_destino,
    bienvenida, pie, aviso_ficha, texto_boton_contacto
  ) values (
    p_empresa_id, v_org, v_d->>'titulo', v_d->>'subtitulo', v_d->>'texto_boton', v_d->>'boton_destino',
    v_d->>'bienvenida', v_d->>'pie', v_d->>'aviso_ficha', v_d->>'texto_boton_contacto'
  )
  on conflict (empresa_id) do update set
    titulo = excluded.titulo,
    subtitulo = excluded.subtitulo,
    texto_boton = excluded.texto_boton,
    boton_destino = excluded.boton_destino,
    bienvenida = excluded.bienvenida,
    pie = excluded.pie,
    aviso_ficha = excluded.aviso_ficha,
    texto_boton_contacto = excluded.texto_boton_contacto
  where (c.titulo, c.subtitulo, c.texto_boton, c.boton_destino, c.bienvenida, c.pie, c.aviso_ficha, c.texto_boton_contacto)
    is distinct from
    (excluded.titulo, excluded.subtitulo, excluded.texto_boton, excluded.boton_destino, excluded.bienvenida, excluded.pie, excluded.aviso_ficha, excluded.texto_boton_contacto)
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

create or replace function public.guardar_catalogo_tienda(p_empresa uuid, p_categorias jsonb, p_productos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambios integer := 0;
  v_n integer;
  v_empresa text;
  v_cats jsonb := coalesce(p_categorias, '[]'::jsonb);
  v_prods jsonb := coalesce(p_productos, '[]'::jsonb);
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_cats) <> 'array' or jsonb_typeof(v_prods) <> 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  -- Serializa dos guardados simultáneos de la misma tienda.
  perform pg_advisory_xact_lock(hashtextextended('tienda_catalogo:' || p_empresa::text, 0));

  perform private.validar_catalogo_tienda(v_org, p_empresa, v_cats, v_prods);

  -- Categorías: borra las que vuelven al valor predeterminado, inserta/actualiza el resto.
  delete from dominio.categorias_tienda t
   using jsonb_to_recordset(v_cats) as c(id uuid, visible boolean)
   where t.empresa_id = p_empresa and t.categoria_id = c.id and c.visible;
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  with up as (
    insert into dominio.categorias_tienda as t (empresa_id, categoria_id, organizacion_id, visible)
    select p_empresa, c.id, v_org, c.visible from jsonb_to_recordset(v_cats) as c(id uuid, visible boolean) where not c.visible
    on conflict (empresa_id, categoria_id) do update set visible = excluded.visible
      where t.visible is distinct from excluded.visible
    returning 1
  )
  select count(*) into v_n from up;
  v_cambios := v_cambios + v_n;

  -- Productos.
  delete from dominio.productos_tienda t
   using jsonb_to_recordset(v_prods) as c(id uuid, visible boolean, destacado boolean)
   where t.empresa_id = p_empresa and t.producto_id = c.id and c.visible and not c.destacado;
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  with up as (
    insert into dominio.productos_tienda as t (empresa_id, producto_id, organizacion_id, visible, destacado)
    select p_empresa, c.id, v_org, c.visible, c.destacado
      from jsonb_to_recordset(v_prods) as c(id uuid, visible boolean, destacado boolean)
     where not (c.visible and not c.destacado)
    on conflict (empresa_id, producto_id) do update
      set visible = excluded.visible, destacado = excluded.destacado
      where (t.visible, t.destacado) is distinct from (excluded.visible, excluded.destacado)
    returning 1
  )
  select count(*) into v_n from up;
  v_cambios := v_cambios + v_n;

  if v_cambios > 0 then
    perform private.insertar_actividad(
      v_org,
      (select auth.uid()),
      'tienda.catalogo_actualizado',
      format('Actualizó el catálogo visible de la tienda de «%s»', v_empresa),
      p_empresa
    );
  end if;

  return (
    select jsonb_build_object(
             'visibles', count(*) filter (where x.efectivo),
             'destacados', count(*) filter (where x.efectivo and x.destacado))
      from private.catalogo_tienda_efectivo(p_empresa) x
  );
end;
$$;

-- BREAKING (FR-052): solo las ejecuta public.publicar_tienda.
revoke execute on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ============================================================================
-- Resumen de cambios calculado en el servidor (FR-053, FR-055)
-- ============================================================================

create or replace function private.unir_lista_es(p_items text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(cardinality(p_items), 0) = 0 then ''
    when cardinality(p_items) = 1 then p_items[1]
    else array_to_string(p_items[1:cardinality(p_items) - 1], ', ') || ' y ' || p_items[cardinality(p_items)]
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
      case when (p_identidad->>'color_primario', p_identidad->>'color_primario_oscuro', p_identidad->>'color_acento', p_identidad->>'color_fondo')
             is distinct from (v_vivo->>'color_primario', v_vivo->>'color_primario_oscuro', v_vivo->>'color_acento', v_vivo->>'color_fondo')
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

-- {total, resumen, detalle}: total = cantidad de elementos tocados; resumen = «colores, texto del banner y 2 productos visibles».
create or replace function private.resumen_cambios_tienda(p_detalle jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with campos as (
    select c.valor as campo, e.i, c.j
      from jsonb_array_elements(p_detalle) with ordinality as e(v, i),
           jsonb_array_elements_text(e.v->'campos') with ordinality as c(valor, j)
  )
  select jsonb_build_object(
    'total', (select count(*) from campos),
    'resumen', private.unir_lista_es(coalesce((select array_agg(campo order by i, j) from campos), '{}'::text[])),
    'detalle', p_detalle
  );
$$;

revoke execute on function private.unir_lista_es(text[]) from public, anon, authenticated;
revoke execute on function private.detalle_cambios_tienda(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function private.resumen_cambios_tienda(jsonb) from public, anon, authenticated;

-- ============================================================================
-- Catálogo con el borrador encima (FR-051, FR-059)
-- ============================================================================

-- Misma definición de visibilidad efectiva que private.catalogo_tienda_efectivo(uuid) (que sigue siendo la que
-- usan las funciones de `publico`, sin tocar), con la visibilidad y el destacado del borrador superpuestos.
create or replace function private.catalogo_tienda_efectivo_borrador(p_empresa uuid, p_borrador jsonb)
returns table (
  producto_id uuid,
  nombre text,
  activo boolean,
  moneda text,
  precio numeric,
  stock integer,
  categoria_id uuid,
  visible boolean,
  destacado boolean,
  efectivo boolean,
  motivo text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bc as (
    select x.id, x.visible
      from jsonb_to_recordset(coalesce(p_borrador->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
  ),
  bp as (
    select x.id, x.visible, x.destacado
      from jsonb_to_recordset(coalesce(p_borrador->'productos', '[]'::jsonb)) as x(id uuid, visible boolean, destacado boolean)
  ),
  cat as (
    select c.id,
           coalesce(bcc.visible, ct.visible, true) and coalesce(bcp.visible, cp.visible, true) as visible
      from dominio.categorias c
      join dominio.empresas e on e.id = p_empresa and e.organizacion_id = c.organizacion_id
      left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
      left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
      left join bc bcc on bcc.id = c.id
      left join bc bcp on bcp.id = c.padre_id
  ),
  base as (
    select p.id, p.nombre, p.activo, p.moneda, p.precio_lista, p.categoria_id,
           coalesce(bpp.visible, pt.visible, true) as visible,
           coalesce(bpp.destacado, pt.destacado, false) as destacado,
           coalesce(cat.visible, true) as cat_visible,
           ex.cantidad
      from dominio.producto_empresa pe
      join dominio.productos p on p.id = pe.producto_id and p.organizacion_id = pe.organizacion_id
      left join dominio.productos_tienda pt on pt.empresa_id = pe.empresa_id and pt.producto_id = p.id
      left join bp bpp on bpp.id = p.id
      left join cat on cat.id = p.categoria_id
      left join dominio.existencias ex on ex.producto_id = p.id and ex.organizacion_id = p.organizacion_id
     where pe.empresa_id = p_empresa
  )
  select b.id, b.nombre, b.activo, b.moneda, b.precio_lista, b.cantidad, b.categoria_id, b.visible, b.destacado,
         b.activo and b.visible and b.cat_visible,
         case
           when not b.activo then 'No se muestra: producto inactivo'
           when not b.cat_visible then 'No se muestra: categoría oculta'
         end
    from base b;
$$;

revoke execute on function private.catalogo_tienda_efectivo_borrador(uuid, jsonb) from public, anon, authenticated;

-- Igual que antes, pero superpone el borrador del catálogo (FR-051): la gestión ve lo que va a publicar.
create or replace function public.listar_catalogo_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_borrador jsonb;
  v_resultado jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  select b.catalogo into v_borrador from dominio.tienda_borrador b where b.empresa_id = p_empresa;

  select jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'visible', coalesce(bc.visible, ct.visible, true),
               -- Productos de ESTA tienda asignados directamente a la categoría.
               'productos', (select count(*) from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x where x.categoria_id = c.id)
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
        left join jsonb_to_recordset(coalesce(v_borrador->'categorias', '[]'::jsonb)) as bc(id uuid, visible boolean) on bc.id = c.id
       where c.organizacion_id = v_org
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.producto_id,
               'nombre', x.nombre,
               'moneda', x.moneda,
               'precio', x.precio,
               'stock', coalesce(x.stock, 0),
               'visible', x.visible,
               'destacado', x.destacado,
               'efectivo', x.efectivo,
               'motivo', x.motivo
             ) order by lower(x.nombre), x.producto_id)
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x
    ), '[]'::jsonb),
    'resumen', (
      select jsonb_build_object(
               'visibles', count(*) filter (where x.efectivo),
               'destacados', count(*) filter (where x.efectivo and x.destacado))
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_borrador) x
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

-- ============================================================================
-- public.guardar_borrador_tienda (FR-050)
-- ============================================================================

-- Guarda el valor COMPLETO de un área, validado con las mismas reglas que las RPC vivas. Un valor inválido no
-- se guarda. Dos administradores: en la misma área gana el último; en áreas distintas quedan ambas.
create or replace function public.guardar_borrador_tienda(p_empresa uuid, p_area text, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_valor jsonb;
  v_actual dominio.tienda_borrador;
  v_identidad jsonb;
  v_contenido jsonb;
  v_catalogo jsonb;
  v_detalle jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  if p_area is null or p_area not in ('identidad', 'contenido', 'catalogo') then
    raise exception 'El área del borrador no es válida' using errcode = '22023';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos del borrador tienen un formato inválido' using errcode = '22023';
  end if;

  v_valor := case p_area
    when 'identidad' then private.validar_tienda_identidad(v_org, p_empresa, p_datos)
    when 'contenido' then private.validar_tienda_contenido(p_datos)
    else private.validar_catalogo_tienda(v_org, p_empresa, p_datos->'categorias', p_datos->'productos')
  end;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  select * into v_actual from dominio.tienda_borrador where empresa_id = p_empresa;
  v_identidad := case when p_area = 'identidad' then v_valor else v_actual.identidad end;
  v_contenido := case when p_area = 'contenido' then v_valor else v_actual.contenido end;
  v_catalogo := case when p_area = 'catalogo' then v_valor else v_actual.catalogo end;

  -- Las áreas que no difieren de lo publicado se descartan; sin áreas, no hay borrador.
  v_detalle := private.detalle_cambios_tienda(p_empresa, v_identidad, v_contenido, v_catalogo);
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'identidad') then v_identidad := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'contenido') then v_contenido := null; end if;
  if not exists (select 1 from jsonb_array_elements(v_detalle) e where e->>'area' = 'catalogo') then v_catalogo := null; end if;

  if v_identidad is null and v_contenido is null and v_catalogo is null then
    delete from dominio.tienda_borrador where empresa_id = p_empresa;
    return;
  end if;

  insert into dominio.tienda_borrador as b (empresa_id, organizacion_id, identidad, contenido, catalogo, updated_by, updated_at)
  values (p_empresa, v_org, v_identidad, v_contenido, v_catalogo, (select auth.uid()), now())
  on conflict (empresa_id) do update set
    identidad = excluded.identidad,
    contenido = excluded.contenido,
    catalogo = excluded.catalogo,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;

-- ============================================================================
-- public.obtener_borrador_tienda (FR-053, FR-054, FR-055)
-- ============================================================================

create or replace function public.obtener_borrador_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_activa boolean;
  v_b dominio.tienda_borrador;
  v_cambios jsonb;
  v_version jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.activa into v_activa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;
  v_cambios := private.resumen_cambios_tienda(private.detalle_cambios_tienda(p_empresa, v_b.identidad, v_b.contenido, v_b.catalogo));

  select jsonb_build_object('numero', v.numero, 'publicada_at', v.publicada_at, 'publicada_por', private.nombre_usuario(v.publicada_por))
    into v_version
    from dominio.tienda_versiones v
   where v.empresa_id = p_empresa
   order by v.numero desc
   limit 1;

  return jsonb_build_object(
    'hay_borrador', (v_cambios->>'total')::integer > 0,
    'identidad', v_b.identidad,
    'contenido', v_b.contenido,
    'catalogo', v_b.catalogo,
    'cambios', v_cambios,
    'version_vigente', v_version,
    'en_linea', v_activa,
    'dominio', (select t.dominio from dominio.tiendas t where t.empresa_id = p_empresa)
  );
end;
$$;

-- ============================================================================
-- public.descartar_borrador_tienda (FR-057, FR-064)
-- ============================================================================

create or replace function public.descartar_borrador_tienda(p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_b dominio.tienda_borrador;
  v_areas text[];
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tienda_borrador:' || p_empresa::text, 0));

  delete from dominio.tienda_borrador where empresa_id = p_empresa returning * into v_b;
  if v_b.empresa_id is null then
    return; -- idempotente: sin borrador no hay nada que descartar ni auditar
  end if;

  v_areas := array_remove(array[
    case when v_b.identidad is not null then 'identidad visual' end,
    case when v_b.contenido is not null then 'contenido' end,
    case when v_b.catalogo is not null then 'catálogo visible' end
  ], null);
  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.borrador_descartado',
    format('Descartó los cambios sin publicar de la tienda de «%s» (%s)', v_empresa, private.unir_lista_es(v_areas)),
    p_empresa
  );
end;
$$;

-- ============================================================================
-- public.publicar_tienda (FR-052, FR-056, FR-058, FR-062, FR-063, FR-064)
-- ============================================================================

-- Una transacción: bloquea la empresa, aplica cada área con las RPC vivas, crea la versión siguiente con su
-- instantánea y resumen, y borra el borrador. Sin borrador (o sin cambios) no hace nada: {version: null}.
-- Dos publicaciones simultáneas: la segunda espera el bloqueo y encuentra el borrador ya aplicado.
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
      v_b.identidad->>'logo_ruta', v_b.identidad->>'banner_ruta', v_b.identidad->>'banner_movil_ruta'
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

-- ============================================================================
-- public.vista_previa_tienda (FR-059, FR-060)
-- ============================================================================

-- Borrador sobre lo publicado, con precios, stock y estado activo reales (FR-063). Lista blanca: nunca costos,
-- stock exacto ni proveedor. Solo lectura. Mismas formas que `publico.*` (identidad, contenido, categorías,
-- destacados) para que la home use los mismos componentes.
create or replace function public.vista_previa_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 8;
  v_org uuid := (select private.organizacion_id());
  v_nombre text;
  v_activa boolean;
  v_b dominio.tienda_borrador;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de esta tienda' using errcode = '42501';
  end if;
  select e.nombre, e.activa into v_nombre, v_activa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  select * into v_b from dominio.tienda_borrador where empresa_id = p_empresa;

  return (
    with efectivos as (
      select x.producto_id, x.nombre, x.categoria_id, x.destacado
        from private.catalogo_tienda_efectivo_borrador(p_empresa, v_b.catalogo) x
       where x.efectivo
    ),
    elegidos as (
      select f.* from efectivos f where f.destacado order by lower(f.nombre), f.producto_id limit c_tope
    ),
    bc as (
      select x.id, x.visible
        from jsonb_to_recordset(coalesce(v_b.catalogo->'categorias', '[]'::jsonb)) as x(id uuid, visible boolean)
    ),
    cat as (
      select c.id, c.nombre, c.padre_id, c.posicion
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
        left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
        left join bc bcc on bcc.id = c.id
        left join bc bcp on bcp.id = c.padre_id
       where c.organizacion_id = v_org
         and coalesce(bcc.visible, ct.visible, true)
         and coalesce(bcp.visible, cp.visible, true)
    )
    select jsonb_build_object(
      'empresa_nombre', v_nombre,
      'en_linea', v_activa,
      'identidad', coalesce(v_b.identidad, private.identidad_vivo(p_empresa)),
      'contenido', coalesce(v_b.contenido, private.contenido_vivo(p_empresa)),
      'hay_productos', exists (select 1 from efectivos),
      'categorias', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id,
                 'nombre', c.nombre,
                 'padre_id', c.padre_id,
                 'productos', (select count(*) from efectivos f where f.categoria_id = c.id)
               ) order by (c.padre_id is not null), c.posicion, c.id)
          from cat c), '[]'::jsonb),
      'destacados', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', g.producto_id,
                 'nombre', g.nombre,
                 'precio', private.precio_final_publico(g.producto_id, p_empresa),
                 'disponible', private.disponible_publico(g.producto_id),
                 'imagen', (select i.ruta from dominio.producto_imagenes i
                             where i.producto_id = g.producto_id order by i.posicion limit 1),
                 'categoria_id', g.categoria_id
               ) order by lower(g.nombre), g.producto_id)
          from elegidos g), '[]'::jsonb)
    )
  );
end;
$$;

-- ============================================================================
-- public.rutas_tienda_sin_referencia (FR-062)
-- ============================================================================

-- De las rutas candidatas a borrar (archivos reemplazados), devuelve las que NINGUNA referencia usa: ni la tienda
-- publicada, ni el borrador, ni alguna versión. La app solo borra estas.
create or replace function public.rutas_tienda_sin_referencia(p_empresa uuid, p_rutas text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_prefijo text;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  v_prefijo := v_org::text || '/' || p_empresa::text || '/';

  return coalesce((
    select array_agg(distinct r)
      from unnest(coalesce(p_rutas, '{}'::text[])) as r
     where r is not null
       and left(r, length(v_prefijo)) = v_prefijo
       and not exists (
         select 1 from dominio.tienda_identidad i
          where i.empresa_id = p_empresa and r in (i.logo_ruta, i.banner_ruta, i.banner_movil_ruta))
       and not exists (
         select 1 from dominio.tienda_borrador b
          where b.empresa_id = p_empresa
            and r in (b.identidad->>'logo_ruta', b.identidad->>'banner_ruta', b.identidad->>'banner_movil_ruta'))
       and not exists (
         select 1 from dominio.tienda_versiones v
          where v.empresa_id = p_empresa
            and r in (v.instantanea->'identidad'->>'logo_ruta', v.instantanea->'identidad'->>'banner_ruta', v.instantanea->'identidad'->>'banner_movil_ruta'))
  ), '{}'::text[]);
end;
$$;

-- ============================================================================
-- Permisos y comentarios
-- ============================================================================

revoke execute on function public.guardar_borrador_tienda(uuid, text, jsonb) from public, anon;
revoke execute on function public.obtener_borrador_tienda(uuid) from public, anon;
revoke execute on function public.descartar_borrador_tienda(uuid) from public, anon;
revoke execute on function public.publicar_tienda(uuid) from public, anon;
revoke execute on function public.vista_previa_tienda(uuid) from public, anon;
revoke execute on function public.rutas_tienda_sin_referencia(uuid, text[]) from public, anon;
grant execute on function public.guardar_borrador_tienda(uuid, text, jsonb) to authenticated;
grant execute on function public.obtener_borrador_tienda(uuid) to authenticated;
grant execute on function public.descartar_borrador_tienda(uuid) to authenticated;
grant execute on function public.publicar_tienda(uuid) to authenticated;
grant execute on function public.vista_previa_tienda(uuid) to authenticated;
grant execute on function public.rutas_tienda_sin_referencia(uuid, text[]) to authenticated;
-- listar_catalogo_tienda conserva su grant (create or replace no toca los permisos); se reafirma por claridad.
revoke execute on function public.listar_catalogo_tienda(uuid) from public, anon;
grant execute on function public.listar_catalogo_tienda(uuid) to authenticated;

comment on function public.guardar_borrador_tienda(uuid, text, jsonb) is
  'F-TDA-06: guarda en el borrador el valor completo de un área (identidad, contenido o catalogo) con las mismas validaciones de las RPC vivas. Edición en Empresas. Un área igual a lo publicado se descarta.';
comment on function public.obtener_borrador_tienda(uuid) is
  'F-TDA-06: borrador por área, resumen de cambios calculado en servidor ({total, resumen, detalle}), versión vigente, si la tienda está en línea y su dominio. Lectura con sección Empresas.';
comment on function public.descartar_borrador_tienda(uuid) is
  'F-TDA-06: borra el borrador de la tienda (idempotente). Edición en Empresas; registra tienda.borrador_descartado solo si había borrador.';
comment on function public.publicar_tienda(uuid) is
  'F-TDA-06: aplica el borrador en una transacción, crea la versión siguiente con su instantánea y resumen y borra el borrador. Idempotente: sin borrador devuelve {version: null}. Registra tienda.publicada.';
comment on function public.vista_previa_tienda(uuid) is
  'F-TDA-06: la home de la tienda con el borrador sobre lo publicado (identidad, contenido, categorías, destacados con precio final). Lista blanca: sin costos, stock exacto ni proveedor. Solo lectura; edición en Empresas.';
comment on function public.rutas_tienda_sin_referencia(uuid, text[]) is
  'F-TDA-06: de las rutas de archivos candidatas a borrar devuelve las que no usa la tienda publicada, el borrador ni ninguna versión.';
comment on function public.guardar_tienda_identidad(uuid, text, text, text, text, text, text, text, text, text) is
  'F-TDA-02 / F-TDA-06: aplica la identidad visual de la tienda (estado completo). Ya NO es ejecutable por authenticated: solo public.publicar_tienda. Idempotente; emite tienda.identidad_actualizada.';
comment on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) is
  'MSF-294 / F-TDA-06: aplica los textos de la tienda. Ya NO es ejecutable por authenticated: solo public.publicar_tienda. Idempotente; registra tienda.contenido_actualizado solo si algo cambió.';
comment on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) is
  'MSF-312 / F-TDA-06: aplica en una transacción la visibilidad y destacados del catálogo. Ya NO es ejecutable por authenticated: solo public.publicar_tienda. Idempotente; emite tienda.catalogo_actualizado solo ante cambios reales.';
