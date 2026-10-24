-- F-REN-02 (MSF-221, épica MSF-120): conteo de productos con margen bajo o negativo para el aviso
-- del Resumen (FR-015). Esquema (Principio VII): función en `public` (RPC de la app).
--
-- Desvío respecto de «security invoker» (documentado): las vistas de `analitica` están cerradas para
-- `authenticated` (las lee solo el rol de Superset), así que una función invoker no podría leerlas ni
-- repetir la fórmula sin duplicarla. Es SECURITY DEFINER con la autorización explícita adentro: exige
-- la organización activa y `lectura`/`edicion` en `rentabilidad` (42501 si no) y filtra la vista por
-- esa organización, o sea el mismo alcance que RLS le da al usuario. Mismo patrón que
-- `analitica.neto_empresa`. `set search_path = ''`; sin acceso para `public` ni `anon`.
--
-- Migración aditiva. Reversión: drop function public.rentabilidad_conteo_margen();

create or replace function public.rentabilidad_conteo_margen()
returns table (con_margen_bajo integer, con_margen_negativo integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if v_organizacion is null or (select private.nivel_seccion('rentabilidad')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver Rentabilidad' using errcode = '42501';
  end if;
  return query
    select coalesce(c.con_margen_bajo, 0), coalesce(c.con_margen_negativo, 0)
      from (select 1) uno
      left join analitica.rentabilidad_consolidado c on c.organizacion_id = v_organizacion;
end;
$$;

comment on function public.rentabilidad_conteo_margen() is
  'F-REN-02: productos con margen bajo y negativo de la organización activa (misma fuente que el consolidado). 42501 sin la sección rentabilidad.';

revoke execute on function public.rentabilidad_conteo_margen() from public, anon;
grant execute on function public.rentabilidad_conteo_margen() to authenticated;
