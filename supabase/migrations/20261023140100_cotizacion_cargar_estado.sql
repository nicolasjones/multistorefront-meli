-- F-PRE-02 (MSF-246, épica MSF-116): RPC de carga y estado de la cotización del dólar.
--   public.cargar_cotizacion(p_valor): exige `cotizacion_dolar`=edicion, valida el valor,
--     REEMPLAZA la pendiente de la organización y devuelve valor, anterior y variación. No toca
--     precios (el recálculo es F-PRE-03).
--   public.estado_cotizacion(): vigente, productos en USD y pendiente (no vencida); exige
--     `cotizacion_dolar` ≥ lectura.
-- «Vigente» = última cotización confirmada o, mientras no haya ninguna, la cotización inicial
-- de MSF-114 (la que hoy usa `private.a_pesos`). Una pendiente con más de 24 h se trata como
-- inexistente AL CONSULTAR (expira_en > now()), sin worker.
-- Ambas son SECURITY INVOKER: rigen las políticas del llamador. `anon` sin ejecución.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.estado_cotizacion();
--   drop function public.cargar_cotizacion(numeric);

create or replace function public.cargar_cotizacion(p_valor numeric)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_anterior numeric;
  v_pendiente dominio.cotizacion_pendiente;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar la cotización del dólar' using errcode = '42501';
  end if;
  if p_valor is null or p_valor::text in ('NaN', 'Infinity', '-Infinity') or p_valor <= 0
     or p_valor <> round(p_valor, 4) then
    raise exception 'La cotización debe ser mayor a cero y tener hasta 4 decimales' using errcode = '23514';
  end if;
  if p_valor >= 10000000000 then
    raise exception 'La cotización es demasiado grande' using errcode = '22003';
  end if;

  select coalesce(
    (select c.valor from dominio.cotizaciones c
      where c.organizacion_id = v_organizacion order by c.cargada_en desc, c.id desc limit 1),
    (select i.valor from dominio.cotizacion_inicial i where i.organizacion_id = v_organizacion)
  ) into v_anterior;

  insert into dominio.cotizacion_pendiente as p (organizacion_id, valor, cargada_por)
  values (v_organizacion, p_valor, v_usuario)
  on conflict (organizacion_id) do update
    set valor = excluded.valor, cargada_por = excluded.cargada_por
  returning p.* into v_pendiente;

  return jsonb_build_object(
    'valor', v_pendiente.valor,
    'anterior', v_anterior,
    'variacion_pct', case when v_anterior is null then null else round((v_pendiente.valor / v_anterior - 1) * 100, 4) end,
    'expira_en', v_pendiente.expira_en
  );
end;
$$;

comment on function public.cargar_cotizacion(numeric) is
  'F-PRE-02: carga el dólar del día como cotización PENDIENTE (reemplaza la anterior pendiente; vence a las 24 h). No cambia precios. 42501 sin edición en cotizacion_dolar, 23514 valor inválido, 22003 fuera de rango.';

revoke execute on function public.cargar_cotizacion(numeric) from public, anon;
grant execute on function public.cargar_cotizacion(numeric) to authenticated;

create or replace function public.estado_cotizacion()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_vigente jsonb;
  v_productos integer;
  v_pendiente jsonb;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;

  select jsonb_build_object('valor', c.valor, 'cargada_en', c.cargada_en, 'cargada_por', c.cargada_por_nombre)
    into v_vigente
    from dominio.cotizaciones c
    where c.organizacion_id = v_organizacion
    order by c.cargada_en desc, c.id desc
    limit 1;

  if v_vigente is null then
    select jsonb_build_object('valor', i.valor, 'cargada_en', i.updated_at, 'cargada_por', null)
      into v_vigente
      from dominio.cotizacion_inicial i
      where i.organizacion_id = v_organizacion;
  end if;

  select count(*)::integer into v_productos
    from dominio.productos p
    where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD';

  select jsonb_build_object('valor', p.valor, 'expira_en', p.expira_en)
    into v_pendiente
    from dominio.cotizacion_pendiente p
    where p.organizacion_id = v_organizacion and p.expira_en > now();

  return jsonb_build_object('vigente', v_vigente, 'productos_usd', v_productos, 'pendiente', v_pendiente);
end;
$$;

comment on function public.estado_cotizacion() is
  'F-PRE-02: cotización vigente (última confirmada o inicial), productos activos en USD y pendiente no vencida (solo la ve quien tiene edición). 42501 sin acceso a cotizacion_dolar.';

revoke execute on function public.estado_cotizacion() from public, anon;
grant execute on function public.estado_cotizacion() to authenticated;
