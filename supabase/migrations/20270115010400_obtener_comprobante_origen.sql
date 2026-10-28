-- F-SVC-13 (MSF-418, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-007):
-- `public.obtener_comprobante` expone el origen del comprobante.
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `dominio` (comprobantes, reparaciones, líneas).
--
-- Cambio ADITIVO sobre 20261203200300 (misma firma, mismos permisos): la salida suma `origen_tipo`, `origen_id`
-- y `origen_numero` (código «R-000N» de la reparación, o null), y cada línea suma `sin_stock`. El depósito de las
-- líneas pasa a `left join` para que una línea sin depósito (sin_stock) siga apareciendo. Los campos vigentes no
-- cambian. `origen_numero` solo sale con `service_tecnico` en lectura o más (sin ese permiso es null; el
-- origen_tipo/origen_id sí salen). El enlace al detalle de Service lo decide la pantalla según el permiso en `service_tecnico`.
--
-- Migración aditiva. Reversión (migración posterior): restaurar el cuerpo de 20261203200300.

create or replace function public.obtener_comprobante(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_resultado jsonb;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', v_c.id,
    'tipo', v_c.tipo,
    'numero', v_c.numero,
    'estado', v_c.estado,
    'empresa_id', v_c.empresa_id,
    'empresa', e.nombre,
    'cliente', jsonb_build_object(
      'id', cl.id,
      'nombre', cl.nombre,
      'documento', cl.documento,
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), ''),
      'tipo', cl.tipo,
      'es_consumidor_final', cl.es_consumidor_final
    ),
    'canal', v_c.canal,
    'fecha', v_c.fecha,
    'valido_hasta', v_c.valido_hasta,
    'operador_id', v_c.operador_id,
    'operador', coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), 'Usuario sin nombre'),
    'forma_pago_id', v_c.forma_pago_id,
    'envio_id', v_c.envio_id,
    'origen_tipo', v_c.origen_tipo,
    'origen_id', v_c.origen_id,
    'origen_numero', case when v_c.origen_tipo = 'reparacion'
        and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion') then (
      select private.codigo_reparacion(r.numero) from dominio.reparaciones r
       where r.id = v_c.origen_id and r.organizacion_id = v_org) end,
    'lineas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'orden', l.orden,
          'producto_id', l.producto_id,
          'descripcion', l.descripcion,
          'codigo', l.codigo,
          'cantidad', l.cantidad,
          'precio_unitario', l.precio_unitario,
          'escala', l.escala,
          'precio_manual', l.precio_manual,
          'alicuota_porcentaje', l.alicuota_porcentaje,
          'deposito_id', l.deposito_id,
          'deposito', d.nombre,
          'a_pedido', l.a_pedido,
          'sin_stock', l.sin_stock,
          'stock', coalesce(x.cantidad, 0),
          'reservado', coalesce(x.reservado, 0),
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'iva', l.iva
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      left join dominio.existencias_deposito x
        on x.producto_id = l.producto_id and x.deposito_id = l.deposito_id and x.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb),
    'total_sin_iva', v_c.total_sin_iva,
    'iva', v_c.total_con_iva - v_c.total_sin_iva,
    'total_con_iva', v_c.total_con_iva,
    'editable', ((v_c.tipo = 'factura' and v_c.estado = 'borrador') or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')),
    'puede_editar', v_nivel = 'edicion',
    'puede_editar_precio', v_nivel = 'edicion' and (select private.puede_editar_precio_en_empresa(v_c.empresa_id)),
    'updated_at', v_c.updated_at
  )
  into v_resultado
  from dominio.empresas e
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_org
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id;

  return v_resultado;
end;
$$;

-- Mismos permisos que la versión vigente (20261203200300): solo `authenticated` la ejecuta.
revoke execute on function public.obtener_comprobante(uuid) from public, anon;
grant execute on function public.obtener_comprobante(uuid) to authenticated;

comment on function public.obtener_comprobante(uuid) is
  'F-SVC-13: además de los datos del comprobante, expone el origen (origen_tipo, origen_id, origen_numero «R-000N») y la marca sin_stock de cada línea. Cambio aditivo.';
