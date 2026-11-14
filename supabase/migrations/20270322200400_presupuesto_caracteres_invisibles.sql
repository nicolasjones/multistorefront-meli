-- MSF-176 · Tienda compra y cuentas, PR de cierre, H-6 de la revisión de seguridad integral (T070): se suman U+00AD (guion blando), U+180E (separador mongol) y U+2061 a U+2064
-- (operadores invisibles) a los caracteres bloqueados de la nota de `publico.crear_presupuesto_tienda`, con el mismo conjunto que `enviar_lista_pedido` (migración
-- `20270322200300`) y el front (`tiendaPedido.ts`). Misma firma y mismos grants (solo `authenticated`); el resto del cuerpo es el de `20270322100400` (cupo antes del bloque anidado incluido).
--
-- Esquemas (Principio VII): sin tablas. Migración aditiva. Reversión (migración posterior): restaurar el cuerpo de `20270322100400_presupuesto_tienda_rpc.sql`.

CREATE OR REPLACE FUNCTION publico.crear_presupuesto_tienda(host text, items jsonb, nota text, clave_envio uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan en la nota: de control (salvo el salto de línea), separadores de línea Unicode y marcas de dirección del texto.
  -- (M-4: se suman U+061C y los ceros de ancho U+200B a U+200D, U+2060 y U+FEFF; el mismo conjunto que el front, `tiendaPedido.ts`.)
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]';
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]';
  v_cuenta record;
  v_limite jsonb;
  v_nota text;
  v_campos text[] := '{}';
  v_items jsonb;
  v_previo record;
  v_hoy date := (select private.hoy_argentina());
  v_inicio_dia timestamptz;
  v_creados integer;
  v_abiertos integer;
  v_lineas jsonb;
  v_malo record;
  v_total_sin numeric;
  v_total_iva numeric;
  v_registro jsonb;
  v_numero integer;
  v_comprobante dominio.comprobantes_venta;
  v_cliente record;
  v_empresa_nombre text;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;
  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Cupo de LLAMADAS por cuenta, ANTES de validar ni calcular nada (amenaza 1.1 / S1 de B1): también cuentan las llamadas inválidas.
  v_limite := private.registrar_pedido_publico('presupuesto|' || v_cuenta.cuenta_cliente_id::text, private.limite_presupuestos_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador (M-3 de la revisión): una excepción revierte SOLO este bloque y el cupo de llamadas (arriba) sobrevive.
  begin
  -- Entradas: solo `items`, `nota` y `clave_envio`. Ninguna otra clave del jsonb se lee. La nota se recorta con espacios, tabuladores y saltos de línea (una nota solo de
  -- saltos de línea es «sin nota», no una nota vacía guardada: coherente con el CHECK de la tabla).
  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n'), E' \t\n\r'), '');
  if v_nota is not null and (length(v_nota) > 500 or v_nota ~ c_prohibidos_nota) then
    v_campos := array_append(v_campos, 'nota');
  end if;
  if clave_envio is null then
    v_campos := array_append(v_campos, 'clave_envio');
  end if;
  v_items := private.validar_items_pedido(items);
  if v_items is null then
    v_campos := array_append(v_campos, 'items');
  end if;
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Idempotencia (FR-058): repetir una clave devuelve el MISMO presupuesto, sin crear otro ni gastar cupo ni topes.
  select pt.comprobante_id, c.numero, c.fecha, c.total_con_iva into v_previo
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.clave_envio = clave_envio;
  if found then
    return jsonb_build_object('estado', 'ok', 'numero', v_previo.numero, 'fecha', v_previo.fecha, 'total_con_iva', v_previo.total_con_iva);
  end if;

  -- Lock por cuenta (FR-057): dos llamadas simultáneas de la misma cuenta se serializan; el conteo y el alta no se pisan.
  perform pg_advisory_xact_lock(hashtextextended('presupuesto|' || v_cuenta.cuenta_cliente_id::text, 0));

  -- La otra llamada pudo terminar mientras esperábamos el lock con LA MISMA clave: es una repetición, no un presupuesto nuevo.
  select pt.comprobante_id, c.numero, c.fecha, c.total_con_iva into v_previo
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.clave_envio = clave_envio;
  if found then
    return jsonb_build_object('estado', 'ok', 'numero', v_previo.numero, 'fecha', v_previo.fecha, 'total_con_iva', v_previo.total_con_iva);
  end if;

  -- Topes por cuenta (D-9, D-23): 5 creados por día (día de Buenos Aires) y 10 `pendiente` abiertos desde la tienda.
  v_inicio_dia := v_hoy::timestamp at time zone 'America/Argentina/Buenos_Aires';
  select count(*) into v_creados
    from dominio.presupuestos_tienda pt
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.creado_en >= v_inicio_dia;
  select count(*) into v_abiertos
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and c.estado = 'pendiente';
  if v_creados >= private.limite_presupuestos_por_dia() or v_abiertos >= private.limite_presupuestos_abiertos() then
    return jsonb_build_object('estado', 'limite_cuenta');
  end if;

  -- Motor: las líneas salen del servidor (precio, escala, descuento de la ficha, IVA, promoción, depósito); nada de esto viene del llamador.
  select coalesce(jsonb_agg(to_jsonb(m) order by m.orden), '[]'::jsonb) into v_lineas
    from private.motor_presupuesto_tienda(v_cuenta.cuenta_cliente_id, v_items) m;
  if jsonb_array_length(v_lineas) <> jsonb_array_length(v_items) then
    return jsonb_build_object('estado', 'error');
  end if;
  select l.producto_id, l.estado into v_malo
    from jsonb_to_recordset(v_lineas) as l(orden integer, producto_id uuid, estado text)
   where l.estado <> 'ok'
   order by (l.estado = 'no_disponible') desc, l.orden
   limit 1;
  if found then
    if v_malo.estado = 'no_disponible' then
      return jsonb_build_object('estado', 'no_disponible', 'producto_id', v_malo.producto_id);
    end if;
    return jsonb_build_object('estado', 'sin_precio', 'producto_id', v_malo.producto_id);
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lineas) as l(deposito_id uuid) where l.deposito_id is null) then
    return jsonb_build_object('estado', 'error');
  end if;
  select sum(l.subtotal_sin_iva), sum(l.iva) into v_total_sin, v_total_iva
    from jsonb_to_recordset(v_lineas) as l(subtotal_sin_iva numeric, iva numeric);
  if v_total_sin + v_total_iva >= 1000000000000 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'));
  end if;

  select cl.numero, cl.nombre into v_cliente
    from public.clientes cl where cl.id = v_cuenta.cliente_id and cl.organizacion_id = v_cuenta.organizacion_id;
  select e.nombre into v_empresa_nombre from dominio.empresas e where e.id = v_cuenta.empresa_id and e.organizacion_id = v_cuenta.organizacion_id;

  -- Sub-transacción: si CUALQUIER paso falla se revierte todo (número, comprobante, líneas, vínculo, actividad y cupo de la tienda).
  begin
    v_registro := private.registrar_envio_tienda(v_cuenta.empresa_id, 'presupuesto', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' <> 'nuevo' then
      -- Esa clave ya está registrada en la tienda por otro envío: no es una repetición de esta cuenta (eso se resolvió arriba).
      return jsonb_build_object('estado', 'error');
    end if;

    v_numero := private.siguiente_numero_comprobante_org(v_cuenta.organizacion_id, v_cuenta.empresa_id, 'presupuesto');
    insert into dominio.comprobantes_venta (
      organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
      total_sin_iva, total_con_iva, canal, operador_id, valido_hasta
    )
    values (
      v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cliente_id, 'presupuesto', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'pendiente',
      v_total_sin, v_total_sin + v_total_iva, 'tienda_online', null, null
    )
    returning * into v_comprobante;

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      descuento_pct, precio_referencia, promocion_id
    )
    select v_cuenta.organizacion_id, v_comprobante.id, l.orden, l.producto_id, l.descripcion, l.codigo, l.cantidad, l.precio_unitario, l.escala,
           false, l.alicuota_id, l.alicuota_porcentaje, l.deposito_id, l.a_pedido, l.subtotal_sin_iva, l.iva,
           l.descuento_pct, l.precio_referencia, l.promocion_id
      from jsonb_to_recordset(v_lineas) as l(
        orden integer, producto_id uuid, descripcion text, codigo text, cantidad integer, precio_unitario numeric, escala text,
        alicuota_id uuid, alicuota_porcentaje numeric, deposito_id uuid, a_pedido boolean, subtotal_sin_iva numeric, iva numeric,
        descuento_pct numeric, precio_referencia numeric, promocion_id uuid)
     order by l.orden;

    insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio, nota)
    values (v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cuenta_cliente_id, v_cuenta.cliente_id, v_comprobante.id, clave_envio, v_nota);

    -- Auditoría (FR-060): sin actor de panel; con número del presupuesto, tienda y cliente (Nº y nombre), SIN correo ni teléfono.
    perform private.insertar_actividad(
      v_cuenta.organizacion_id,
      null,
      'presupuesto.creado_desde_tienda',
      left(format('Presupuesto %s pedido desde la tienda %s por el cliente Nº %s · %s',
                  v_comprobante.numero, coalesce(v_empresa_nombre, ''), coalesce(v_cliente.numero::text, ''),
                  btrim(regexp_replace(coalesce(v_cliente.nombre, ''), c_prohibidos_linea, ' ', 'g'))), 300),
      v_cuenta.empresa_id
    );

    return jsonb_build_object('estado', 'ok', 'numero', v_comprobante.numero, 'fecha', v_comprobante.fecha, 'total_con_iva', v_comprobante.total_con_iva);
  exception when others then
    -- Rastro en el servidor solo con sqlstate: sqlerrm puede traer datos de la persona.
    raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  exception when others then
    raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;
