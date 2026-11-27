-- Lote 95 (MSF-979, seguimiento de la épica MSF-468, fase 4, T020): imágenes de producto en el correo del newsletter.
--
-- Decisión (Nicolás delegó, Claude decidió): un bucket PÚBLICO DEDICADO de solo lectura, `newsletter-imagenes`, con COPIAS OPTIMIZADAS (WebP, lado largo
-- máximo 600 px) creadas al ENVIAR la campaña. El bucket privado `productos-imagenes` NO se expone: nunca se firma ni se publica; el original solo lo lee
-- quien edita el newsletter con su propia sesión (el navegador lo baja con la política de lectura que ya existe, lo recodifica y sube la copia). Una URL firmada
-- de larga vida se descartó: cualquier correo reenviado la lleva con acceso a un bucket privado y un token que no se puede revocar sin rotar claves.
--
-- Qué se agrega:
--   1. Bucket `newsletter-imagenes` (público, solo `image/webp`, hasta 256 KiB por archivo). Ruta `<organizacion>/<tienda>/<producto>.webp`: una copia por
--      producto y tienda, que cada envío sobrescribe (no se acumulan). Escritura solo de un Administrador con edición en Contactos y acceso a la tienda;
--      la lectura pública no necesita política (es un bucket público); la política de lectura de `authenticated` es solo para su propia organización.
--   2. `private.newsletter_imagenes`: qué copia vale para qué producto (ruta, URL pública y la imagen original de la que salió). Es lógica interna: RLS
--      activado y una política que deniega todo a `anon` y `authenticated`; se escribe solo por `public.registrar_imagen_newsletter` (security definer) y se
--      lee solo desde las funciones `security definer`. Vive en `private` (no es un dato de negocio exportable: es una copia derivada de las imágenes).
--   3. `public.productos_para_imagenes_newsletter(tienda, destacados, promociones)`: qué productos entran en la foto del envío y cuál es su imagen principal
--      (para que el panel sepa qué copiar). Exige Administrador (mismo `private.exigir_admin_newsletter`).
--   4. `public.registrar_imagen_newsletter(tienda, producto, imagen, url)`: registra la copia subida. Verifica que el archivo existe en el bucket, que la URL es
--      `https` y termina EXACTAMENTE en `/storage/v1/object/public/newsletter-imagenes/<ruta>` y que la imagen original sigue siendo la principal del producto.
--   5. `private.url_imagen_newsletter(tienda, producto)`: la URL pública SOLO si la copia sigue vigente (el original sigue siendo la imagen principal y el
--      archivo existe); si el producto cambió de imagen principal el correo sale sin imagen, nunca con una vieja.
--   6. `private.armar_bloques_newsletter` completa `imagen_url` con esa función (antes siempre nulo) y `private.cuerpo_html_newsletter` dibuja la imagen
--      (`<img>` con `alt` = nombre del producto, ancho fijo, solo si la URL es `https`). Mismo cuerpo que 20270420000300 en todo lo demás.
--   7. `private.purgar_imagenes_newsletter(dias)`: borra los registros de más de N días y devuelve sus rutas, para quitar los archivos con la API de Storage
--      (borrar filas de `storage.objects` con SQL está prohibido y deja los archivos huérfanos). `public.purgar_imagenes_newsletter` es su envoltorio
--      para `service_role`. No está agendada; el flow o script de limpieza y el borrado con la API de Storage están en docs/newsletter.md.
--
-- Límite honesto: el bucket es público, así que quien conozca la ruta (tres uuid) baja una miniatura de 600 px de un producto que ya es público en la tienda.
-- Solo se copian productos que están en el newsletter (destacados y promociones vigentes de la tienda). Una copia no se retira sola al ocultar un producto.
--
-- Esquemas (Principio VII): bucket y políticas de `storage.objects` son infraestructura de plataforma; `private.newsletter_imagenes` es lógica interna sin
-- acceso de API; las dos RPC van en `public` (security definer, search_path vacío, solo `authenticated`).
--
-- Aditiva e idempotente. Reversión (migración posterior; pasos reales y en orden):
--   1. restaurar los cuerpos de `private.armar_bloques_newsletter` y `private.cuerpo_html_newsletter` de 20270420000300;
--   2. drop function if exists public.purgar_imagenes_newsletter(integer), public.registrar_imagen_newsletter(uuid, uuid, uuid, text), public.productos_para_imagenes_newsletter(uuid, boolean, boolean),
--      private.purgar_imagenes_newsletter(integer), private.url_imagen_newsletter(uuid, uuid), private.imagen_html_newsletter(jsonb);
--   3. drop table if exists private.newsletter_imagenes;
--   4. vaciar el bucket con la API de Storage y luego: drop policy newsletter_imagenes_objetos_select/insert/update/delete on storage.objects;
--      delete from storage.buckets where id = 'newsletter-imagenes';
--   Sin los pasos 1-3 los correos salen igual que antes (sin imágenes).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('newsletter-imagenes', 'newsletter-imagenes', true, 262144, array['image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists newsletter_imagenes_objetos_select on storage.objects;
drop policy if exists newsletter_imagenes_objetos_insert on storage.objects;
drop policy if exists newsletter_imagenes_objetos_update on storage.objects;
drop policy if exists newsletter_imagenes_objetos_delete on storage.objects;

-- La ruta es `<organizacion>/<tienda>/<producto>.webp`. Solo un Administrador con edición en Contactos y acceso a esa tienda escribe, y solo en su organización.
create policy newsletter_imagenes_objetos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'newsletter-imagenes'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

create policy newsletter_imagenes_objetos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'newsletter-imagenes'
    and array_length(storage.foldername(name), 1) = 2
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('clientes')) = 'edicion'
    and (select private.es_administrador_propio_de((select private.organizacion_id())))
    and exists (
      select 1 from dominio.empresas e
       where e.id::text = (storage.foldername(name))[2]
         and e.organizacion_id = (select private.organizacion_id())
         and e.id in (select private.empresas_accesibles()))
  );

