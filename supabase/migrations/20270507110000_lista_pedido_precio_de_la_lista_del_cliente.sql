-- MSF-969 (seguimiento de la épica MSF-450, listas de precios por cliente, fases 3 y 4; plan de deuda técnica MSF-515): la lista de pedido de
-- la tienda («Enviar consulta») usa el MISMO precio que «Tu precio» de la ficha cuando la persona tiene sesión y una lista de precios.
--
-- Defecto: `private.precio_referencia_pedido` (fórmula única del precio de referencia de la lista, D-28) no recibía al cliente: para una
-- cuenta con lista mostraba el precio público (con la bandera `listas_precios` encendida, «Tu precio», los favoritos y el presupuesto de la
-- tienda ya usan la lista, 20270348000300). La pantalla mostraba un precio y la consulta guardaba ese mismo número, distinto del que la
-- persona ve en la ficha y del que cobra el mostrador.
--
-- Decisión (menor sorpresa; no cambia el contrato público): con cuenta activa, la lista de pedido y la consulta que se envía parten del
-- precio de `private.precio_final_publico_escala(producto, empresa, escala, cliente)` (el mismo valor que «Tu precio») y compiten con la
-- promoción vigente igual que en `publico.precios_cliente_por_dominio`: GANA EL MÁS BAJO, SIN ACUMULAR; la lista queda como `precio_anterior`.
-- Se mantiene SIN el descuento de la ficha del cliente (eso sigue apareciendo solo en la cotización del presupuesto). El visitante, la
-- cuenta suspendida o no habilitada, el cliente sin lista y la bandera `listas_precios` apagada dan EXACTAMENTE el resultado anterior
-- (la rama nueva solo corre si `private.lista_precios_cliente` devuelve una lista; es la única lectura de bandera y lista del motor).
--
-- Seguridad: el cliente NUNCA viene del llamador. `publico.lista_pedido_por_dominio` y `publico.enviar_lista_pedido` siguen sin argumentos
-- de cliente, cuenta, empresa ni precios (lo fija el pgTAP `tienda_lista_pedido`): el cliente sale de `private.cuenta_de_tienda(host)`
-- (sesión `auth.uid()` + cuenta activa y habilitada en ESTA tienda). El anónimo no obtiene ninguna lista. La respuesta pública conserva las mismas
-- claves (no revela la lista ni su porcentaje). Los datos ya guardados (`consulta_items.precio_referencia` de consultas anteriores) no se tocan.
--
-- Esquemas (Principio VII): sin tablas. `publico` sigue sin tablas; `private` es cálculo interno sin `execute` de API.
--
-- Funciones (cada cuerpo parte de la última definición de las migraciones, conservando todo lo demás):
--   1. `private.precio_referencia_pedido(producto, empresa, tipo, cantidad)` -> `(…, p_cliente uuid default null)`. Cuerpo de partida:
--      20270321100100. Se borra la firma de 4 argumentos para no dejar una sobrecarga ambigua (los llamadores pasan 4 o 5 y resuelven a la
--      nueva). Sin `execute` para `public`, `anon`, `authenticated` ni `service_role`.
--   2. `private.crear_consulta_pedido`: pasa `p_cliente` (que ya recibía) al precio de referencia. Cuerpo de partida: 20270321100400.
--   3. `publico.lista_pedido_por_dominio`: pasa el cliente de la cuenta activa. Cuerpo de partida: 20270430000000 (sub-bloque con
--      su manejador y cupo de lecturas intactos). `publico.enviar_lista_pedido` no se toca: ya le pasa `v_cuenta.cliente_id` a `crear_consulta_pedido`.
--
-- Migración aditiva en datos (`create or replace` + el `drop` de la firma vieja de una función interna). Reversión operativa inmediata,
-- SIN migrar: apagar la bandera `listas_precios`. Reversión de código (migración posterior): `drop function if exists
-- private.precio_referencia_pedido(uuid, uuid, text, integer, uuid);` y restaurar los cuerpos de 20270321100100 (precio_referencia_pedido),
-- 20270321100400 (crear_consulta_pedido) y 20270430000000 (lista_pedido_por_dominio).

-- ============================================================================
-- 1. Precio de referencia de la lista de pedido, con la lista del cliente
-- ============================================================================
drop function if exists private.precio_referencia_pedido(uuid, uuid, text, integer);

