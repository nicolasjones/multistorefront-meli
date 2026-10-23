-- F-PRE-05 (MSF-305, épica MSF-116): aviso de cotización no cargada.
--   public.cotizacion_del_dia(): dice si hay una carga CONFIRMADA con fecha de hoy en
--     America/Argentina/Buenos_Aires (cualquier día calendario: sin calendario de feriados) y, si la
--     hay, su valor, hora y quién la cargó. La pendiente NO cuenta: solo las filas de
--     `dominio.cotizaciones` (las confirma `confirmar_cotizacion`, F-PRE-03).
-- Esquema (Principio VII): no crea tablas; lee `dominio.cotizaciones` (dominio) y se expone como RPC
-- en `public`, como el resto de la API de cotización. SECURITY INVOKER: rigen las políticas del
-- llamador (organización y `cotizacion_dolar` ≥ lectura). `anon` sin ejecución.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cotizacion_del_dia();

create or replace function public.cotizacion_del_dia()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_hoy_inicio timestamptz :=
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_carga dominio.cotizaciones;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;

  -- «Hoy» = desde la medianoche de Buenos Aires; la cota superior evita contar cargas con fecha futura.
  select c.* into v_carga
    from dominio.cotizaciones c
    where c.organizacion_id = v_organizacion
      and c.cargada_en >= v_hoy_inicio
      and c.cargada_en < v_hoy_inicio + interval '1 day'
    order by c.cargada_en desc, c.id desc
    limit 1;

  if v_carga.id is null then
    return jsonb_build_object('cargada_hoy', false, 'cargada_en', null, 'cargada_por', null, 'valor', null);
  end if;

  return jsonb_build_object(
    'cargada_hoy', true,
    'cargada_en', v_carga.cargada_en,
    'cargada_por', v_carga.cargada_por_nombre,
    'valor', v_carga.valor
  );
end;
$$;

comment on function public.cotizacion_del_dia() is
  'F-PRE-05: ¿hay una cotización CONFIRMADA hoy (America/Argentina/Buenos_Aires)? La pendiente no cuenta. 42501 sin acceso a cotizacion_dolar.';

revoke execute on function public.cotizacion_del_dia() from public, anon;
grant execute on function public.cotizacion_del_dia() to authenticated;
