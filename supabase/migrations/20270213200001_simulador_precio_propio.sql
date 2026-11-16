-- MSF-427 · F-PRE-09 (épica MSF-352, spec 20270105-100000-configuracion-dolar-y-precio-propio, FR-021…FR-023):
-- simulador «Así quedan los precios» con el precio propio.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla. Se reemplaza una función de SOLO
-- LECTURA en `public` (`previsualizar_precios_empresa`), que lee `dominio.productos` y, vía las funciones
-- `private.*`, `dominio.precios_propios_empresa`. No escribe nada (FR-023): guardar la regla sigue siendo
-- `guardar_regla_precio_empresa` (MSF-114).
--
-- Qué cambia respecto de 20261022140200:
--   * Suma la columna de salida `precio_propio boolean` (la entrada conserva su firma ⇒ no es BREAKING para quien
--     ya la lee). Una fila con precio propio muestra ESE valor (ya en pesos; USD × cotización de la empresa) y NO se
--     mueve con el ajuste (FR-024); sin precio propio, la regla de siempre.
--   * El precio central se convierte con la cotización de la EMPRESA cuando tiene una propia (F-PRE-06), igual que
--     `public.precios_empresa_neto`. Antes usaba la de la organización y el simulador podía mostrar un central distinto
--     del que cobra la tienda.
--   * Seguridad: igual que antes (security invoker, `search_path` vacío, `42501` sin acceso a Empresas, `anon` sin
--     ejecución). `private.precio_propio_empresa` ya acota por la organización de la sesión.
--
-- Migración aditiva (la firma de entrada no cambia; se vuelve a crear porque cambia el tipo de retorno).
-- Reversión (migración posterior): restaurar `public.previsualizar_precios_empresa(uuid, text, numeric, integer)` a su
-- cuerpo de 20261022140200 (sin `precio_propio` y con el central de la organización).

drop function if exists public.previsualizar_precios_empresa(uuid, text, numeric, integer);

create or replace function public.previsualizar_precios_empresa(
  p_empresa uuid,
  p_base text,
  p_ajuste_pct numeric default 0,
  p_muestra integer default 6
)
returns table (
  producto_id uuid,
  nombre text,
  sku text,
  moneda text,
  central_ars numeric,
  neto_ars numeric,
  final_ars numeric,
  precio_propio boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_ajuste numeric;
begin
  if v_organizacion is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver los precios de la empresa' using errcode = '42501';
  end if;
  if p_base is null or p_base not in ('central', 'central_ajuste') then
    raise exception 'Elegí una base de precio válida' using errcode = '23514';
  end if;
  v_ajuste := case when p_base = 'central' then 0 else p_ajuste_pct end;
  if v_ajuste is null or v_ajuste <= -100 or v_ajuste <> round(v_ajuste, 3) then
    raise exception 'El ajuste debe ser mayor a −100 %% y tener hasta 3 decimales' using errcode = '23514';
  end if;
  if abs(v_ajuste) >= 10000 then
    raise exception 'El ajuste es demasiado grande' using errcode = '22003';
  end if;
  if not exists (
    select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_organizacion
  ) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;

  -- La muestra se recorta ANTES de calcular nada: primero se ordena y limita (barato, solo columnas de la tabla) y
  -- recién sobre esas filas se resuelven la conversión, el precio propio y el IVA. Con un catálogo grande, cada
  -- cambio del ajuste cuesta como mucho `p_muestra` evaluaciones, no una por producto de la organización.
  return query
  select m.id, m.nombre, m.sku, m.moneda, x.central,
         case when pp.moneda is not null then pp.neto_ars
              else private.aplicar_regla_precio(x.central, p_base, v_ajuste, 10) end,
         private.aplicar_iva(
           case when pp.moneda is not null then pp.neto_ars
                else private.aplicar_regla_precio(x.central, p_base, v_ajuste, 10) end,
           al.porcentaje, coalesce(al.exento, false)),
         (pp.moneda is not null)
    from (
      select p.id, p.nombre, p.sku, p.moneda, p.precio_lista, p.organizacion_id
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
       order by lower(p.nombre), p.id
       limit least(greatest(coalesce(p_muestra, 6), 1), 20)
    ) m
    cross join lateral (
      select private.a_pesos(m.precio_lista, m.moneda, m.organizacion_id, p_empresa) as central
    ) x
    left join lateral private.precio_propio_empresa(m.id, p_empresa) pp on true
    left join lateral private.alicuota_producto(m.id) al on true
   order by lower(m.nombre), m.id;
end;
$$;

comment on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) is
  'F-PRE-07/F-PRE-09/F-PRE-12: neto y final de una muestra de productos con una regla sin guardar; las filas con precio propio muestran ese valor fijo y vienen marcadas (precio_propio). No escribe. 42501 sin sección empresas, 23514 inválido, P0002 empresa inexistente.';

revoke execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) from public, anon;
grant execute on function public.previsualizar_precios_empresa(uuid, text, numeric, integer) to authenticated;
