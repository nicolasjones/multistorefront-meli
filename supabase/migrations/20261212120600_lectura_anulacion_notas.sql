-- F-VTA-11 (MSF-377, épica MSF-177, FR-042, FR-045 y FR-046): `public.detalle_anulacion_nota_credito`, la lectura que
-- necesita el detalle del comprobante para ofrecer «Anular» y «Nota de crédito», mostrar la anulación y listar las
-- notas asociadas. Evita redefinir `obtener_comprobante` (cabecera y líneas de MSF-159): es una lectura aparte.
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `dominio.comprobantes_venta` y sus líneas (`dominio`).
--
-- Seguridad: `security definer` de lectura (`stable`), `search_path = ''`; la organización sale de la sesión. Exige
-- `ventas` en `lectura` o `edicion` EN LA EMPRESA del comprobante, igual que `obtener_comprobante`. Los indicadores
-- `puede_anular` y `puede_emitir_nota_credito` solo deciden qué se ofrece: la autoridad sigue siendo
-- `anular_comprobante` y `emitir_nota_credito`. `revoke … from public, anon` y `grant execute … to authenticated`.
--
-- Devuelve (jsonb):
--   puede_anular, puede_emitir_nota_credito  ·  anulacion {cuando, quien, motivo} | null
--   acreditable_sin_iva                      ·  lineas_acreditables [{linea_id, orden, descripcion, cantidad, devuelta,
--                                               disponible, precio_unitario, deposito}] (solo facturas)
--   notas [{id, numero, nc_tipo, concepto, fecha, total_sin_iva, total_con_iva, lineas [{orden, descripcion, cantidad,
--           precio_unitario, subtotal_sin_iva, iva}]}] (positivos: el signo lo pone la pantalla)
--
-- Errores: 42501 sin sesión o sin ver la tienda · P0002 no existe.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.detalle_anulacion_nota_credito(uuid);

create or replace function public.detalle_anulacion_nota_credito(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_resta numeric(14, 2);
  v_tiene_notas boolean;
  v_operativa boolean;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select v_c.total_sin_iva - coalesce(sum(n.total_sin_iva), 0), count(*) > 0
    into v_resta, v_tiene_notas
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito';
  v_operativa := v_c.tipo = 'factura' and v_c.estado not in ('borrador', 'anulada');

  return jsonb_build_object(
    'puede_anular', v_operativa and v_c.estado <> 'cobrado' and not v_tiene_notas
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'anular')),
    'puede_emitir_nota_credito', v_operativa and v_resta > 0
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')),
    'anulacion', case when v_c.anulado_en is null then null else jsonb_build_object(
      'cuando', v_c.anulado_en,
      'quien', coalesce((
        select nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
          from public.perfiles_usuario p where p.user_id = v_c.anulado_por), 'Usuario sin nombre'),
      'motivo', v_c.motivo_anulacion
    ) end,
    'acreditable_sin_iva', case when v_c.tipo = 'factura' then v_resta else 0 end,
    'lineas_acreditables', case when v_c.tipo <> 'factura' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'linea_id', l.id,
        'orden', l.orden,
        'descripcion', l.descripcion,
        'cantidad', l.cantidad,
        'devuelta', d.devuelta,
        'disponible', l.cantidad - d.devuelta,
        'precio_unitario', l.precio_unitario,
        'deposito', dep.nombre
      ) order by l.orden)
      from dominio.comprobantes_venta_lineas l
      join dominio.depositos dep on dep.id = l.deposito_id and dep.organizacion_id = l.organizacion_id
      cross join lateral (
        select coalesce(sum(nl.cantidad), 0)::integer as devuelta
          from dominio.comprobantes_venta_lineas nl
          join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.organizacion_id = nl.organizacion_id
         where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id
           and n.nc_tipo = 'devolucion_productos' and nl.orden = l.orden
      ) d
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb) end,
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'numero', n.numero,
        'nc_tipo', n.nc_tipo,
        'concepto', n.nc_concepto,
        'fecha', n.fecha,
        'total_sin_iva', n.total_sin_iva,
        'total_con_iva', n.total_con_iva,
        'lineas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'orden', nl.orden,
            'descripcion', nl.descripcion,
            'cantidad', nl.cantidad,
            'precio_unitario', nl.precio_unitario,
            'subtotal_sin_iva', nl.subtotal_sin_iva,
            'iva', nl.iva
          ) order by nl.orden)
          from dominio.comprobantes_venta_lineas nl
          where nl.comprobante_id = n.id and nl.organizacion_id = v_org
        ), '[]'::jsonb)
      ) order by n.numero_entero)
      from dominio.comprobantes_venta n
      where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.detalle_anulacion_nota_credito(uuid) from public, anon;
grant execute on function public.detalle_anulacion_nota_credito(uuid) to authenticated;

comment on function public.detalle_anulacion_nota_credito(uuid) is
  'Anulación, notas de crédito asociadas, líneas acreditables y qué acciones se ofrecen para un comprobante (F-VTA-11, FR-042/FR-045/FR-046). Exige ventas en lectura o edición en su empresa.';
