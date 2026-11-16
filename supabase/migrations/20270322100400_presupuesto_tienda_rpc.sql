-- MSF-176 · Tienda compra y cuentas, historia B2 «Presupuesto desde la tienda», T055. FR-050 a FR-060, FR-014; D-9, D-13, D-16, D-17, D-21, D-23; amenazas 2.1 a 2.12.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.cotizar_presupuesto_tienda / publico.crear_presupuesto_tienda -> `publico` (superficie de la tienda; `publico` sigue SIN tablas).
--   * private.limite_presupuestos_por_dia / limite_presupuestos_abiertos      -> `private` (constantes versionadas de D-9 y D-23, sin acceso de API).
--   * public.tipos_evento_actividad: UNA fila nueva (`presupuesto.creado_desde_tienda`, no sensible): catálogo de plataforma que ya existe.
--
-- Las DOS funciones son ejecutables SOLO por `authenticated` (`revoke … from public, anon`; `anon` no tiene `execute`). La identidad, la tienda y la organización salen
-- ÚNICAMENTE de `private.cuenta_de_tienda(host)` (auth.uid() → cuenta activa y habilitada en la tienda del host → cliente → organización): ninguna recibe cliente, cuenta,
-- empresa, organización, precios, escala, descuento, depósito, estado, canal ni fecha. Sin cuenta activa (anónimo, usuario de panel, cuenta suspendida o de otra
-- tienda, host desconocido, empresa desactivada, bandera apagada) la respuesta es `{estado: sin_acceso}`, IDÉNTICA en todos los casos y sin tocar datos.
-- `security definer`, `search_path = ''`, nombres calificados y SIN SQL dinámico.
--
-- `publico.cotizar_presupuesto_tienda(host, items) → jsonb`
--   Orden: bandera → cuenta → CUPO DE LLAMADAS por cuenta (`cotizacion|<cuenta>`, 20 por minuto, ANTES de cualquier cálculo costoso: el motor cuesta unos 8,5 ms por línea)
--   → validar ítems (`invalido`, `campos = ['items']`) → motor. Es `volatile` (escribe el contador del cupo; el contrato la daba `stable`, sin cupo).
--   Salida mínima: por línea `producto_id`, `descripcion`, `codigo`, `cantidad`, `precio_unitario`, `subtotal_sin_iva`, `iva` y `disponible`; totales; `no_disponibles` y
--   `sin_precio` (ids). NUNCA `promocion_id`, `alicuota_id`, `precio_referencia`, `escala` ni `descuento` (invariante 6 de la revisión T052).
--   Desvío del contrato: no devuelve la escala por línea (la pantalla de la lista ya la muestra); suma el estado `limite`.
--
-- `publico.crear_presupuesto_tienda(host, items, nota, clave_envio) → jsonb`
--   Orden (todo antes de escribir): bandera → cuenta (`sin_acceso`) → CUPO DE LLAMADAS (`presupuesto|<cuenta>`, 10 por minuto, antes del cálculo) → validar `clave_envio`,
--   `nota` (<= 500, sin caracteres de control) e `items` (`invalido` + `campos`) → idempotencia (`(cuenta, clave_envio)` ya existe → el MISMO presupuesto, sin gastar nada)
--   → lock por cuenta (`pg_advisory_xact_lock`) y segunda lectura de la idempotencia → topes por cuenta (5 creados hoy en Buenos Aires y 10 `pendiente` abiertos desde la
--   tienda → `limite_cuenta`) → motor (`no_disponible` / `sin_precio` + `producto_id`; sin depósito por defecto → `error`) → UNA sub-transacción con un único manejador: cupo
--   por hora de la tienda (`registrar_envio_tienda(empresa, 'presupuesto', clave)` → `limite`), número correlativo (`siguiente_numero_comprobante_org`), comprobante, líneas con
--   TODAS las columnas que arma el panel, vínculo `dominio.presupuestos_tienda` y evento de actividad. Todo o nada: si algo falla no queda número consumido ni líneas sueltas ni cupo
--   gastado. Desvío del contrato (orden): los topes por cuenta y el motor van ANTES del cupo por hora de la tienda para que un rechazo no gaste cupo del visitante.
--   Comprobante: `tipo = 'presupuesto'`, `estado = 'pendiente'`, `canal = 'tienda_online'`, `operador_id` nulo, `valido_hasta` nulo (D-13, D-21), fecha = hoy en Buenos Aires.
--   SIN efectos de dinero ni de stock: no llama a funciones de stock, reservas, cobros ni contrarreembolsos.
--   Salida: `{estado: ok, numero, fecha, total_con_iva}` | `invalido` (+ `campos`) | `sin_precio` (+ `producto_id`) | `no_disponible` (+ `producto_id`) | `limite` (+ `espera_segundos`)
--   | `limite_cuenta` | `sin_acceso` | `error`. Ningún camino devuelve texto de Postgres: el `exception when others` registra solo `sqlstate`.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR; los presupuestos ya creados son comprobantes de Ventas y se ANULAN con el flujo normal):
--   drop function if exists publico.crear_presupuesto_tienda(text, jsonb, text, uuid);
--   drop function if exists publico.cotizar_presupuesto_tienda(text, jsonb);
--   drop function if exists private.limite_presupuestos_abiertos();
--   drop function if exists private.limite_presupuestos_por_dia();
--   delete from public.tipos_evento_actividad where tipo = 'presupuesto.creado_desde_tienda';   -- solo si no quedan eventos de ese tipo

