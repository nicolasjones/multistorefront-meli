-- F-CAT-09 (MSF-360, épica MSF-202, FR-005): valores de «Compatible con» que alimentan el selector del filtro.
-- Esquemas (Principio VII): sin tablas nuevas; función en `public` (contrato de lectura para la app) que
-- lee `dominio.productos`. Solo lectura, `security definer` con organización y permiso tomados de la sesión
-- (lectura en Productos), sin `anon`.
-- Devuelve los valores DISTINTOS tal como están guardados (sin normalizar mayúsculas: el cliente agrupa sin
-- distinguirlas y filtra con todas las variantes), ordenados y sin vacíos.
-- REVERSIÓN: `drop function public.listar_compatibles();`

create or replace function public.listar_compatibles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(v.valor order by lower(v.valor), v.valor collate "C"), '{}'::text[])
    from (
      select distinct c as valor
        from dominio.productos p, unnest(p.compatible_con) as c
       where p.organizacion_id = (select private.organizacion_id())
         and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
         and btrim(c) <> ''
    ) v;
$$;

comment on function public.listar_compatibles() is
  'F-CAT-09: valores distintos de «Compatible con» de la organización de la sesión (ordenados, sin vacíos). Solo lectura; exige lectura en Productos.';

revoke execute on function public.listar_compatibles() from public, anon;
grant execute on function public.listar_compatibles() to authenticated;
