-- F-INI-07 (MSF-823, épica MSF-824, spec 20270305-100000-inicio-tablero-completo, FR-019):
-- vista previa del impacto del dólar de SOLO LECTURA: recibe el valor y devuelve lo mismo que
-- `public.previsualizar_cotizacion` (variación contra la cotización aplicada, si recalcula, impacto por
-- tienda y muestra de precios «hoy» / «nuevo»), pero sin exigir ni escribir la cotización pendiente.
--
-- Esquema (Principio VII): función en `public`; SIN tablas nuevas. Reutiliza `private.cotizacion_config`,
-- `private.cotizacion_para`, `private.precios_usd_por_empresa` y `private.precio_visible_con_cotizacion`
-- (la misma lógica que la confirmación, para que lo que se ve sea lo que se aplica).
-- Aislamiento: `SECURITY DEFINER` con la autorización adentro (sección `cotizacion_dolar` = edición, como
-- `previsualizar_cotizacion`); valor nulo, ≤ 0, NaN, infinito, con más de 4 decimales o ≥ 1e10 = 22023; `anon` no ejecuta. No escribe nada.
--
-- Migración aditiva. Reversión: drop function public.previsualizar_impacto_dolar(numeric,uuid);

create or replace function public.previsualizar_impacto_dolar(p_valor numeric, p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
  v_empresa uuid;
  v_vigente numeric;
  v_variacion numeric;
  v_recalcula boolean;
  v_empresas jsonb;
  v_muestra jsonb;
begin
  if v_organizacion is null or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de la cotización' using errcode = '42501';
  end if;
  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  -- Mismo criterio que `cargar_cotizacion` (lo que la vista previa acepta es lo que luego se puede cargar):
  -- mayor a cero, sin NaN ni infinito, hasta 4 decimales y menor a 1e10 (evita números gigantes en la respuesta).
  if p_valor is null or p_valor::text in ('NaN', 'Infinity', '-Infinity') or p_valor <= 0
     or p_valor <> round(p_valor, 4) or p_valor >= 10000000000 then
    raise exception 'El valor del dólar no es válido' using errcode = '22023';
  end if;

  -- Contra la cotización APLICADA, la misma que decide `confirmar_cotizacion` (MSF-352).
  v_vigente := private.cotizacion_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((p_valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ umbral.
  v_recalcula := v_vigente is null or abs(p_valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u
   where v_empresa is null or u.empresa_id = v_empresa;

  -- Muestra: productos que alguna empresa del alcance calcula en USD (el producto en USD sin precio propio en pesos, o
  -- cualquier producto con precio propio en USD). «Nuevo» convierte con la cotización pendiente; un precio propio en
  -- pesos no cambia y un producto en ARS no se multiplica por el dólar.
  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', case when p.moneda = 'USD' then p.precio_lista end,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'usd', case when x.moneda is not null then case when x.moneda = 'USD' then x.importe end
                                      when p.moneda = 'USD' then p.precio_lista end,
                          'hoy', private.precio_visible_con_redondeo(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                                   p.id, e.id, v_config.redondeo_pesos),
                          'nuevo', private.precio_visible_con_cotizacion(
                                   case p.moneda when 'USD' then round(p.precio_lista * p_valor, 2) else p.precio_lista end,
                                   p.id, e.id, v_config.redondeo_pesos, p_valor)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                   left join dominio.precios_propios_empresa x
                     on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
                  where e.organizacion_id = p.organizacion_id and e.activa
                    and (v_empresa is null or e.id = v_empresa)
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
         and exists (
           select 1 from dominio.empresas e
             left join dominio.precios_propios_empresa x
               on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
            where e.organizacion_id = p.organizacion_id and e.activa
              and (v_empresa is null or e.id = v_empresa)
              and coalesce(x.moneda, p.moneda) = 'USD')
       order by lower(p.nombre), p.id
       limit 6
    ) m;

  return jsonb_build_object(
    'variacion_pct', v_variacion,
    'recalcula', v_recalcula,
    'empresas', v_empresas,
    'muestra', v_muestra,
    'umbral_pct', v_config.umbral_pct,
    'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.previsualizar_impacto_dolar(numeric, uuid) is
  'F-INI-07: impacto de un valor de dólar (variación, umbral, precios por tienda y muestra hoy/nuevo) sin escribir la cotización pendiente. 42501 sin edición de cotizacion_dolar; 22023 con valor inválido.';

revoke execute on function public.previsualizar_impacto_dolar(numeric, uuid) from public, anon;
grant execute on function public.previsualizar_impacto_dolar(numeric, uuid) to authenticated;
