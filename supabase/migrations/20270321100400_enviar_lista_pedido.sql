-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro», T034. FR-025 a FR-030, FR-033; D-8, D-9, D-25;
-- amenazas 1.1 (spam), 1.2 (evadir el límite), 1.5 (XSS e inyección), 1.6 (datos personales), 1.7 (errores), 1.8 (precios) y 1.10.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.enviar_lista_pedido      -> `publico` (superficie de la tienda; `publico` sigue SIN tablas).
--   * private.crear_consulta_pedido    -> `private` (insertor interno de `dominio.consultas` y `dominio.consulta_items`; SIN execute de
--                                        API: nadie lo llama salvo `enviar_lista_pedido`, así el límite no se puede saltear).
--
-- `publico.enviar_lista_pedido(host, nombre, contacto, nota, items, clave_envio) → jsonb`
--   * `anon` y `authenticated`; `security definer`, `search_path = ''`, SIN SQL dinámico; `revoke … from public, anon` y `grant …
--     to anon, authenticated` explícitos (superficie pública DELIBERADA: se suma a la lista cerrada de `anon` del pgTAP).
--   * Orden: empresa por host (desconocido, desactivada y pausada responden `error` idéntico, ANTES de validar nada) → bandera
--     `tienda_pedidos` (apagada: `error`, sin tocar datos) → entradas (`invalido` con `campos`, nunca el valor) → reintento de una
--     clave ya registrada (`ok` sin crear nada: la repetición no depende de que los productos sigan visibles) → cada producto debe
--     ser visible en ESTA tienda (si alguno no lo es se rechaza la lista entera con `invalido` + `campos = ['items']` +
--     `no_disponibles`) → una sola sub-transacción con un único manejador: `private.registrar_envio_tienda(empresa, 'pedido', clave)`
--     (`limite` → `{estado: limite, espera_segundos}`; `repetido` → `ok` sin crear; `nuevo` → `private.crear_consulta_pedido`).
--     Si la entrega falla se revierte también el registro del envío (no se gasta cupo).
--   * Con cuenta activa (`private.cuenta_de_tienda`): `nombre` y `contacto` recibidos SE IGNORAN; se usan los de la ficha del cliente
--     (nombre y correo; D-25) y la consulta guarda `cliente_id`. Sin cuenta: `nombre` (1–100) y `contacto` (correo, o teléfono de 8 a
--     15 dígitos) pasan por `private.validar_contacto_tienda`; `nota` opcional <= 500.
--   * Texto libre: se recorta; se rechazan caracteres de control (en la nota se acepta el salto de línea; `\r\n` se normaliza a `\n`),
--     separadores de línea Unicode y marcas de dirección de texto (U+202A-202E, U+2066-2069, U+200E/F); se guarda TAL CUAL como texto
--     (`<script>` o `=HYPERLINK(…)` quedan literales: el panel renderiza texto y la exportación neutraliza fórmulas).
--   * Ninguna clave ajena de `items` se lee (`precio`, `descuento`, …): el `precio_referencia` sale de `private.precio_referencia_pedido`.
--   * Respuestas cerradas: `{estado: ok}` | `invalido` (+ `campos`, + `no_disponibles` solo si hay productos) | `limite` (+ `espera_segundos`) |
--     `error`. Ningún camino devuelve texto de Postgres; el `exception when others` registra solo `sqlstate` (`raise warning`).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid);
--   drop function if exists private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text);

