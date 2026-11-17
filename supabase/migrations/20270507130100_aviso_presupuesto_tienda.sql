-- MSF-940 · Aviso por correo al equipo cuando un cliente pide presupuesto desde la tienda (FR-063; seguimiento de MSF-176, historia B2).
--
-- Hoy un presupuesto de la tienda solo deja un evento de Actividad. Esta migración lo avisa por correo, por la cola de plataforma (`private.emitir_aviso`, MSF-562/MSF-319).
--
-- Esquemas (Principio VII): sin tablas. Una fila nueva en `public.tipos_aviso` (catálogo de plataforma), una función `private` nueva y `publico.crear_presupuesto_tienda` redefinida.
--
-- Destinatarios: el tipo nuevo `presupuesto_tienda_nuevo` es de la sección `ventas` (quien ve Ventas › Presupuestos) y se emite con el alcance de la EMPRESA del presupuesto: reciben
-- el aviso las personas activas de la organización con correo, con acceso a ventas y a esa empresa, que no apagaron el aviso en /cuenta/avisos; es la misma mecánica, agrupación y
-- preferencias que el aviso de consultas. Decisión: no se reutiliza la sección `consultas` (alguien con Consultas y sin Ventas no debe recibir totales de presupuestos).
-- El asunto sale del NOMBRE del tipo («Aviso: Presupuesto nuevo desde la tienda»): nunca lleva datos del cliente. El cuerpo (flow `enviar-avisos`, valores escapados) lleva Empresa
-- (tienda), Presupuesto (número), Cliente («Nº n · nombre», sin correo ni teléfono) y Total (con IVA). La nota del cliente NO se incluye.
--
-- No bloquea ni falla la creación: `private.emitir_aviso_presupuesto_tienda` va en un bloque con `exception when others` (solo `sqlstate` al registro) y se invoca como ÚLTIMO paso de
-- la sub-transacción de alta, después de todos los topes y cupos existentes (cupo de llamadas por cuenta, topes de 5 por día y 10 abiertos, cupo por hora de la tienda). Una repetición
-- idempotente (misma `clave_envio`) sale antes y no emite otro aviso. Como la cola agrupa por destinatario y tipo en una ventana, una ráfaga (máximo 5 por cuenta y día) llega en un
-- solo correo. Multi-tenant: la organización y la empresa salen del propio comprobante (verificado contra el vínculo `dominio.presupuestos_tienda`); `emitir_aviso` rechaza una empresa
-- ajena a la organización y filtra los destinatarios por organización.
--
-- `publico.crear_presupuesto_tienda`: cuerpo vigente (`20270348000300`) más UNA llamada al aviso; misma firma, mismos grants.
-- Migración aditiva. Reversión (migración posterior): recrear `publico.crear_presupuesto_tienda` con el cuerpo de `20270348000300_tienda_precios_lista_cliente.sql`,
-- `drop function private.emitir_aviso_presupuesto_tienda(uuid)` y, si no quedan avisos ni preferencias del tipo, `delete from public.tipos_aviso where clave = 'presupuesto_tienda_nuevo'`.

insert into public.tipos_aviso (clave, nombre, seccion) values
  ('presupuesto_tienda_nuevo', 'Presupuesto nuevo desde la tienda', 'ventas')
on conflict (clave) do nothing;