create or replace function private.limite_presupuestos_por_dia()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5; $$;

revoke execute on function private.limite_presupuestos_por_dia() from public, anon, authenticated;

create or replace function private.limite_presupuestos_abiertos()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10; $$;

revoke execute on function private.limite_presupuestos_abiertos() from public, anon, authenticated;

insert into public.tipos_evento_actividad (tipo, sensible, descripcion)
values ('presupuesto.creado_desde_tienda', false, 'Presupuesto pedido por un cliente desde la tienda online')
on conflict (tipo) do nothing;

-- ============================================================================
-- publico.cotizar_presupuesto_tienda
-- ============================================================================
create or replace function publico.cotizar_presupuesto_tienda(host text, items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_limite jsonb;
  v_items jsonb;
  v_lineas jsonb;
  v_total_sin numeric;
  v_total_iva numeric;
  v_no_disponibles jsonb;
  v_sin_precio jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;
  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Cupo de LLAMADAS por cuenta, ANTES de validar ni calcular nada (el motor evalúa el catálogo efectivo y el precio de cada línea).
  v_limite := private.registrar_pedido_publico('cotizacion|' || v_cuenta.cuenta_cliente_id::text, private.limite_cotizaciones_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador: una excepción revierte SOLO este bloque y el cupo de llamadas (arriba) sobrevive (M-3 de la revisión): si no, un
  -- error provocable devolvería `error` sin gastar el cupo y el abuso por esa vía no tendría límite.
  begin
  v_items := private.validar_items_pedido(items);
  if v_items is null then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'));
  end if;

  with m as materialized (
    select * from private.motor_presupuesto_tienda(v_cuenta.cuenta_cliente_id, v_items)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', m.producto_id,
           'descripcion', m.descripcion,
           'codigo', m.codigo,
           'cantidad', m.cantidad,
           'precio_unitario', m.precio_unitario,
           'subtotal_sin_iva', m.subtotal_sin_iva,
           'iva', m.iva,
           'disponible', m.disponible
         ) order by m.orden) filter (where m.estado = 'ok'), '[]'::jsonb),
         coalesce(sum(m.subtotal_sin_iva) filter (where m.estado = 'ok'), 0),
         coalesce(sum(m.iva) filter (where m.estado = 'ok'), 0),
         coalesce(jsonb_agg(to_jsonb(m.producto_id) order by m.orden) filter (where m.estado = 'no_disponible'), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(m.producto_id) order by m.orden) filter (where m.estado in ('sin_precio', 'excedido')), '[]'::jsonb)
    into v_lineas, v_total_sin, v_total_iva, v_no_disponibles, v_sin_precio
    from m;

  if v_total_sin + v_total_iva >= 1000000000000 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'));
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'lineas', v_lineas,
    'total_sin_iva', v_total_sin,
    'iva', v_total_iva,
    'total_con_iva', v_total_sin + v_total_iva,
    'no_disponibles', v_no_disponibles,
    'sin_precio', v_sin_precio
  );
  exception when others then
    raise warning 'cotizar_presupuesto_tienda falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'cotizar_presupuesto_tienda falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.cotizar_presupuesto_tienda(text, jsonb) from public, anon;
grant execute on function publico.cotizar_presupuesto_tienda(text, jsonb) to authenticated;

comment on function publico.cotizar_presupuesto_tienda(text, jsonb) is
  'MSF-176 (B2, FR-050): cotiza (sin crear nada) los ítems {producto_id, cantidad} para la cuenta ACTIVA de la tienda del host con el mismo motor que la creación (private.motor_presupuesto_tienda: precio del panel con descuento de la ficha y promoción vigente). Solo authenticated; sin cuenta activa: sin_acceso. Cupo de llamadas por cuenta antes de calcular. Salida mínima (sin promoción, alícuota, referencia ni escala).';

-- ============================================================================
-- publico.crear_presupuesto_tienda
-- ============================================================================
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
$$;

revoke execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) from public, anon;
grant execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) to authenticated;

comment on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) is
  'MSF-176 (B2, FR-051 a FR-060): crea UN presupuesto pendiente (canal tienda_online, sin operador, sin validez) para la cuenta ACTIVA de la tienda del host, con precio del servidor (motor del panel: descuento de la ficha, escala, promoción, IVA), numeración correlativa, líneas, vínculo y evento de actividad en una sola transacción. Solo authenticated; no recibe cliente, empresa, precios ni descuento. Idempotente por (cuenta, clave_envio); topes de 5 por día y 10 abiertos por cuenta con lock; cupo de llamadas antes de calcular y cupo por hora de la tienda. Sin efectos de stock ni dinero. {estado: ok|invalido|sin_precio|no_disponible|limite|limite_cuenta|sin_acceso|error}, sin datos internos.';
