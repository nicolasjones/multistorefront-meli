-- MSF-825 (MSF-828): los nombres de producto de la demo salían con el prefijo «&ua» («&ua ADAPTADOR HDMI A
-- DVI 24+1 (3010)»), y la descripción repetía el nombre con el mismo prefijo. Es un resto de una
-- exportación de un sistema anterior: «&» seguido de una o más de u, U, a, k o «+» (&ua, &uu, &u+, &+,
-- &u++, &uk, &ua+…) y luego un espacio o directamente una mayúscula, un dígito o «(» («&uaCONSOLA»); o «&»
-- seguido de un espacio. Un nombre real que empiece con «&» y letras minúsculas («&ultra Cable») o con «&» pegado
-- a una palabra («&Kids») NO se toca. En dev afectaba a 2.174 de los productos.
--
-- Corrección en el ORIGEN, en el único punto por el que pasa toda escritura de productos (la importación, el
-- alta y la edición): el disparador `productos_normalizar` quita ese prefijo del nombre y de la descripción.
-- Un nombre que fuera SOLO el prefijo se conserva tal cual (no se vacía). Una entidad HTML al principio
-- («&amp; Co») no es un prefijo y no se toca.
-- Además se limpia lo ya cargado: el UPDATE vuelve a escribir cada fila afectada y el disparador hace el
-- resto (también se registra en la actividad del producto, como cualquier edición). Es idempotente.
-- En el front, la tienda pública además limpia al mostrar (apps/web/src/lib/tiendaTextos.ts), para no depender
-- de la carga.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla.
-- Reversión: el dato anterior no se conserva (era basura de importación); para volver al disparador previo,
-- reaplicar private.normalizar_producto() de 20261017120100_catalogo_productos_y_costos.sql.

create or replace function private.quitar_prefijo_importacion(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when p_texto is null then null
           when p_texto ~ '^&[A-Za-z0-9#]+;' then p_texto
           else coalesce(nullif(btrim(regexp_replace(p_texto, '^&(?:(?:[ua+k]+|U\+[ua+k]*)(?:\s+|(?=[A-Z0-9(]))|\s+)', '')), ''), p_texto)
         end;
$$;

revoke execute on function private.quitar_prefijo_importacion(text) from public, anon, authenticated;

create or replace function private.normalizar_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := private.quitar_prefijo_importacion(btrim(new.nombre));
  if new.nombre = '' then
    raise exception 'El nombre del producto no puede estar vacío' using errcode = '23514';
  end if;
  new.sku := nullif(btrim(new.sku), '');
  new.descripcion := nullif(btrim(private.quitar_prefijo_importacion(new.descripcion)), '');
  if exists (select 1 from unnest(new.compatible_con) as c(x) where length(btrim(c.x)) > 100) then
    raise exception 'Cada valor de compatible_con admite hasta 100 caracteres' using errcode = '22023';
  end if;
  new.compatible_con := coalesce(
    (select array_agg(s.v order by s.o)
       from (select btrim(t.x) as v, min(t.n) as o
               from unnest(new.compatible_con) with ordinality as t(x, n)
              where btrim(t.x) <> ''
              group by btrim(t.x)) s),
    '{}'
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Limpieza de lo ya cargado (el disparador normaliza al reescribir cada fila).
update dominio.productos
   set nombre = nombre
 where (nombre ~ '^&' and nombre !~ '^&[A-Za-z0-9#]+;')
    or (descripcion ~ '^&' and descripcion !~ '^&[A-Za-z0-9#]+;');
