-- F-PRE-03 (MSF-267, épica MSF-116) · FR-009: vista previa de impacto de la cotización pendiente.
-- Esquema (Principio VII): sin tablas nuevas. Funciones privadas en `private` y una RPC de lectura
-- en `public` que no almacena datos.
--
--   private.cotizacion_vigente(org)           última cotización confirmada o, sin ninguna, la inicial.
--   private.precios_usd_por_empresa(org)      por empresa activa: cantidad de precios en USD visibles
--                                             (productos activos en USD; el precio se calcula al leer).
--   private.precio_visible_desde_central(...) precio que ve el cliente: regla de la empresa sobre el
--                                             central en pesos, con IVA si la empresa lo muestra
--                                             (reusa `aplicar_regla_precio` y `aplicar_iva`).
--   public.previsualizar_cotizacion()         sobre la pendiente vigente: por empresa, cantidad de
--                                             precios y una muestra «hoy / nuevo». SOLO LEE.
--
-- `previsualizar_cotizacion` es SECURITY DEFINER: la regla de cada empresa vive bajo la sección
-- `empresas`, y un rol con edición en `cotizacion_dolar` pero sin esa sección vería una vista previa
-- vacía o engañosa. Verifica `edicion` y filtra por la organización de la sesión dentro de la función;
-- no escribe nada. `anon` sin ejecución.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.previsualizar_cotizacion();
--   drop function private.precio_visible_desde_central(numeric, uuid, uuid);
--   drop function private.precios_usd_por_empresa(uuid);
--   drop function private.cotizacion_vigente(uuid);

create or replace function private.cotizacion_vigente(p_organizacion uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select c.valor from dominio.cotizaciones c
      where c.organizacion_id = p_organizacion order by c.cargada_en desc, c.id desc limit 1),
    (select i.valor from dominio.cotizacion_inicial i where i.organizacion_id = p_organizacion)
  );
$$;

comment on function private.cotizacion_vigente(uuid) is
  'F-PRE-03: cotización contra la que se mide la variación (última confirmada o la inicial); null si no hay ninguna.';

create or replace function private.precios_usd_por_empresa(p_organizacion uuid)
returns table (empresa_id uuid, nombre text, precios integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.nombre,
         (select count(*)::integer from dominio.productos p
           where p.organizacion_id = p_organizacion and p.activo and p.moneda = 'USD')
    from dominio.empresas e
   where e.organizacion_id = p_organizacion and e.activa
   order by lower(e.nombre), e.id;
$$;

comment on function private.precios_usd_por_empresa(uuid) is
  'F-PRE-03: por empresa activa, cuántos precios en USD se calculan con la cotización (productos activos en USD).';

create or replace function private.precio_visible_desde_central(p_central numeric, p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(r.mostrar_con_iva, false)
      then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
    else x.neto
  end
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  cross join lateral (
    select private.aplicar_regla_precio(
      p_central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
    ) as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
$$;

comment on function private.precio_visible_desde_central(numeric, uuid, uuid) is
  'F-PRE-03: precio que ve el cliente de un producto en una empresa, partiendo de un central en pesos dado (regla de la empresa + IVA si lo muestra).';

create or replace function public.previsualizar_cotizacion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_recalcula boolean;
  v_empresas jsonb;
  v_muestra jsonb;
begin
  if v_organizacion is null or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de la cotización' using errcode = '42501';
  end if;

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.expira_en > now();
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  v_vigente := private.cotizacion_vigente(v_organizacion);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ 1 %.
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u;

  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', p.precio_lista,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'hoy', private.precio_visible_desde_central(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id), p.id, e.id),
                          'nuevo', private.precio_visible_desde_central(
                                   round(p.precio_lista * v_pendiente.valor, 2), p.id, e.id)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                  where e.organizacion_id = p.organizacion_id and e.activa
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD'
       order by lower(p.nombre), p.id
       limit 6
    ) m;

  return jsonb_build_object(
    'variacion_pct', v_variacion,
    'recalcula', v_recalcula,
    'empresas', v_empresas,
    'muestra', v_muestra
  );
end;
$$;

comment on function public.previsualizar_cotizacion() is
  'F-PRE-03: vista previa de la cotización pendiente (precios por empresa y muestra hoy/nuevo, redondeo según la regla de cada empresa). No escribe. 42501 sin edición en cotizacion_dolar, P0002 sin_cotizacion_pendiente.';

revoke execute on function private.cotizacion_vigente(uuid) from public, anon, authenticated;
revoke execute on function private.precios_usd_por_empresa(uuid) from public, anon, authenticated;
revoke execute on function private.precio_visible_desde_central(numeric, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.previsualizar_cotizacion() from public, anon;
grant execute on function public.previsualizar_cotizacion() to authenticated;
