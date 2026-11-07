-- F-PRE-08 (MSF-423, épica MSF-352) · FR-014, FR-015: el precio propio entra al cálculo del neto.
--   private.precio_propio_empresa(producto, empresa, cotizacion)  precio propio de un producto en una empresa, ya en pesos.
--   private.precio_neto_empresa                                    devuelve el precio propio si existe.
--   public.precios_empresa_neto                                    ídem + columna `precio_propio boolean` (al final).
--   private.precio_visible_con_cotizacion(...)                     nuevo; lo de `precio_visible_con_redondeo` con una
--                                                                  cotización opcional para las vistas previas.
--   private.precio_visible_con_redondeo / precio_visible_desde_central   pasan a ser envoltorios.
--   private.precios_usd_por_empresa                                cuenta los precios que dependen del dólar por empresa.
--   public.previsualizar_cotizacion(p_empresa)                     «hoy / nuevo» respeta el precio propio.
--
-- Regla (FR-014): con precio propio, neto = precio propio (reemplaza a «central + ajuste»: sin ajuste ni redondeo
-- de la regla); el IVA de la empresa se aplica encima sin cambios. Sin precio propio el resultado es idéntico.
-- FR-015: un precio propio en USD se convierte con `private.cotizacion_para(org, empresa)` (la de la empresa con
-- alcance «empresa», la general con «sistema») × importe, a 2 decimales; sin cotización el neto es NULL (no se
-- inventa ni se cae a la regla). Como los precios se calculan al leer, al confirmar un dólar nuevo se recalculan solos.
--
-- Seguridad: `precio_propio_empresa` es SECURITY DEFINER para que quien ve precios por la sección `empresas` (la vista)
-- o por `productos` obtenga el mismo precio aunque no pueda leer la tabla por RLS (mismo criterio que
-- `alicuota_producto`). Con sesión queda acotada a la organización del llamador; sin sesión (`auth.uid()` nulo:
-- el envoltorio SECURITY DEFINER de analítica) no filtra por organización porque la clave es (producto, empresa).
--
-- FR-020: el precio propio no genera cola ni columna de Mercado Libre (ver 20270205110201).
-- `precio_para` (escalas x5/x10/x50, F-PRE-15) no se toca aquí: no está entre los caminos de lectura de FR-014.
--
-- Migración aditiva (create or replace; la vista solo suma una columna al final). Reversión (migración posterior):
--   restaurar private.precio_neto_empresa y public.precios_empresa_neto a su cuerpo de 20270122100100;
--   restaurar private.precio_visible_con_redondeo a su cuerpo de 20270122100150 y private.precios_usd_por_empresa a
--   su cuerpo de 20261023140200; restaurar public.previsualizar_cotizacion(uuid) a su cuerpo de 20270122100200;
--   drop function private.precio_visible_con_cotizacion(numeric, uuid, uuid, integer, numeric);
--   drop function private.precio_propio_empresa(uuid, uuid, numeric);