-- Sobrescribir la copia de un producto (upsert) y quitarla: mismas condiciones.
create policy newsletter_imagenes_objetos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'newsletter-imagenes'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('clientes')) = 'edicion'
    and (select private.es_administrador_propio_de((select private.organizacion_id())))
    and exists (
      select 1 from dominio.empresas e
       where e.id::text = (storage.foldername(name))[2]
         and e.organizacion_id = (select private.organizacion_id())
         and e.id in (select private.empresas_accesibles()))
  )
  with check (
    bucket_id = 'newsletter-imagenes'
    and array_length(storage.foldername(name), 1) = 2
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('clientes')) = 'edicion'
    and (select private.es_administrador_propio_de((select private.organizacion_id())))
    and exists (
      select 1 from dominio.empresas e
       where e.id::text = (storage.foldername(name))[2]
         and e.organizacion_id = (select private.organizacion_id())
         and e.id in (select private.empresas_accesibles()))
  );

create policy newsletter_imagenes_objetos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'newsletter-imagenes'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('clientes')) = 'edicion'
    and (select private.es_administrador_propio_de((select private.organizacion_id())))
    and exists (
      select 1 from dominio.empresas e
       where e.id::text = (storage.foldername(name))[2]
         and e.organizacion_id = (select private.organizacion_id())
         and e.id in (select private.empresas_accesibles()))
  );

create table if not exists private.newsletter_imagenes (
  empresa_id uuid not null,
  producto_id uuid not null,
  organizacion_id uuid not null,
  -- Imagen original (dominio.producto_imagenes) de la que salió la copia: si deja de ser la principal, la copia no vale.
  imagen_id uuid not null,
  ruta text not null check (char_length(ruta) <= 200 and ruta ~ '\.webp$'),
  url text not null check (char_length(url) <= 500 and url ~ '^https://' and url !~ '[[:space:]"''<>\\]'),
  actualizada_en timestamptz not null default now(),
  primary key (empresa_id, producto_id),
  constraint newsletter_imagenes_ruta_uq unique (ruta),
  constraint newsletter_imagenes_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint newsletter_imagenes_producto_fk foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  constraint newsletter_imagenes_ruta_coherente check (ruta = organizacion_id::text || '/' || empresa_id::text || '/' || producto_id::text || '.webp')
);

comment on table private.newsletter_imagenes is
  'MSF-979: copia optimizada (WebP, 600 px) de la imagen principal de un producto, en el bucket público newsletter-imagenes, para el correo del newsletter. Solo la escribe public.registrar_imagen_newsletter.';

