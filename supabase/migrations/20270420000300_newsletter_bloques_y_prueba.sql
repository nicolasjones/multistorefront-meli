-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 4 · T020/T024b: foto del contenido, vista previa y prueba.
-- RF-NL-15, RF-NL-16, RF-NL-24; D10, D13, D18. NO envía a suscriptores: la prueba va solo al correo del autor.
--
-- Esquemas (Principio VII): solo funciones. `private.armar_bloques_newsletter` (interna: lee `dominio.productos_tienda` por
-- `private.catalogo_tienda_efectivo`, `dominio.promociones_precio` y los precios públicos de la tienda); RPC del panel en `public`;
-- escribe `dominio.correo_masivo_pruebas` (dominio, columnas de 20270420000000).
--
-- La foto (`bloques`) usa el MISMO precio público que la tienda (`private.precio_vigente_empresa`) y respeta la bandera `promociones_precio`.
-- Sin imágenes: el bucket de productos es privado y un correo no puede llevar una URL firmada de larga vida; `imagen_url` queda nulo
-- (pendiente de decisión de Nicolás: bucket público o URL firmada larga). Todo texto se escapa al renderizar (panel y flow).
-- Invariante MSF-967: la cantidad de destinatarios cuenta SOLO `estado = 'confirmado'`.
--
-- Aditiva e idempotente. Reversión (migración posterior):
--   drop function public.solicitar_prueba_newsletter(uuid, text, text, boolean, boolean),
--     public.vista_previa_newsletter(uuid, boolean, boolean), private.armar_bloques_newsletter(uuid, boolean, boolean);
--   delete from public.tipos_evento_actividad where tipo = 'newsletter.prueba'  -- solo si no quedan eventos

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
             'producto_id', x.producto_id, 'nombre', x.nombre, 'precio', x.precio, 'imagen_url', null,
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
             'imagen_url', null, 'hasta', x.hasta,
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

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('newsletter.prueba', false, 'Prueba de newsletter enviada al propio correo del autor (sin correo ni texto)')
on conflict (tipo) do nothing;

-- RF-NL-15 · vista previa: la misma foto que el envío y la cantidad real de destinatarios (solo `confirmado`, MSF-967).
create or replace function public.vista_previa_newsletter(p_empresa uuid, p_destacados boolean, p_promociones boolean)
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
  return jsonb_build_object(
    'bloques', v_bloques,
    'confirmados', (select count(*)::int from dominio.newsletter_suscriptores s
                     where s.organizacion_id = v_org and s.empresa_id = p_empresa and s.estado = 'confirmado'),
    'generado_en', v_bloques -> 'generado_en');
end;
$$;

-- RF-NL-16, D18 · prueba al correo del autor, con el contenido real y el tope de 5 por hora y persona (compartido con MSF-155).
create or replace function public.solicitar_prueba_newsletter(
  p_empresa uuid,
  p_asunto text,
  p_mensaje text,
  p_destacados boolean,
  p_promociones boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.exigir_admin_newsletter(p_empresa);
  v_actor uuid := (select auth.uid());
  v_correo text;
begin
  if p_empresa is null then
    raise exception 'La tienda no existe' using errcode = 'P0002';
  end if;
  if not private.bandera_activa('newsletter') then
    raise exception 'El newsletter no está habilitado en este entorno' using errcode = '55000';
  end if;
  perform private.validar_redaccion_correo_masivo(p_asunto, p_mensaje);
  if p_destacados is null or p_promociones is null then
    raise exception 'Falta indicar las secciones del newsletter' using errcode = '22023';
  end if;

  select nullif(btrim(u.email::text), '') into v_correo from auth.users u where u.id = v_actor;
  if v_correo is null then
    raise exception 'Tu usuario no tiene un correo para recibir la prueba' using errcode = '22023', hint = 'sin_correo';
  end if;

  -- Mismo cerrojo y tope que `solicitar_prueba_correo_masivo`: la prueba no sirve para inundar el buzón.
  perform pg_advisory_xact_lock(hashtextextended('prueba_correo_masivo:' || v_actor::text, 0));
  if (select count(*) from dominio.correo_masivo_pruebas p
       where p.organizacion_id = v_org and p.solicitado_por = v_actor and p.creada_en > now() - interval '1 hour') >= 5 then
    raise exception 'Ya pediste varias pruebas en la última hora. Probá de nuevo en un rato.' using errcode = '22023', hint = 'limite';
  end if;

  insert into dominio.correo_masivo_pruebas (organizacion_id, solicitado_por, correo, asunto, mensaje, bloques, empresa_id)
  values (v_org, v_actor, v_correo, btrim(p_asunto), p_mensaje, private.armar_bloques_newsletter(p_empresa, p_destacados, p_promociones), p_empresa);
  perform private.insertar_actividad(v_org, v_actor, 'newsletter.prueba', 'Pidió una prueba de newsletter', p_empresa);
  return jsonb_build_object('ok', true);
end;
$$;

comment on function private.armar_bloques_newsletter(uuid, boolean, boolean) is 'MSF-468 (RF-NL-15, D13): foto del contenido (destacados y promociones vigentes, hasta 6 cada una) con el precio público de la tienda.';
comment on function public.vista_previa_newsletter(uuid, boolean, boolean) is 'MSF-468 (RF-NL-15): foto del contenido y cantidad de suscriptores confirmados de la tienda; Administrador.';
comment on function public.solicitar_prueba_newsletter(uuid, text, text, boolean, boolean) is 'MSF-468 (RF-NL-16, D18): deja una prueba al correo del autor; Administrador; tope 5 por hora; 55000 con la bandera apagada.';

revoke execute on function public.vista_previa_newsletter(uuid, boolean, boolean) from public, anon;
revoke execute on function public.solicitar_prueba_newsletter(uuid, text, text, boolean, boolean) from public, anon;
grant execute on function public.vista_previa_newsletter(uuid, boolean, boolean) to authenticated;
grant execute on function public.solicitar_prueba_newsletter(uuid, text, text, boolean, boolean) to authenticated;