create or replace function private.crear_consulta_pedido(
  p_empresa uuid,
  p_nombre text,
  p_contacto text,
  p_nota text,
  p_cliente uuid,
  p_items jsonb,
  p_tipo text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_esperados integer := jsonb_array_length(p_items);
  v_insertados integer;
begin
  select e.organizacion_id into v_org from dominio.empresas e where e.id = p_empresa;
  if v_org is null then
    raise exception 'Empresa inexistente' using errcode = 'P0002';
  end if;

  -- El trigger de Consultas NO emite el aviso de un pedido (todavía no tiene ítems): lo emitimos abajo.
  insert into dominio.consultas (organizacion_id, empresa_id, origen, nombre, contacto, mensaje, cliente_id)
  values (v_org, p_empresa, 'pedido', p_nombre, p_contacto, nullif(btrim(coalesce(p_nota, '')), ''), p_cliente)
  returning id into v_id;

  insert into dominio.consulta_items (organizacion_id, empresa_id, consulta_id, orden, producto_id, descripcion, sku, cantidad, precio_referencia)
  select v_org, p_empresa, v_id, e.ord::integer, pr.id,
         left(pr.nombre, 300), left(nullif(btrim(pr.sku), ''), 100), (e.valor ->> 'cantidad')::integer,
         p.precio
    from jsonb_array_elements(p_items) with ordinality as e(valor, ord)
    join dominio.productos pr on pr.id = (e.valor ->> 'producto_id')::uuid and pr.organizacion_id = v_org
    cross join lateral private.precio_referencia_pedido(pr.id, p_empresa, p_tipo, (e.valor ->> 'cantidad')::integer) p;
  get diagnostics v_insertados = row_count;

  -- Todo o nada: si falta algún producto la sub-transacción de quien llama se revierte entera.
  if v_insertados <> v_esperados then
    raise exception 'Pedido incompleto' using errcode = 'P0001';
  end if;

  perform private.emitir_aviso_consulta(v_id);
  return v_id;
end;
$$;

comment on function private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text) is
  'MSF-176 (B1, FR-030): inserta, en la transacción de quien llama, la consulta origen pedido y sus ítems (descripción y SKU copiados; precio_referencia del servidor), y emite el aviso con el resumen. Todo o nada. Sin acceso de API: solo la llama publico.enviar_lista_pedido.';

revoke execute on function private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text) from public, anon, authenticated;

create or replace function publico.enviar_lista_pedido(
  host text,
  nombre text,
  contacto text,
  nota text,
  items jsonb,
  clave_envio uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan: de control, separadores de línea Unicode y marcas de dirección del texto.
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]';
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]';
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
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or clave_envio is null or not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'error');
  end if;

  -- Con cuenta activa y habilitada en ESTA tienda: sus datos y su cliente. Cualquier otro caso es un visitante.
  select * into v_cuenta from private.cuenta_de_tienda(host);

  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n')), '');
  if v_cuenta.cuenta_cliente_id is not null then
    select c.nombre, coalesce(nullif(btrim(c.correo), ''), nullif(btrim(c.telefono), ''), nullif(btrim(c.celular), '')) as contacto
      into v_cliente
      from public.clientes c
     where c.id = v_cuenta.cliente_id and c.organizacion_id = v_cuenta.organizacion_id;
    v_nombre := left(btrim(coalesce(v_cliente.nombre, '')), 120);
    v_contacto := left(coalesce(v_cliente.contacto, ''), 200);
    -- Una ficha sin nombre o sin ningún contacto no se puede responder: error genérico (la cuenta web exige correo, D-25).
    if v_nombre = '' or v_contacto = '' then
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
      from private.catalogo_tienda_efectivo(v_empresa) x
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
  raise warning 'enviar_lista_pedido falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) to anon, authenticated;

comment on function publico.enviar_lista_pedido(text, text, text, text, jsonb, uuid) is
  'MSF-176 (B1, FR-025 a FR-030): envía la lista de pedido de la tienda del host como UNA consulta origen pedido con sus ítems (todo o nada). Con cuenta activa usa nombre y correo de la ficha y guarda cliente_id; sin cuenta valida nombre (1-100), contacto y nota (<=500). Límite de la tienda (5 por hora por visitante) e idempotencia por clave_envio; la entrega fallida no gasta cupo. {estado: ok|invalido|limite|error}, sin datos internos. Superficie pública deliberada (anon y authenticated).';