create index if not exists newsletter_imagenes_organizacion_idx on private.newsletter_imagenes (organizacion_id, empresa_id);
create index if not exists newsletter_imagenes_actualizada_idx on private.newsletter_imagenes (actualizada_en);

alter table private.newsletter_imagenes enable row level security;
revoke all on table private.newsletter_imagenes from public, anon, authenticated;
drop policy if exists newsletter_imagenes_denegar_todo on private.newsletter_imagenes;
create policy newsletter_imagenes_denegar_todo on private.newsletter_imagenes
  as permissive for all to anon, authenticated
  using (false) with check (false);

-- URL pública de la copia, SOLO si sigue vigente: el original sigue siendo la imagen principal del producto y el archivo existe en el bucket.
create or replace function private.url_imagen_newsletter(p_empresa uuid, p_producto uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select n.url
    from private.newsletter_imagenes n
   where n.empresa_id = p_empresa and n.producto_id = p_producto
     and n.imagen_id = (select i.id from dominio.producto_imagenes i where i.producto_id = p_producto order by i.posicion, i.id limit 1)
     and exists (select 1 from storage.objects o where o.bucket_id = 'newsletter-imagenes' and o.name = n.ruta);
$$;

comment on function private.url_imagen_newsletter(uuid, uuid) is
  'MSF-979: URL pública de la copia de la imagen principal del producto para el newsletter, o null si no hay copia vigente. Sin acceso de API.';
revoke execute on function private.url_imagen_newsletter(uuid, uuid) from public, anon, authenticated, service_role;

-- <img> del correo: solo con una URL https; alt = nombre del producto escapado; ancho fijo (los clientes de correo no usan CSS externo).
create or replace function private.imagen_html_newsletter(p_item jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_item ->> 'imagen_url' ~ '^https://'
              then '<img src="' || private.escapar_html(p_item ->> 'imagen_url') || '" alt="' || private.escapar_html(p_item ->> 'nombre')
                   || '" width="96" style="display: block; border: 0; margin: 0 0 4px 0;">'
              else '' end;
$$;

comment on function private.imagen_html_newsletter(jsonb) is
  'MSF-979: etiqueta <img> de un producto del newsletter (vacía si no hay URL https). Todo texto escapado.';
revoke execute on function private.imagen_html_newsletter(jsonb) from public, anon, authenticated;

-- Qué copiar antes de enviar: los productos de la foto (los mismos que `armar_bloques_newsletter`) con su imagen principal. Sin imagen: se omiten.
create or replace function public.productos_para_imagenes_newsletter(p_empresa uuid, p_destacados boolean, p_promociones boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_bloques jsonb;
begin
  if p_empresa is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  if p_destacados is null or p_promociones is null then
    raise exception 'Falta indicar las secciones del newsletter' using errcode = '22023';
  end if;
  v_bloques := private.armar_bloques_newsletter(p_empresa, p_destacados, p_promociones);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'producto_id', x.producto_id, 'organizacion_id', v_org, 'imagen_id', i.id, 'origen', i.ruta) order by x.producto_id)
      from (
        select distinct (e ->> 'producto_id')::uuid as producto_id
          from jsonb_array_elements(coalesce(v_bloques -> 'destacados', '[]'::jsonb) || coalesce(v_bloques -> 'promociones', '[]'::jsonb)) e
      ) x
      cross join lateral (
        select pi.id, pi.ruta from dominio.producto_imagenes pi
         where pi.producto_id = x.producto_id and pi.organizacion_id = v_org
         order by pi.posicion, pi.id limit 1
      ) i
  ), '[]'::jsonb);
end;
$$;

comment on function public.productos_para_imagenes_newsletter(uuid, boolean, boolean) is
  'MSF-979: productos del newsletter con su imagen principal (id y ruta en el bucket privado) para que el panel prepare las copias optimizadas antes de enviar. Solo Administrador.';
revoke execute on function public.productos_para_imagenes_newsletter(uuid, boolean, boolean) from public, anon;
grant execute on function public.productos_para_imagenes_newsletter(uuid, boolean, boolean) to authenticated;