create or replace function private.precio_referencia_pedido(p_producto uuid, p_empresa uuid, p_tipo text, p_cantidad integer, p_cliente uuid default null)
returns table (precio numeric, precio_anterior numeric, escala text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_escala text;
  v_vigente_precio numeric;
  v_vigente_anterior numeric;
  v_escalado numeric;
  v_con_lista boolean := false;
begin
  select pv.precio, pv.precio_anterior into v_vigente_precio, v_vigente_anterior
    from private.precio_vigente_empresa(p_producto, p_empresa, now()) pv;

  v_escala := case when p_tipo is null then 'x1' else private.escala_para_linea(p_tipo, p_cantidad) end;

  -- ¿Rige una lista de precios para el cliente? `lista_precios_cliente` es la única lectura de la bandera y de la lista (sin filas con la
  -- bandera apagada, cliente ajeno a la organización de la tienda, Consumidor final, sin lista o lista archivada).
  if p_cliente is not null then
    select exists (
             select 1
               from dominio.empresas e
               cross join lateral private.lista_precios_cliente(p_cliente, e.organizacion_id) lp
              where e.id = p_empresa)
      into v_con_lista;
  end if;

  if v_escala = 'x1' and not v_con_lista then
    -- Visitante y minorista (y mayorista de 1 a 4 unidades) sin lista: el precio de la ficha.
    return query select v_vigente_precio, v_vigente_anterior, v_escala;
    return;
  end if;

  -- Escala del mayorista o precio normal con la lista del cliente (mismo número que «Tu precio»).
  v_escalado := private.precio_final_publico_escala(p_producto, p_empresa, v_escala, case when v_con_lista then p_cliente end);
  if v_escalado is null then
    return query select null::numeric, null::numeric, v_escala;
  elsif v_vigente_anterior is not null and v_vigente_precio is not null and v_vigente_precio < v_escalado then
    -- Promoción vigente más baja que la escala (o la lista) del cliente: gana la promoción; la escala queda como precio anterior.
    return query select v_vigente_precio, v_escalado, v_escala;
  else
    return query select v_escalado, null::numeric, v_escala;
  end if;
end;
$$;

comment on function private.precio_referencia_pedido(uuid, uuid, text, integer, uuid) is
  'MSF-176 (B1, D-28) + MSF-969: precio de referencia de una línea de la lista de pedido = el que la persona ve en la tienda (ficha con promoción vigente y precio_anterior; con cuenta mayorista, la escala de la cantidad de la línea; con cuenta y una lista de precios vigente del cliente, la lista, igual que «Tu precio»; gana el más bajo contra la promoción), sin el descuento de la ficha del cliente. Sin cliente, sin lista o con la bandera listas_precios apagada es idéntica a la versión anterior. Fuente única de lista_pedido_por_dominio y crear_consulta_pedido. Sin acceso de API.';

revoke execute on function private.precio_referencia_pedido(uuid, uuid, text, integer, uuid) from public, anon, authenticated, service_role;

-- ============================================================================
-- 2. Alta de la consulta de la lista de pedido: el precio que guarda es el de la lista del cliente
-- ============================================================================
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
         -- Respaldos para que un dato raro del catálogo no aborte el envío: descripción en blanco → texto genérico; un precio fuera de rango
         -- (>= 10^12 o negativo) → null («precio a confirmar»), igual que un producto sin precio.
         left(coalesce(nullif(btrim(pr.nombre), ''), 'Producto sin nombre'), 300), left(nullif(btrim(pr.sku), ''), 100), (e.valor ->> 'cantidad')::integer,
         case when p.precio is null or p.precio < 0 or p.precio >= 1000000000000 then null else p.precio end
    from jsonb_array_elements(p_items) with ordinality as e(valor, ord)
    join dominio.productos pr on pr.id = (e.valor ->> 'producto_id')::uuid and pr.organizacion_id = v_org
    cross join lateral private.precio_referencia_pedido(pr.id, p_empresa, p_tipo, (e.valor ->> 'cantidad')::integer, p_cliente) p;
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
  'MSF-176 (B1, FR-030) + MSF-969: inserta, en la transacción de quien llama, la consulta origen pedido y sus ítems (descripción y SKU copiados; precio_referencia del servidor, con la lista de precios del cliente si la cuenta la tiene), y emite el aviso con el resumen. Todo o nada. Sin acceso de API: solo la llama publico.enviar_lista_pedido.';

revoke execute on function private.crear_consulta_pedido(uuid, text, text, text, uuid, jsonb, text) from public, anon, authenticated;

-- ============================================================================
-- 3. Lectura de la lista de pedido: el cliente de la cuenta activa
-- ============================================================================
CREATE OR REPLACE FUNCTION publico.lista_pedido_por_dominio(host text, items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_org uuid;
  v_items jsonb;
  v_cuenta record;
  v_tipo text;
  v_cliente uuid;
  v_limite jsonb;
  v_lineas jsonb;
  v_no_disponibles jsonb;
  v_total numeric;
begin
  select e.id, e.organizacion_id into v_empresa, v_org
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'error');
  end if;

  v_items := private.validar_items_pedido(items);
  if v_items is null then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'));
  end if;

  -- Limitador de lecturas (amenaza 1.9): cupo propio de la lista, atómico y sin guardar la IP (solo un hash).
  v_limite := private.registrar_pedido_publico('lista|' || private.visitante_publico(host), private.limite_listas_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador (patrón M-3 de B2, ver `crear_presupuesto_tienda`): una excepción revierte SOLO este
  -- bloque y el cupo de lecturas (arriba) sobrevive. Con un único manejador exterior, un fallo posterior deshacía también el cupo y quien provocaba
  -- el fallo (p. ej. con datos que rompen el cálculo) pagaba cada llamada sin gastar cupo.
  begin
  -- Con cuenta activa y habilitada en ESTA tienda: la escala del tipo del cliente. Cualquier otro caso (visitante, suspendida, otra
  -- tienda, usuario del panel…) es un visitante: nunca se distingue.
  select * into v_cuenta from private.cuenta_de_tienda(host);
  if found then
    v_tipo := v_cuenta.tipo;
    v_cliente := v_cuenta.cliente_id;
  end if;

  with entrada as (
    select (e.valor ->> 'producto_id')::uuid as producto_id,
           (e.valor ->> 'cantidad')::integer as cantidad,
           e.ord
      from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
  ),
  visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo_ids(v_empresa, (select array_agg(en.producto_id) from entrada en)) x
     where x.efectivo and x.producto_id in (select en.producto_id from entrada en)
  ),
  calculadas as (
    select en.ord,
           en.producto_id,
           en.cantidad,
           pr.nombre,
           nullif(btrim(pr.sku), '') as sku,
           (select i.ruta from dominio.producto_imagenes i
             where i.producto_id = pr.id and i.organizacion_id = pr.organizacion_id
             order by i.posicion limit 1) as imagen,
           private.disponible_publico(pr.id) as disponible,
           p.precio,
           p.precio_anterior,
           p.escala,
           case when p.precio is null then null else round(p.precio * en.cantidad, 2) end as subtotal
      from entrada en
      join visibles v on v.producto_id = en.producto_id
      join dominio.productos pr on pr.id = en.producto_id and pr.organizacion_id = v_org
      cross join lateral private.precio_referencia_pedido(pr.id, v_empresa, v_tipo, en.cantidad, v_cliente) p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', c.producto_id,
           'nombre', c.nombre,
           'sku', c.sku,
           'imagen', c.imagen,
           'cantidad', c.cantidad,
           'disponible', c.disponible,
           'precio_unitario', c.precio,
           'precio_anterior', c.precio_anterior,
           'escala', c.escala,
           'subtotal', c.subtotal
         ) order by c.ord), '[]'::jsonb),
         sum(c.subtotal)
    into v_lineas, v_total
    from calculadas c;

  -- Los que no salieron en `lineas`: todos iguales para quien pregunta (inexistente, ajeno, oculto, inactivo…).
  select coalesce(jsonb_agg(to_jsonb((e.valor ->> 'producto_id')::uuid) order by e.ord), '[]'::jsonb)
    into v_no_disponibles
    from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
   where not exists (
     select 1 from jsonb_array_elements(v_lineas) l where (l ->> 'producto_id')::uuid = (e.valor ->> 'producto_id')::uuid
   );

  return jsonb_build_object(
    'estado', 'ok',
    'con_cuenta', v_tipo is not null,
    'tipo', v_tipo,
    'lineas', v_lineas,
    'no_disponibles', v_no_disponibles,
    'total_referencia', v_total
  );
  exception when others then
    -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
    raise warning 'lista_pedido_por_dominio falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Manejador EXTERIOR: cubre solo lo que corre ANTES del sub-bloque (resolver el host, la bandera, validar las líneas y consumir el cupo: un fallo de
  -- cualquiera de ellos responde `error` y, si falla el propio cupo, no hay cupo que conservar). Lo posterior al cupo lo atrapa el sub-bloque, que
  -- conserva el cupo. Un pgTAP fuerza un fallo de cada lado.
  -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
  raise warning 'lista_pedido_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

revoke execute on function publico.lista_pedido_por_dominio(text, jsonb) from public, anon;
grant execute on function publico.lista_pedido_por_dominio(text, jsonb) to anon, authenticated;

comment on function publico.lista_pedido_por_dominio(text, jsonb) is
  'MSF-176 (B1, FR-023, D-28) + MSF-969: revalida la lista de pedido (hasta 50 líneas {producto_id, cantidad}) en la tienda del host: por línea nombre, SKU, imagen, disponibilidad (sin stock), precio de referencia del servidor (el que ve la persona; escala del tipo con cuenta activa y su lista de precios si la tiene, igual que «Tu precio»), precio_anterior y subtotal; no_disponibles indistinguibles; total_referencia. Cupo propio de 30 lecturas por minuto y visitante (limite). {estado: ok|invalido|limite|error}. Superficie pública deliberada (anon y authenticated).';
