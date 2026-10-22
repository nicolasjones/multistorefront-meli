-- MSF-322 (F-VTA-39, épica MSF-275): consulta en solo lectura de las cotizaciones del dólar
-- históricas importadas en F-VTA-37.
--
-- Esquemas (Principio VII), verificados:
--   public.listar_historial_cotizaciones  RPC de plataforma (nueva): es una función de lectura, no
--     una tabla; consulta dominio.historial_cotizaciones_dolar (dominio, F-VTA-37).
--   Sin tablas nuevas ni alteradas.
--
-- security invoker: el llamador hereda la RLS de `historial_cotizaciones_dolar` (organización y nivel
-- `lectura`/`edicion` de `ventas`); sin permiso no vuelven filas. Las cotizaciones son globales de la
-- organización: no hay `empresa_id` ni filtro de tienda.
-- Búsqueda por fecha: texto literal (se escapan \ % _) contra la fecha en `dd/mm/aaaa` y en
-- `aaaa-mm-dd`, de modo que sirve una fecha completa o una parte («03/2020», «2020-03»).
-- Orden estable: fecha desc, id. Tope 200 por página; una página fuera de rango no devuelve filas.
-- `total_filas` es el total del filtro actual.
--
-- Migración aditiva. Reversión (migración posterior, nunca en este PR):
--   drop function public.listar_historial_cotizaciones(text, integer, integer);

create or replace function public.listar_historial_cotizaciones(
  p_busqueda text default null,
  p_pagina integer default 1,
  p_tamano integer default 25
)
returns table (
  id uuid,
  fecha date,
  dolar_comprador numeric,
  dolar_vendedor numeric,
  cargado_por text,
  total_filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_busqueda, ''));
  v_patron text;
  v_tamano integer := least(greatest(coalesce(p_tamano, 25), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_texto <> '' then
    v_patron := '%' || replace(replace(replace(v_texto, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select c.id, c.fecha, c.dolar_comprador, c.dolar_vendedor, c.cargado_por,
         count(*) over () as total_filas
    from dominio.historial_cotizaciones_dolar c
   where c.organizacion_id = (select private.organizacion_id())
     and (v_patron is null
          or to_char(c.fecha, 'DD/MM/YYYY') like v_patron
          or to_char(c.fecha, 'YYYY-MM-DD') like v_patron)
   order by c.fecha desc, c.id
   limit v_tamano
  offset (v_pagina - 1) * v_tamano;
end;
$$;

comment on function public.listar_historial_cotizaciones(text, integer, integer) is
  'Cotizaciones del dólar históricas paginadas (F-VTA-39). Globales por organización, solo lectura; rige la RLS de dominio.historial_cotizaciones_dolar.';

revoke execute on function public.listar_historial_cotizaciones(text, integer, integer) from public, anon;
grant execute on function public.listar_historial_cotizaciones(text, integer, integer) to authenticated;
