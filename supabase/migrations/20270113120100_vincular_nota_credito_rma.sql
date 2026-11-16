-- F-VTA-30 (MSF-320, épica MSF-178, FR-021): `public.vincular_nota_credito_rma`, resuelve una devolución con nota de crédito.
--
-- Esquema (Principio VII): sin tablas nuevas. Actualiza `dominio.rma` (dominio) y, vía `public.emitir_nota_credito`
-- (F-VTA-11), escribe el comprobante de la nota; el evento va a `public.registro_actividad` (plataforma).
--
-- `p_tipo`: `devolucion_importe` (`p_lineas` = un elemento `{importe_sin_iva}` y `p_concepto` obligatorio) o
-- `devolucion_productos` (`p_lineas` = `{linea_id, cantidad}`; si viene vacío o nulo se usan los ítems del RMA).
-- La emisión la hace `public.emitir_nota_credito` sin reimplementarla (topes, numeración, stock de la nota, evento propio).
--
-- Reglas:
--   · Exige la acción `emitir_nota_credito` de `ventas` EN LA EMPRESA del RMA (`private.puede_accion_comprobante`).
--   · Idempotente: si el RMA ya tiene nota, la devuelve sin emitir otra (un reintento tras una respuesta perdida).
--   · Exclusión: un RMA ya resuelto con reingreso de stock no admite nota (55000); evita devolver dos veces la mercadería.
--   · El RMA se toma `for update`: dos pedidos simultáneos se serializan y el segundo ve la nota del primero.
--   · Todo en una transacción: nota + vínculo + cierre + evento `rma.nota_credito_vinculada`; si la nota falla (tope,
--     concepto, factura anulada) no queda nada a medias.
--
-- Seguridad: `security definer`, `search_path = ''`; organización y actor salen de la sesión. `revoke … from public, anon`
-- y `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato inválido · 55000 ya resuelta con stock · P0001 tope (de la nota).
--
-- Migración aditiva. Reversión (migración posterior; las notas emitidas no se deshacen solas):
--   drop function public.vincular_nota_credito_rma(uuid, text, jsonb, text);

create or replace function public.vincular_nota_credito_rma(
  p_rma_id uuid,
  p_tipo text,
  p_lineas jsonb default null,
  p_concepto text default null
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rma dominio.rma;
  v_nota dominio.comprobantes_venta;
  v_lineas jsonb := p_lineas;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para resolver devoluciones' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('devolucion_importe', 'devolucion_productos') then
    raise exception 'Elegí si la nota devuelve importe o productos' using errcode = '22023', hint = 'tipo';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_rma_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'P0002';
  end if;
  if not (select private.puede_accion_comprobante(v_rma.empresa_id, 'emitir_nota_credito')) then
    raise exception 'Tu rol no puede emitir notas de crédito en esta tienda' using errcode = '42501';
  end if;

  if v_rma.nota_credito_id is not null then
    return v_rma;
  end if;
  if v_rma.stock_reingresado_en is not null then
    raise exception 'La devolución ya se resolvió con reingreso de stock' using errcode = '55000';
  end if;

  if p_tipo = 'devolucion_productos' and (v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0) then
    select jsonb_agg(jsonb_build_object('linea_id', i.comprobante_linea_id, 'cantidad', i.cantidad) order by i.comprobante_linea_id)
      into v_lineas
      from dominio.rma_items i
     where i.rma_id = v_rma.id and i.organizacion_id = v_org;
  end if;

  v_nota := public.emitir_nota_credito(v_rma.comprobante_id, p_tipo, v_lineas, p_concepto);

  update dominio.rma
     set nota_credito_id = v_nota.id, estado = 'cerrado', actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.nota_credito_vinculada',
    format('Vinculó la nota de crédito %s a la devolución %s', v_nota.numero, v_rma.numero),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

revoke execute on function public.vincular_nota_credito_rma(uuid, text, jsonb, text) from public, anon;
grant execute on function public.vincular_nota_credito_rma(uuid, text, jsonb, text) to authenticated;

comment on function public.vincular_nota_credito_rma(uuid, text, jsonb, text) is
  'Resuelve una devolución con una nota de crédito (reutiliza emitir_nota_credito), la vincula, cierra el RMA y deja evento; idempotente (F-VTA-30, FR-021). Exige la acción emitir_nota_credito en la tienda del RMA.';
