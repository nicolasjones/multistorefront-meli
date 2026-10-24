-- F-VTA-06 (MSF-295, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-010, FR-011, FR-013,
-- FR-014, FR-015, FR-016): `guardar_lineas_comprobante` y `obtener_comprobante` con líneas.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta_lineas` y los totales de
-- `dominio.comprobantes_venta` (dominio) y, por `private.registrar_actividad`, `public.registro_actividad`.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización sale de la sesión, nunca de un argumento.
-- Exige `ventas` en `edicion` EN LA EMPRESA del comprobante. El precio NUNCA lo manda el cliente: se calcula
-- con `private.precio_para`; `precio_manual` solo vale con `puede_accion('ventas','editar_precio')` (o si es el
-- mismo precio manual que la línea ya tenía guardada, para que un re-guardado no lo pierda).
-- `revoke ... from public, anon` y `grant execute ... to authenticated` explícitos.
--
-- Escala (FR-014; Decisiones abiertas 8, pendiente del cliente): el tipo de cliente define qué lista aplica y
-- la cantidad total de la línea elige la escala. Minorista (y Consumidor final) = x1 siempre; mayorista =
-- x1 de 1 a 4, x5 de 5 a 9, x10 de 10 a 49 y x50 desde 50 (rangos de `apps/web/src/lib/escalas.ts`). La regla
-- vive solo en `private.escala_para_linea`: cambiarla no requiere migrar datos.
--
-- Cambio en `private.precio_para` (F-PRE-15): su compuerta pedía la sección `empresas` (solo Administrador),
-- con lo que ningún rol de ventas podía cotizar. Ahora también acepta `ventas` en lectura o edición; el
-- cuerpo y la firma no cambian. La función sigue sin ser invocable desde la API (esquema `private`).
--
-- Errores: 42501 permiso · 22023 dato inválido (mensaje en castellano, `hint` = campo) · P0002 no existe ·
-- 55000 documento cerrado · 40001 conflicto de edición (bloqueo optimista por `updated_at`).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz);
--   drop function private.escala_para_linea(text, integer);
--   restaurar public.obtener_comprobante(uuid) de 20261024100400_comprobantes_rpc.sql y
--     private.precio_para(uuid, uuid, text) de 20261022150100_precio_para.sql.

-- ============================================================================
-- private.precio_para: la compuerta acepta también ventas (lectura o edición)
-- ============================================================================
create or replace function private.precio_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;
  if (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion')
     and (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    return;
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.alicuota_id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  cross join lateral (
    select
      case when s.precio is not null then p_escala else 'x1' end as usada,
      private.aplicar_regla_precio(
        private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id),
        coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
      ) as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
end;
$$;

comment on function private.precio_para(uuid, uuid, text) is
  'F-PRE-15: neto, alícuota y final de un producto para una empresa y una escala (x1/x5/x10/x50). Escala sin precio → lista (escala_usada = x1); escala inexistente → 22023. No consulta tipos_cliente. F-VTA-06: la compuerta acepta empresas o ventas (lectura o edición).';

-- ============================================================================
-- private.escala_para_linea: única regla de escala por tipo de cliente y cantidad
-- ============================================================================
create or replace function private.escala_para_linea(p_tipo_cliente text, p_cantidad integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tipo_cliente is distinct from 'mayorista' then 'x1'
    when p_cantidad >= 50 then 'x50'
    when p_cantidad >= 10 then 'x10'
    when p_cantidad >= 5 then 'x5'
    else 'x1'
  end;
$$;

comment on function private.escala_para_linea(text, integer) is
  'F-VTA-06: escala de precio de una línea. Minorista = x1; mayorista = x1 (1-4), x5 (5-9), x10 (10-49), x50 (50 o más). Pendiente del cliente (Decisiones abiertas 8).';

revoke execute on function private.escala_para_linea(text, integer) from public, anon, authenticated;

-- ============================================================================
-- guardar_lineas_comprobante (FR-010, FR-011, FR-013…FR-016)
-- p_lineas: [{"producto_id": uuid, "cantidad": int, "deposito_id": uuid|null, "precio_manual": number|null}]
-- Reemplaza TODAS las líneas del documento en una transacción y recalcula sus totales.
-- ============================================================================
create or replace function public.guardar_lineas_comprobante(
  p_id uuid,
  p_lineas jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_tipo_cliente text;
  v_defecto uuid;
  v_puede_precio boolean;
  v_previas jsonb;
  v_elem jsonb;
  v_orden integer := 0;
  v_texto text;
  v_producto dominio.productos;
  v_cantidad integer;
  v_deposito uuid;
  v_manual numeric;
  v_precio record;
  v_unitario numeric;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas deben ser una lista' using errcode = '22023', hint = 'lineas';
  end if;
  if jsonb_array_length(p_lineas) > 200 then
    raise exception 'Un comprobante admite hasta 200 líneas' using errcode = '22023', hint = 'lineas';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if not ((v_c.tipo = 'factura' and v_c.estado = 'borrador')
       or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = '40001';
  end if;

  select cl.tipo into v_tipo_cliente
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
  select d.id into v_defecto
    from dominio.depositos d
   where d.organizacion_id = v_org and d.por_defecto and d.activo;
  v_puede_precio := (select private.puede_accion('ventas', 'editar_precio'));

  -- Precios manuales ya guardados: un re-guardado sin permiso no puede perderlos ni cambiarlos.
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', l.producto_id, 'precio', l.precio_unitario)), '[]'::jsonb)
    into v_previas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.precio_manual;

  delete from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id;

  for v_elem in select e.value from jsonb_array_elements(p_lineas) as e(value) loop
    v_orden := v_orden + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'La línea % no es válida', v_orden using errcode = '22023', hint = 'lineas';
    end if;

    -- Producto: de la organización y activo (FR-011).
    v_texto := v_elem ->> 'producto_id';
    begin
      select * into v_producto
        from dominio.productos p
       where p.id = v_texto::uuid and p.organizacion_id = v_org and p.activo;
    exception when invalid_text_representation then
      raise exception 'La línea % tiene un producto inválido', v_orden using errcode = '22023', hint = 'producto_id';
    end;
    if not found then
      raise exception 'La línea % tiene un producto que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;

    -- Cantidad entera mayor a cero (FR-011).
    v_texto := v_elem ->> 'cantidad';
    if v_texto is null or v_texto !~ '^[0-9]{1,7}$' or v_texto::integer < 1 then
      raise exception 'La cantidad de la línea % debe ser un entero mayor a cero', v_orden
        using errcode = '22023', hint = 'cantidad';
    end if;
    v_cantidad := v_texto::integer;

    -- Depósito de salida (FR-011, FR-013): de la organización y activo; sin elegir, el principal.
    v_texto := v_elem ->> 'deposito_id';
    if v_texto is null then
      v_deposito := v_defecto;
    else
      begin
        v_deposito := v_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'La línea % tiene un depósito inválido', v_orden using errcode = '22023', hint = 'deposito_id';
      end;
    end if;
    if v_deposito is null or not exists (
      select 1 from dominio.depositos d where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      raise exception 'La línea % tiene un depósito que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;

    -- Precio manual (FR-016): número >= 0, solo con permiso o si ya estaba guardado igual.
    v_manual := null;
    if v_elem ? 'precio_manual' and jsonb_typeof(v_elem -> 'precio_manual') <> 'null' then
      if jsonb_typeof(v_elem -> 'precio_manual') <> 'number' then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      v_manual := round((v_elem ->> 'precio_manual')::numeric, 2);
      if v_manual < 0 or v_manual >= 1000000000000 then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      if not v_puede_precio and not exists (
        select 1 from jsonb_array_elements(v_previas) q
         where (q.value ->> 'producto_id')::uuid = v_producto.id and (q.value ->> 'precio')::numeric = v_manual
      ) then
        raise exception 'Tu rol no puede editar precios' using errcode = '42501', hint = 'precio_manual';
      end if;
    end if;

    -- Precio, escala e IVA (FR-014, FR-015): los calcula el servidor.
    select * into v_precio
      from private.precio_para(v_producto.id, v_c.empresa_id, private.escala_para_linea(v_tipo_cliente, v_cantidad));
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := coalesce(v_manual, round(v_precio.neto, 2));
    if v_unitario is null then
      raise exception 'El producto de la línea % no tiene precio en pesos (falta la cotización del dólar)', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_cantidad, 2);
    if v_subtotal >= 1000000000000 then
      raise exception 'El importe de la línea % es demasiado grande', v_orden using errcode = '22023', hint = 'cantidad';
    end if;
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva
    )
    values (
      v_org, v_c.id, v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva
    );

    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  if v_total_sin + v_total_iva >= 1000000000000 then
    raise exception 'El total del comprobante es demasiado grande' using errcode = '22023', hint = 'lineas';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Actualizó las líneas de %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) to authenticated;

comment on function public.guardar_lineas_comprobante(uuid, jsonb, timestamptz) is
  'Reemplaza las líneas de un comprobante editable en una transacción y recalcula subtotal, IVA y total (F-VTA-06). Precio y escala los calcula private.precio_para; precio_manual exige editar_precio. Contrato en docs/ventas-comprobantes.md.';

-- ============================================================================
-- obtener_comprobante: ahora devuelve las líneas (con depósito, stock y reservado) y puede_editar_precio.
-- Mismo cuerpo que 20261024100400; cambian solo 'lineas' y la clave nueva.
-- ============================================================================
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
          'stock', coalesce(x.cantidad, 0),
          'reservado', coalesce(x.reservado, 0),
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'iva', l.iva
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      left join dominio.existencias_deposito x
        on x.producto_id = l.producto_id and x.deposito_id = l.deposito_id and x.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb),
    'total_sin_iva', v_c.total_sin_iva,
    'iva', v_c.total_con_iva - v_c.total_sin_iva,
    'total_con_iva', v_c.total_con_iva,
    'editable', ((v_c.tipo = 'factura' and v_c.estado = 'borrador') or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')),
    'puede_editar', v_nivel = 'edicion',
    'puede_editar_precio', v_nivel = 'edicion' and (select private.puede_accion('ventas', 'editar_precio')),
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

revoke execute on function public.obtener_comprobante(uuid) from public, anon;
grant execute on function public.obtener_comprobante(uuid) to authenticated;

comment on function public.obtener_comprobante(uuid) is
  'Cabecera, cliente, líneas (con depósito, stock y reservado) y totales de un comprobante; exige ventas en lectura o edición en su empresa (F-VTA-05/F-VTA-06).';
