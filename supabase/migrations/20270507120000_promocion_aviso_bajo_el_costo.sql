-- MSF-958 (seguimiento de MSF-934, S3 de la épica MSF-816): `public.guardar_promocion_precio` AVISA, sin bloquear, cuando el
-- precio promocional cargado está por debajo del costo del producto, y solo a quien puede ver el costo.
--
-- Decisiones (de producto, tomadas en este lote):
--   * AVISAR, no bloquear: el repo ya tolera vender bajo el costo con el precio normal (la pantalla Rentabilidad avisa y no
--     bloquea) y las liquidaciones son un uso legítimo de las promociones. La RPC sigue guardando igual.
--   * A quién se le informa: solo a quien tiene la sección `rentabilidad` en `lectura` o `edicion` (la misma condición de
--     la RLS de `dominio.producto_costos`). Quien edita promociones sin ver el costo NO recibe el aviso: si lo recibiera,
--     sabría que el costo es mayor que su precio y podría acotarlo por tanteos. Sin permiso la respuesta es idéntica a la
--     de antes (sin claves nuevas), así que tampoco se distingue «sin permiso» de «sin costo» o «por encima del costo».
--   * Sin umbral por organización (no se inventa): el aviso es «precio promocional < costo». Un umbral de margen
--     (como `dominio.rentabilidad_config.umbral_margen_bajo`) queda como mejora si negocio lo pide.
--
-- Qué cambia: `private.promocion_con_aviso(promocion jsonb, empresa, producto, precio)` (misma firma, `security definer`,
-- `search_path` vacío, mismo revoke) suma, cuando corresponde, `aviso_costo_codigo = 'promocion_bajo_el_costo'` y
-- `aviso_costo` (texto). Las claves `aviso_codigo`/`aviso` de MSF-936 (no menor al precio normal) no cambian y pueden
-- aparecer juntas con las nuevas. El costo se convierte a pesos con `private.a_pesos` (cotización de la empresa), igual
-- que el costo que se guarda en la línea de venta, y se compara con el precio promocional NETO (el mismo neto que
-- compara el margen realizado y `analitica.ventas_con_promocion.unidades_bajo_costo`). Sin costo cargado, o USD sin
-- cotización, no hay aviso. `public.guardar_promocion_precio` NO cambia (ya llama a esta función en sus cuatro retornos).
--
-- Migración aditiva (`create or replace` de una función de cálculo; sin tablas ni RLS nuevas).
-- Reversión (migración posterior): recrear `private.promocion_con_aviso` con el cuerpo de
-- 20270433000000_promocion_precio_no_menor_al_normal.sql.

create or replace function private.promocion_con_aviso(p_promocion jsonb, p_empresa uuid, p_producto uuid, p_precio numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resultado jsonb := p_promocion;
  v_organizacion uuid := (select private.organizacion_id());
  v_costo numeric;
begin
  -- MSF-936: el precio promocional (visto como el cliente) no es menor al precio normal de la tienda.
  if private.precio_con_iva_visible(p_producto, p_empresa, p_precio)
     >= private.precio_final_publico(p_producto, p_empresa) then
    v_resultado := v_resultado || jsonb_build_object(
      'aviso_codigo', 'promocion_no_menor_al_normal',
      'aviso', 'El precio promocional no es menor al precio normal de la tienda: se guardó, pero no se aplicará mientras no lo baje.');
  end if;

  -- MSF-958: precio por debajo del costo, solo para quien puede ver el costo (misma condición que la RLS de producto_costos).
  if v_organizacion is not null
     and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion') then
    select private.a_pesos(k.costo, p.moneda, v_organizacion, p_empresa) into v_costo
      from dominio.productos p
      join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
     where p.id = p_producto and p.organizacion_id = v_organizacion;
    if v_costo is not null and p_precio < v_costo then
      v_resultado := v_resultado || jsonb_build_object(
        'aviso_costo_codigo', 'promocion_bajo_el_costo',
        'aviso_costo', 'El precio promocional está por debajo del costo del producto: se guardó igual (no se bloquea).');
    end if;
  end if;

  return v_resultado;
end;
$$;

revoke execute on function private.promocion_con_aviso(jsonb, uuid, uuid, numeric) from public, anon, authenticated;

comment on function private.promocion_con_aviso(jsonb, uuid, uuid, numeric) is
  'MSF-936/MSF-958: agrega avisos al resultado de guardar_promocion_precio sin bloquear: aviso_codigo/aviso cuando el precio promocional (visto como el cliente) no es menor al precio normal de la tienda; aviso_costo_codigo/aviso_costo cuando el precio neto es menor al costo en pesos, solo para quien tiene la sección rentabilidad en lectura o edición. Sin avisos devuelve la promoción tal cual.';