create or replace function private.emitir_aviso_presupuesto_tienda(p_comprobante_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mismo conjunto que usa el evento de Actividad: controles, separadores de línea y marcas de dirección fuera de los valores del correo.
  c_prohibidos constant text := '[\u0001-\u001f\u007f-\u009f؜​-‏  ‪-‮⁠⁦-⁩﻿]';
  v_c record;
  v_empresa text;
  v_cliente text;
begin
  begin
    -- Solo un presupuesto con el vínculo real de la tienda (nunca un comprobante de panel), y la organización sale de él.
    select c.id, c.organizacion_id, c.empresa_id, c.cliente_id, c.numero, c.total_con_iva into v_c
      from dominio.comprobantes_venta c
      join dominio.presupuestos_tienda pt on pt.comprobante_id = c.id and pt.organizacion_id = c.organizacion_id
     where c.id = p_comprobante_id and c.tipo = 'presupuesto';
    if not found then
      return;
    end if;

    select e.nombre into v_empresa
      from dominio.empresas e
     where e.id = v_c.empresa_id and e.organizacion_id = v_c.organizacion_id;

    select 'Nº ' || cl.numero::text || ' · ' || btrim(regexp_replace(coalesce(cl.nombre, ''), c_prohibidos, ' ', 'g')) into v_cliente
      from dominio.clientes cl
     where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;

    perform private.emitir_aviso(
      'presupuesto_tienda_nuevo',
      v_c.organizacion_id,
      jsonb_strip_nulls(jsonb_build_object(
        'Empresa', left(v_empresa, 120),
        'Presupuesto', v_c.numero,
        'Cliente', left(v_cliente, 160),
        'Total', round(v_c.total_con_iva, 2)::text
      )),
      v_c.empresa_id
    );
  exception when others then
    -- Solo sqlstate: sqlerrm puede traer datos del cliente. El alta del presupuesto sigue.
    raise warning 'No se pudo emitir el aviso del presupuesto %: %', p_comprobante_id, sqlstate;
  end;
end;
$$;

comment on function private.emitir_aviso_presupuesto_tienda(uuid) is
  'MSF-940 (FR-063): emite el aviso presupuesto_tienda_nuevo (correo, sección ventas, alcance de la empresa del presupuesto) de un presupuesto creado desde la tienda. Solo con vínculo en dominio.presupuestos_tienda. Asunto sin datos del cliente; cuerpo con tienda, número, cliente (Nº y nombre) y total; sin la nota. Un fallo se registra (sqlstate) y no frena el alta. Sin acceso de API.';

revoke execute on function private.emitir_aviso_presupuesto_tienda(uuid) from public, anon, authenticated;

create or replace function publico.crear_presupuesto_tienda(host text, items jsonb, nota text, clave_envio uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan en la nota: de control (salvo el salto de línea), separadores de línea Unicode y marcas de dirección del texto.
  -- (M-4: se suman U+061C y los ceros de ancho U+200B a U+200D, U+2060 y U+FEFF; el mismo conjunto que el front, `tiendaPedido.ts`.)
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
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
    from dominio.clientes cl where cl.id = v_cuenta.cliente_id and cl.organizacion_id = v_cuenta.organizacion_id;
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
      descuento_pct, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    select v_cuenta.organizacion_id, v_comprobante.id, l.orden, l.producto_id, l.descripcion, l.codigo, l.cantidad, l.precio_unitario, l.escala,
           false, l.alicuota_id, l.alicuota_porcentaje, l.deposito_id, l.a_pedido, l.subtotal_sin_iva, l.iva,
           l.descuento_pct, l.precio_referencia, l.promocion_id, l.lista_precio_id, l.lista_ajuste_pct
      from jsonb_to_recordset(v_lineas) as l(
        orden integer, producto_id uuid, descripcion text, codigo text, cantidad integer, precio_unitario numeric, escala text,
        alicuota_id uuid, alicuota_porcentaje numeric, deposito_id uuid, a_pedido boolean, subtotal_sin_iva numeric, iva numeric,
        descuento_pct numeric, precio_referencia numeric, promocion_id uuid, lista_precio_id uuid, lista_ajuste_pct numeric)
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

    -- Aviso al equipo (MSF-940): último paso, ya pasados todos los topes y cupos. No puede fallar ni frenar el alta (el emisor tiene su propio manejador).
    perform private.emitir_aviso_presupuesto_tienda(v_comprobante.id);

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
$$;

revoke execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) from public, anon;
grant execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) to authenticated;

comment on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) is
  'MSF-176 (B2, FR-051 a FR-060): crea UN presupuesto pendiente (canal tienda_online, sin operador, sin validez) para la cuenta ACTIVA de la tienda del host, con precio del servidor (motor del panel: descuento de la ficha, escala, promoción, IVA), numeración correlativa, líneas, vínculo y evento de actividad en una sola transacción; MSF-940: al final avisa por correo al equipo de ventas de la empresa (sin bloquear el alta). Solo authenticated; no recibe cliente, empresa, precios ni descuento. Idempotente por (cuenta, clave_envio); topes de 5 por día y 10 abiertos por cuenta con lock; cupo de llamadas antes de calcular y cupo por hora de la tienda. Sin efectos de stock ni dinero. {estado: ok|invalido|sin_precio|no_disponible|limite|limite_cuenta|sin_acceso|error}, sin datos internos.';
