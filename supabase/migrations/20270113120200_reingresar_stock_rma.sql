-- F-VTA-30 (MSF-320, épica MSF-178, FR-022): `public.reingresar_stock_rma`, resuelve una devolución devolviendo los ítems al stock.
--
-- Esquema (Principio VII): sin tablas nuevas. Actualiza `dominio.rma` (dominio); el stock lo escribe
-- `public.registrar_movimiento_stock` (MSF-136, `dominio.movimientos_stock` / `existencias`) y el evento va a
-- `public.registro_actividad` (plataforma).
--
-- Una **entrada** por ítem del RMA, al depósito de origen de su línea del comprobante o, si `p_deposito_id` viene, a ese
-- depósito. Motivo de sistema «Devolución» (`private.motivo_sistema_movimiento`) y nota = número del RMA (ya trae el
-- prefijo: `RMA-0001`), de modo que el libro de movimientos dice de qué devolución viene cada entrada.
--
-- Reglas:
--   · Exige `ventas` en `edicion` EN LA EMPRESA del RMA. El movimiento lo valida además `registrar_movimiento_stock`, que
--     exige `stock` en `edicion`: sin ese permiso la función falla (42501) y no queda nada a medias.
--   · Idempotente: si el RMA ya tiene el reingreso (`stock_reingresado_en`), lo devuelve sin duplicar movimientos.
--   · Exclusión: un RMA ya resuelto con nota de crédito no admite reingreso (55000); evita devolver dos veces la mercadería.
--   · El RMA se toma `for update`: dos pedidos simultáneos se serializan. Todo en una transacción: movimientos + marca +
--     cierre + evento `rma.stock_reingresado`.
--   · Una entrada nunca deja el stock negativo (la suma solo aumenta).
--
-- Seguridad: `security definer`, `search_path = ''`; organización y actor salen de la sesión. `revoke … from public, anon`
-- y `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 depósito/motivo inválido (de `registrar_movimiento_stock`) · 55000 ya
-- resuelta con nota.
--
-- Migración aditiva. Reversión (migración posterior; los movimientos del libro son inmutables):
--   drop function public.reingresar_stock_rma(uuid, uuid);

create or replace function public.reingresar_stock_rma(
  p_rma_id uuid,
  p_deposito_id uuid default null
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
  v_motivo uuid;
  v_item record;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para resolver devoluciones' using errcode = '42501';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_rma_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rma.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede reingresar stock de devoluciones en esta tienda' using errcode = '42501';
  end if;

  if v_rma.stock_reingresado_en is not null then
    return v_rma;
  end if;
  if v_rma.nota_credito_id is not null then
    raise exception 'La devolución ya se resolvió con una nota de crédito' using errcode = '55000';
  end if;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Devolución', 'entrada');

  for v_item in
    select i.producto_id, i.cantidad, l.deposito_id
      from dominio.rma_items i
      join dominio.comprobantes_venta_lineas l on l.id = i.comprobante_linea_id and l.organizacion_id = i.organizacion_id
     where i.rma_id = v_rma.id and i.organizacion_id = v_org
     order by i.producto_id, l.deposito_id, l.orden
  loop
    perform public.registrar_movimiento_stock(
      v_item.producto_id, 'entrada', v_item.cantidad, v_motivo, v_rma.numero, current_date,
      coalesce(p_deposito_id, v_item.deposito_id)
    );
  end loop;

  update dominio.rma
     set stock_reingresado_en = clock_timestamp(), estado = 'cerrado', actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.stock_reingresado',
    format('Reingresó al stock los ítems de la devolución %s', v_rma.numero),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

revoke execute on function public.reingresar_stock_rma(uuid, uuid) from public, anon;
grant execute on function public.reingresar_stock_rma(uuid, uuid) to authenticated;

comment on function public.reingresar_stock_rma(uuid, uuid) is
  'Resuelve una devolución reingresando sus ítems al stock (reutiliza registrar_movimiento_stock, motivo Devolución), cierra el RMA y deja evento; idempotente (F-VTA-30, FR-022). Exige ventas en edición en la tienda del RMA.';
