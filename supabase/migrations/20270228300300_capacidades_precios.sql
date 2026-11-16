-- MSF-363 (decisiones 14 y 15): lo que la pantalla necesita saber para ocultar o deshabilitar con motivo.
--
-- `public.capacidades_precios()` devuelve, para la sesión, un objeto:
--   promociones                       bandera `promociones_precio` encendida
--   precios_masivos                   bandera `precios_masivos` encendida
--   edicion_en_todas_las_tiendas      `productos` en edición en todas las tiendas activas de la organización (regla de precios masivos)
--   niveles_productos                 { empresa_id: edicion|lectura|ninguno } de las tiendas accesibles (para `puedeEditar`
--                                     por tienda en Promociones)
-- Solo informa a la UI; la autoridad son las RPC y RLS. Sin sesión u organización devuelve todo apagado/vacío.
--
-- Esquema (Principio VII): sin tablas nuevas. RPC en `public`, security definer, `search_path = ''`.
-- Migración aditiva. Reversión (migración posterior): drop function public.capacidades_precios();

create or replace function public.capacidades_precios()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or (select private.organizacion_id()) is null then
      jsonb_build_object('promociones', false, 'precios_masivos', false,
                         'edicion_en_todas_las_tiendas', false, 'niveles_productos', '{}'::jsonb)
    else jsonb_build_object(
      'promociones', (select private.bandera_activa('promociones_precio')),
      'precios_masivos', (select private.bandera_activa('precios_masivos')),
      'edicion_en_todas_las_tiendas', (select private.productos_edicion_en_todas_las_tiendas()),
      'niveles_productos', coalesce((
        select jsonb_object_agg(e.id::text, private.nivel_productos_en_empresa(e.id))
          from dominio.empresas e
         where e.organizacion_id = (select private.organizacion_id())
           and e.id in (select private.empresas_accesibles())
      ), '{}'::jsonb))
  end;
$$;

comment on function public.capacidades_precios() is
  'MSF-363: banderas de promociones y precios masivos, si la persona edita productos en todas sus tiendas y su nivel de productos por tienda. Solo para decidir qué muestra la pantalla.';

revoke execute on function public.capacidades_precios() from public, anon;
grant execute on function public.capacidades_precios() to authenticated;