-- Registra la copia ya subida. `p_imagen` es la imagen original que se copió (la que devolvió `productos_para_imagenes_newsletter`).
create or replace function public.registrar_imagen_newsletter(p_empresa uuid, p_producto uuid, p_imagen uuid, p_url text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_ruta text;
  v_cabeceras jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_host_api text;
  v_autoridad text;
begin
  if p_empresa is null or p_producto is null or p_imagen is null then
    raise exception 'Faltan datos de la imagen' using errcode = '22023';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  -- Solo un producto publicado en ESTA tienda (visible, activo y efectivo): no se copian imágenes de lo que la tienda no muestra.
  if not exists (select 1 from private.catalogo_tienda_efectivo(p_empresa) g where g.producto_id = p_producto and g.efectivo) then
    raise exception 'El producto no está publicado en la tienda' using errcode = '22023', hint = 'producto';
  end if;
  -- Solo la imagen principal actual: una copia de otra (o ya quitada) no sirve.
  if p_imagen is distinct from (select i.id from dominio.producto_imagenes i where i.producto_id = p_producto and i.organizacion_id = v_org order by i.posicion, i.id limit 1) then
    raise exception 'La imagen ya no es la principal del producto' using errcode = '22023', hint = 'imagen';
  end if;
  v_ruta := v_org::text || '/' || p_empresa::text || '/' || p_producto::text || '.webp';
  if not exists (select 1 from storage.objects o where o.bucket_id = 'newsletter-imagenes' and o.name = v_ruta) then
    raise exception 'La copia de la imagen no está en el bucket' using errcode = '22023', hint = 'archivo';
  end if;
  -- Dirección pública: se COMPARA entera contra la esperada, nunca se «parsea» un host de un texto libre. La esperada es
  -- `https://<host de la API>[:<puerto>]/storage/v1/object/public/newsletter-imagenes/<ruta>`, con el host que pone el proxy (`x-forwarded-host`, el primero de la
  -- lista, o `host`) y solo con letras, números, puntos y guiones (sin `@`, sin barras ni espacios). Una dirección con userinfo (`https://host:x@otro.com/...`), consulta,
  -- fragmento o de otro bucket no es igual a la esperada. LÍMITE HONESTO: la cabecera la pone el proxy, no es un secreto del servidor; es defensa en profundidad
  -- (un Administrador solo podría apuntar a una imagen de su propio correo), no un control fuerte. Se verifica en DEV qué cabecera llega (docs/newsletter.md).
  if p_url is null or char_length(p_url) > 500 or left(p_url, 8) <> 'https://' then
    raise exception 'La dirección pública de la imagen no es válida' using errcode = '22023', hint = 'url';
  end if;
  v_host_api := lower(btrim(split_part(coalesce(nullif(v_cabeceras ->> 'x-forwarded-host', ''), v_cabeceras ->> 'host', ''), ',', 1)));
  if v_host_api !~ '^[a-z0-9.-]+(:[0-9]{1,5})?$' then
    raise exception 'La dirección pública de la imagen no es de este servidor' using errcode = '22023', hint = 'host';
  end if;
  v_autoridad := lower(substring(p_url from '^https://([^/]*)'));
  -- (La forma del host ya la fija la cabecera: la autoridad de la dirección debe ser IGUAL a ella, así que no hace falta validarla aparte.)
  if v_autoridad is null or v_autoridad not in (v_host_api, regexp_replace(v_host_api, ':[0-9]+$', '')) then
    raise exception 'La dirección pública de la imagen no es de este servidor' using errcode = '22023', hint = 'host';
  end if;
  if p_url is distinct from 'https://' || substring(p_url from '^https://([^/]*)') || '/storage/v1/object/public/newsletter-imagenes/' || v_ruta then
    raise exception 'La dirección pública de la imagen no es válida' using errcode = '22023', hint = 'url';
  end if;

  insert into private.newsletter_imagenes (empresa_id, producto_id, organizacion_id, imagen_id, ruta, url, actualizada_en)
  values (p_empresa, p_producto, v_org, p_imagen, v_ruta, p_url, now())
  on conflict (empresa_id, producto_id) do update
    set imagen_id = excluded.imagen_id, url = excluded.url, actualizada_en = now();
  return jsonb_build_object('ruta', v_ruta);
end;
$$;

comment on function public.registrar_imagen_newsletter(uuid, uuid, uuid, text) is
  'MSF-979: registra la copia optimizada de la imagen principal de un producto (ya subida a newsletter-imagenes). Solo Administrador; la URL debe ser https y terminar en la ruta pública exacta.';
revoke execute on function public.registrar_imagen_newsletter(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.registrar_imagen_newsletter(uuid, uuid, uuid, text) to authenticated;

-- Limpieza: borra los registros de más de N días y devuelve sus rutas; los archivos se quitan con la API de Storage (docs/newsletter.md).
create or replace function private.purgar_imagenes_newsletter(p_dias integer default 90)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rutas text[];
begin
  if p_dias is null or p_dias < 1 then
    raise exception 'purgar_imagenes_newsletter: los días deben ser un entero mayor o igual a 1' using errcode = '22023';
  end if;
  with borradas as (
    delete from private.newsletter_imagenes n
     where n.actualizada_en < now() - make_interval(days => p_dias)
    returning n.ruta)
  select coalesce(array_agg(b.ruta order by b.ruta), '{}') into v_rutas from borradas b;
  return v_rutas;
end;
$$;

comment on function private.purgar_imagenes_newsletter(integer) is
  'MSF-979: borra los registros de copias de imágenes del newsletter con más de p_dias días y devuelve sus rutas para quitar los archivos con la API de Storage. Sin agendar.';
revoke all on function private.purgar_imagenes_newsletter(integer) from public, anon, authenticated;
grant execute on function private.purgar_imagenes_newsletter(integer) to service_role;

-- Envoltorio RPC de la limpieza (`private` no está expuesto en la API): lo llama el flow o el script de limpieza con la service-role, que después borra los
-- archivos con la API de Storage (docs/newsletter.md, «Imágenes de producto en el correo»).
create or replace function public.purgar_imagenes_newsletter(p_dias integer default 90)
returns text[]
language sql
volatile
security definer
set search_path = ''
as $$ select private.purgar_imagenes_newsletter(p_dias) $$;

comment on function public.purgar_imagenes_newsletter(integer) is
  'MSF-979: envoltorio RPC de private.purgar_imagenes_newsletter. Solo service_role.';
revoke all on function public.purgar_imagenes_newsletter(integer) from public, anon, authenticated;
grant execute on function public.purgar_imagenes_newsletter(integer) to service_role;

-- Foto del contenido (MSF-979): mismo cuerpo que 20270420000300 salvo `imagen_url`, que ahora sale de la copia vigente.
create or replace function private.armar_bloques_newsletter(p_empresa uuid, p_destacados boolean, p_promociones boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 6;
  v_nombre text;
  v_dominio text;
  v_destacados jsonb := '[]'::jsonb;
  v_promociones jsonb := '[]'::jsonb;
begin
  select e.nombre, t.dominio into v_nombre, v_dominio
    from dominio.empresas e
    left join dominio.tiendas t on t.empresa_id = e.id and t.organizacion_id = e.organizacion_id
   where e.id = p_empresa;
  if v_nombre is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;

  if p_destacados then
    select coalesce(jsonb_agg(jsonb_build_object(
             'producto_id', x.producto_id, 'nombre', x.nombre, 'precio', x.precio, 'imagen_url', private.url_imagen_newsletter(p_empresa, x.producto_id),
             'url', case when v_dominio is null then null else 'https://' || v_dominio || '/producto/' || x.producto_id end)
           order by lower(x.nombre), x.producto_id), '[]'::jsonb)
      into v_destacados
      from (
        select g.producto_id, g.nombre, pv.precio
          from private.catalogo_tienda_efectivo(p_empresa) g
          cross join lateral private.precio_vigente_empresa(g.producto_id, p_empresa, now()) pv
         where g.efectivo and g.destacado and pv.precio is not null
         order by lower(g.nombre), g.producto_id
         limit c_tope
      ) x;
  end if;

  -- Promociones: solo con la bandera encendida (`promocion_vigente` también la respeta); `precio_anterior` no nulo = hay promoción vigente.
  if p_promociones and private.bandera_activa('promociones_precio') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'producto_id', x.producto_id, 'nombre', x.nombre, 'precio', x.precio_anterior, 'precio_promocional', x.precio,
             'imagen_url', private.url_imagen_newsletter(p_empresa, x.producto_id), 'hasta', x.hasta,
             'url', case when v_dominio is null then null else 'https://' || v_dominio || '/producto/' || x.producto_id end)
           order by x.hasta, lower(x.nombre), x.producto_id), '[]'::jsonb)
      into v_promociones
      from (
        select g.producto_id, g.nombre, pv.precio, pv.precio_anterior, p.hasta
          from private.catalogo_tienda_efectivo(p_empresa) g
          cross join lateral (
            select min(q.hasta) as hasta
              from dominio.promociones_precio q
             where q.empresa_id = p_empresa and q.producto_id = g.producto_id and q.anulada_at is null
               and q.desde <= now() and now() < q.hasta
          ) p
          cross join lateral private.precio_vigente_empresa(g.producto_id, p_empresa, now()) pv
         where g.efectivo and p.hasta is not null and pv.precio is not null and pv.precio_anterior is not null
         order by p.hasta, lower(g.nombre), g.producto_id
         limit c_tope
      ) x;
  end if;

  return jsonb_build_object(
    'generado_en', now(),
    'tienda', jsonb_build_object('nombre', v_nombre, 'dominio', v_dominio),
    'destacados', v_destacados,
    'promociones', v_promociones);
