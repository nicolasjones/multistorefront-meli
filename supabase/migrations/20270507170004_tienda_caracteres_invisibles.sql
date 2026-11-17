-- MSF-176 · Tienda compra y cuentas, PR de cierre, H-6 de la revisión de seguridad integral (T070): caracteres invisibles bloqueados en B1 y B2.
--
-- `enviar_lista_pedido` (B1) y `crear_presupuesto_tienda` (B2) rechazaban los caracteres de control, los separadores de línea Unicode, las marcas de dirección del texto, U+061C, los ceros de
-- ancho (U+200B a U+200D), U+2060 y U+FEFF. Se suman U+00AD (guion blando), U+180E (separador mongol) y U+2061 a U+2064 (operadores invisibles; el rango U+2060 a U+2064 queda entero): son
-- invisibles que rompen la búsqueda, la comparación y el ancho real del texto, y el front (`tiendaPedido.ts`) usa el MISMO conjunto.
--
-- Cuerpos: los de las definiciones VIGENTES en `dokploy` (`20270430000000_tienda_menores_revision.sql` para `enviar_lista_pedido`, `20270507130100_aviso_presupuesto_tienda.sql` para
-- `crear_presupuesto_tienda`), con el conjunto de caracteres ampliado. No se copian los cuerpos del PR original (2026-11-14): entre esa fecha y esta la base avanzó (catálogo acotado por ids,
-- `dominio.clientes`, lista de precios del cliente, aviso por correo al equipo) y copiar los antiguos habría revertido esos cambios.
--
-- Misma firma y mismos grants (`anon` y `authenticated` en `enviar_lista_pedido`; solo `authenticated` en `crear_presupuesto_tienda`). Un `statement_timeout` (57014) no lo atrapa `when others`: ver la
-- guía de seguridad.
--
-- Esquemas (Principio VII): sin tablas. Migración aditiva. Reversión (migración posterior): restaurar los cuerpos de `20270430000000_tienda_menores_revision.sql` y
-- `20270507130100_aviso_presupuesto_tienda.sql`.

CREATE OR REPLACE FUNCTION publico.enviar_lista_pedido(host text, nombre text, contacto text, nota text, items jsonb, clave_envio uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan: de control, separadores de línea Unicode y marcas de dirección del texto.
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]';
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]';
  v_empresa uuid;
  v_items jsonb;
  v_cuenta record;
  v_cliente record;
  v_nombre text;
  v_contacto text;
  v_nota text;
  v_campos text[] := '{}';
  v_pendientes jsonb;
  v_registro jsonb;
  v_candidato text;
  v_limite jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or clave_envio is null or not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'error');
  end if;

  -- Cupo de LLAMADAS (S1, amenaza 1.1): se consume ANTES de validar ni de evaluar el catálogo, así también cuentan las llamadas `invalido` (uuids bien
  -- formados al azar con una clave nueva por pedido): sin esto un atacante pagaba la evaluación del catálogo efectivo sin límite. Cupo propio
  -- (`envio|` + visitante, por minuto); es independiente del cupo de 5 ENVÍOS por hora, que sigue siendo `registrar_envio_tienda`.
  v_limite := private.registrar_pedido_publico('envio|' || private.visitante_publico(host), private.limite_llamadas_envio_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador (patrón M-3 de B2, ver `crear_presupuesto_tienda`): una excepción revierte SOLO este
  -- bloque y el cupo de LLAMADAS (arriba) sobrevive; con un único manejador exterior un fallo posterior deshacía también el cupo.
  begin
  -- Con cuenta activa y habilitada en ESTA tienda: sus datos y su cliente. Cualquier otro caso es un visitante.
  select * into v_cuenta from private.cuenta_de_tienda(host);

  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n')), '');
  if v_cuenta.cuenta_cliente_id is not null then
    select c.nombre, c.correo, c.telefono, c.celular
      into v_cliente
      from dominio.clientes c
     where c.id = v_cuenta.cliente_id and c.organizacion_id = v_cuenta.organizacion_id;
    -- Los datos de la ficha pasan por las MISMAS reglas que los de un visitante (S2): del nombre se sacan los caracteres de control, separadores
    -- de línea y marcas de dirección; como contacto se usa el primero de correo, teléfono y celular con formato válido y sin esos caracteres.
    v_nombre := btrim(regexp_replace(regexp_replace(coalesce(v_cliente.nombre, ''), c_prohibidos_linea, ' ', 'g'), '[[:space:]]+', ' ', 'g'));
    v_nombre := left(v_nombre, 100);
    v_contacto := null;
    foreach v_candidato in array array[v_cliente.correo, v_cliente.telefono, v_cliente.celular] loop
      v_candidato := btrim(coalesce(v_candidato, ''));
      if v_candidato <> '' and v_candidato !~ c_prohibidos_linea
         and not ('contacto' = any (private.validar_contacto_tienda('x', v_candidato, 'x'))) then
        v_contacto := v_candidato;
        exit;
      end if;
    end loop;
    -- Una ficha sin nombre o sin ningún contacto válido no se puede responder: error genérico (la cuenta web exige correo, D-25).
    if v_nombre = '' or v_contacto is null then
      return jsonb_build_object('estado', 'error');
    end if;
  else
    v_nombre := btrim(coalesce(nombre, ''));
    v_contacto := btrim(coalesce(contacto, ''));
    v_campos := array_remove(private.validar_contacto_tienda(v_nombre, v_contacto, 'x'), 'mensaje');
    if v_nombre ~ c_prohibidos_linea and not ('nombre' = any (v_campos)) then
      v_campos := array_append(v_campos, 'nombre');
    end if;
    if v_contacto ~ c_prohibidos_linea and not ('contacto' = any (v_campos)) then
      v_campos := array_append(v_campos, 'contacto');
    end if;
  end if;
  if v_nota is not null and (length(v_nota) > 500 or v_nota ~ c_prohibidos_nota) then
    v_campos := array_append(v_campos, 'nota');
  end if;

  v_items := private.validar_items_pedido(items);
  if v_items is null then
    v_campos := array_append(v_campos, 'items');
  end if;
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Un reintento de una clave ya registrada (corte de red) es siempre `ok` y no crea nada, aunque entre tanto un producto se haya
  -- ocultado. (La comprobación definitiva y atómica la hace `registrar_envio_tienda`, más abajo.)
  if exists (select 1 from dominio.tienda_envios t where t.empresa_id = v_empresa and t.clave_envio = clave_envio) then
    return jsonb_build_object('estado', 'ok');
  end if;

  -- Cada producto debe ser visible en ESTA tienda; si alguno no lo es, la lista entera se rechaza (la pantalla ya los avisó al
  -- revalidar). Inexistente, ajeno, oculto o inactivo: indistinguibles.
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo_ids(
             v_empresa, (select array_agg((e.valor ->> 'producto_id')::uuid) from jsonb_array_elements(v_items) e(valor))) x
     where x.efectivo
       and x.producto_id in (select (e.valor ->> 'producto_id')::uuid from jsonb_array_elements(v_items) e(valor))
  )
  select coalesce(jsonb_agg(to_jsonb((e.valor ->> 'producto_id')::uuid) order by e.ord), '[]'::jsonb)
    into v_pendientes
    from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
   where (e.valor ->> 'producto_id')::uuid not in (select v.producto_id from visibles v);
  if jsonb_array_length(v_pendientes) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'), 'no_disponibles', v_pendientes);
  end if;

  -- Sub-transacción: si la entrega falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'pedido', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' = 'nuevo' then
      perform private.crear_consulta_pedido(v_empresa, v_nombre, v_contacto, v_nota, v_cuenta.cliente_id, v_items, v_cuenta.tipo);
    end if;
  exception when others then
    -- Rastro en el servidor (log de Postgres) solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'enviar_lista_pedido falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  return jsonb_build_object('estado', 'ok');
  exception when others then
    -- Rastro en el servidor solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'enviar_lista_pedido falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Manejador EXTERIOR: cubre solo lo que corre ANTES del sub-bloque (host, bandera y consumo del cupo de llamadas). Lo posterior lo atrapa el
  -- sub-bloque, que conserva el cupo. Un pgTAP fuerza un fallo de cada lado.
  raise warning 'enviar_lista_pedido falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

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