create or replace function private.precio_propio_empresa(p_producto uuid, p_empresa uuid, p_cotizacion numeric default null)
returns table (moneda text, importe numeric, neto_ars numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select x.moneda, x.importe,
         case x.moneda
           when 'ARS' then x.importe
           else round(x.importe * coalesce(p_cotizacion, private.cotizacion_para(x.organizacion_id, x.empresa_id)), 2)
         end
    from dominio.precios_propios_empresa x
   where x.producto_id = p_producto
     and x.empresa_id = p_empresa
     and ((select auth.uid()) is null or x.organizacion_id = (select private.organizacion_id()));
$$;

comment on function private.precio_propio_empresa(uuid, uuid, numeric) is
  'F-PRE-08: precio propio de un producto en una empresa, ya en pesos (ARS tal cual; USD × cotización de la empresa o la dada; sin cotización → neto_ars null). Sin filas si no hay precio propio. Acotada a la organización del llamador.';

revoke execute on function private.precio_propio_empresa(uuid, uuid, numeric) from public, anon;
grant execute on function private.precio_propio_empresa(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Neto por empresa
-- ---------------------------------------------------------------------------

create or replace function private.precio_neto_empresa(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
           when pp.moneda is not null then pp.neto_ars
           else private.aplicar_regla_precio(
                  private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                  coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
                )
         end
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join lateral private.precio_propio_empresa(p.id, e.id) pp on true
  where p.id = p_producto;
$$;

comment on function private.precio_neto_empresa(uuid, uuid) is
  'F-PRE-07/F-PRE-06/F-PRE-08: precio neto (sin IVA, en pesos) de un producto para una empresa: su precio propio si lo tiene (USD con la cotización de la empresa); si no, la regla de la empresa sobre el central. null si USD sin cotización o empresa ajena.';

create or replace view public.precios_empresa_neto
with (security_invoker = true)
as
select
  p.id as producto_id,
  e.id as empresa_id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.moneda,
  x.central as central_ars,
  case
    when pp.moneda is not null then pp.neto_ars
    else private.aplicar_regla_precio(
           x.central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
         )
  end as neto_ars,
  (pp.moneda is not null) as precio_propio
from dominio.productos p
join dominio.empresas e on e.organizacion_id = p.organizacion_id
left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
cross join lateral (select private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id) as central) x
left join lateral private.precio_propio_empresa(p.id, e.id) pp on true
where (select private.nivel_seccion('empresas')) in ('lectura', 'edicion');

comment on view public.precios_empresa_neto is
  'F-PRE-07/F-PRE-06/F-PRE-08: central y neto en pesos (sin IVA) por producto y empresa, con la cotización de la empresa según el alcance; `precio_propio` indica que el neto es el precio propio. Solo con la sección empresas.';

-- ---------------------------------------------------------------------------
-- Precio que ve el cliente (vistas previas)
-- ---------------------------------------------------------------------------

create or replace function private.precio_visible_con_cotizacion(
  p_central numeric, p_producto uuid, p_empresa uuid, p_redondeo integer, p_cotizacion numeric
)
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
  left join lateral private.precio_propio_empresa(p.id, e.id, p_cotizacion) pp on true
  cross join lateral (
    select case
      when pp.moneda is not null then pp.neto_ars
      else private.aplicar_regla_precio(
             p_central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(p_redondeo, r.redondeo_pesos, 10)
           )
    end as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
$$;

comment on function private.precio_visible_con_cotizacion(numeric, uuid, uuid, integer, numeric) is
  'F-PRE-08: precio que ve el cliente partiendo de un central en pesos; el precio propio de la empresa (USD con la cotización dada, o la de la empresa si es nula) reemplaza al calculado; el redondeo opcional pisa el de la regla.';

revoke execute on function private.precio_visible_con_cotizacion(numeric, uuid, uuid, integer, numeric)
  from public, anon, authenticated;

create or replace function private.precio_visible_con_redondeo(
  p_central numeric, p_producto uuid, p_empresa uuid, p_redondeo integer
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select private.precio_visible_con_cotizacion(p_central, p_producto, p_empresa, p_redondeo, null);
$$;

comment on function private.precio_visible_con_redondeo(numeric, uuid, uuid, integer) is
  'F-PRE-06/F-PRE-08: precio que ve el cliente partiendo de un central en pesos (respeta el precio propio con la cotización de la empresa). Envoltorio de private.precio_visible_con_cotizacion.';

-- ---------------------------------------------------------------------------
-- Cuántos precios dependen del dólar, por empresa
-- ---------------------------------------------------------------------------

create or replace function private.precios_usd_por_empresa(p_organizacion uuid)
returns table (empresa_id uuid, nombre text, precios integer)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Con precio propio manda su moneda; sin él, la del producto.
  select e.id, e.nombre,
         (select count(*)::integer from dominio.productos p
            left join dominio.precios_propios_empresa x
              on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
           where p.organizacion_id = p_organizacion and p.activo
             and coalesce(x.moneda, p.moneda) = 'USD')
    from dominio.empresas e
   where e.organizacion_id = p_organizacion and e.activa
   order by lower(e.nombre), e.id;
$$;

comment on function private.precios_usd_por_empresa(uuid) is
  'F-PRE-03/F-PRE-08: por empresa activa, cuántos precios se calculan con la cotización (productos activos en USD sin precio propio en pesos, más los precios propios en USD).';

-- ---------------------------------------------------------------------------
-- Vista previa de la cotización: «hoy / nuevo» respeta el precio propio (USD con la cotización pendiente)
-- ---------------------------------------------------------------------------

create or replace function public.previsualizar_cotizacion(p_empresa uuid default null)
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
  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now();
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  v_vigente := private.cotizacion_vigente_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ umbral.
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u
   where v_empresa is null or u.empresa_id = v_empresa;

  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', p.precio_lista,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'hoy', private.precio_visible_con_redondeo(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                                   p.id, e.id, v_config.redondeo_pesos),
                          'nuevo', private.precio_visible_con_cotizacion(
                                   round(p.precio_lista * v_pendiente.valor, 2), p.id, e.id, v_config.redondeo_pesos,
                                   v_pendiente.valor)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                  where e.organizacion_id = p.organizacion_id and e.activa
                    and (v_empresa is null or e.id = v_empresa)
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
    'muestra', v_muestra,
    'umbral_pct', v_config.umbral_pct,
    'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.previsualizar_cotizacion(uuid) is
  'F-PRE-03/F-PRE-06/F-PRE-08: vista previa de la cotización pendiente (de la organización o de p_empresa): precios por empresa y muestra hoy/nuevo con el redondeo configurado, respetando el precio propio (los de USD pasan a la cotización pendiente); el umbral es el configurado. No escribe. 42501 sin edición en cotizacion_dolar, P0002 sin_cotizacion_pendiente o empresa ajena, 22023 falta empresa.';