end;
$$;

revoke execute on function private.armar_bloques_newsletter(uuid, boolean, boolean) from public, anon, authenticated;

-- Cuerpo HTML (MSF-979): mismo cuerpo que 20270420000300 más la imagen de cada producto.
create or replace function private.cuerpo_html_newsletter(p_mensaje text, p_bloques jsonb, p_tienda text, p_enlace_baja text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_html text;
  v_item jsonb;
  v_hay boolean := false;
  v_enlace text;
begin
  v_html := '<div style="white-space: pre-wrap;">' || private.escapar_html(p_mensaje) || '</div>';

  if jsonb_array_length(coalesce(p_bloques -> 'destacados', '[]'::jsonb)) > 0 then
    v_hay := true;
    v_html := v_html || '<h2 style="font-size: 16px;">Productos destacados</h2><ul>';
    for v_item in select x from jsonb_array_elements(p_bloques -> 'destacados') x loop
      v_html := v_html || '<li>'
        || private.imagen_html_newsletter(v_item)
        || case when v_item ->> 'url' ~ '^https://' then '<a href="' || private.escapar_html(v_item ->> 'url') || '">' || private.escapar_html(v_item ->> 'nombre') || '</a>'
                else private.escapar_html(v_item ->> 'nombre') end
        || ' - $ ' || replace(to_char((v_item ->> 'precio')::numeric, 'FM999999999990.00'), '.', ',') || '</li>';
    end loop;
    v_html := v_html || '</ul>';
  end if;

  if jsonb_array_length(coalesce(p_bloques -> 'promociones', '[]'::jsonb)) > 0 then
    v_hay := true;
    v_html := v_html || '<h2 style="font-size: 16px;">Promociones vigentes</h2><ul>';
    for v_item in select x from jsonb_array_elements(p_bloques -> 'promociones') x loop
      v_html := v_html || '<li>'
        || private.imagen_html_newsletter(v_item)
        || case when v_item ->> 'url' ~ '^https://' then '<a href="' || private.escapar_html(v_item ->> 'url') || '">' || private.escapar_html(v_item ->> 'nombre') || '</a>'
                else private.escapar_html(v_item ->> 'nombre') end
        || ' - <s>$ ' || replace(to_char((v_item ->> 'precio')::numeric, 'FM999999999990.00'), '.', ',') || '</s> $ '
        || replace(to_char((v_item ->> 'precio_promocional')::numeric, 'FM999999999990.00'), '.', ',')
        || ' (hasta el ' || to_char((v_item ->> 'hasta')::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || ')</li>';
    end loop;
    v_html := v_html || '</ul>';
  end if;

  if v_hay then
    v_html := v_html || '<p style="font-size: 12px; color: #666666;">Precios al '
      || to_char((p_bloques ->> 'generado_en')::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || '.</p>';
  end if;

  v_enlace := case when p_enlace_baja ~ '^https://' then private.escapar_html(p_enlace_baja) else null end;
  v_html := v_html || '<hr><p style="font-size: 12px; color: #666666;">Recibís este correo porque te suscribiste al newsletter de '
    || private.escapar_html(p_tienda) || '. Si no querés recibirlo más, '
    || case when v_enlace is null then 'date de baja desde el enlace de tu último correo' else '<a href="' || v_enlace || '">date de baja acá</a>' end || '.</p>';
  return v_html;
end;
$$;

revoke execute on function private.cuerpo_html_newsletter(text, jsonb, text, text) from public, anon, authenticated;