-- La superficie no cambia.
revoke execute on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) to anon, authenticated;

revoke execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) from public, anon;
grant execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) to authenticated;

-- Los comentarios se reproducen los de la base (con su documentación completa) y se les suma la nota del conjunto de caracteres: un `create or replace` borra el
-- comentario anterior, así que hay que reponerlo.
comment on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) is
  'MSF-176 (B1, FR-025 a FR-030): envía la lista de pedido de la tienda del host como UNA consulta origen pedido con sus ítems (todo o nada). Con cuenta activa usa nombre y correo de la ficha y guarda cliente_id; sin cuenta valida nombre (1-100), contacto y nota (<=500). Límite de la tienda (5 por hora por visitante) e idempotencia por clave_envio; la entrega fallida no gasta cupo. {estado: ok|invalido|limite|error}, sin datos internos. Superficie pública deliberada (anon y authenticated). MSF-176 (H-6): el conjunto de caracteres bloqueados suma U+00AD, U+180E y U+2061 a U+2064 (el mismo que el front).';

comment on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) is
  'MSF-176 (B2, FR-051 a FR-060): crea UN presupuesto pendiente (canal tienda_online, sin operador, sin validez) para la cuenta ACTIVA de la tienda del host, con precio del servidor (motor del panel: descuento de la ficha, escala, promoción, IVA), numeración correlativa, líneas, vínculo y evento de actividad en una sola transacción; MSF-940: al final avisa por correo al equipo de ventas de la empresa (sin bloquear el alta). Solo authenticated; no recibe cliente, empresa, precios ni descuento. Idempotente por (cuenta, clave_envio); topes de 5 por día y 10 abiertos por cuenta con lock; cupo de llamadas antes de calcular y cupo por hora de la tienda. Sin efectos de stock ni dinero. {estado: ok|invalido|sin_precio|no_disponible|limite|limite_cuenta|sin_acceso|error}, sin datos internos. MSF-176 (H-6): el conjunto de caracteres bloqueados de la nota suma U+00AD, U+180E y U+2061 a U+2064 (el mismo que el front).';
