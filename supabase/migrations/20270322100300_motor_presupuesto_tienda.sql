-- MSF-176 · Tienda compra y cuentas, historia B2 «Presupuesto desde la tienda», T054. FR-051 a FR-056; D-16, D-17, D-28; amenazas 2.1, 2.3, 2.4, 2.11.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. `private.motor_presupuesto_tienda` -> `private`: lógica de armado de líneas sin datos propios y SIN
-- execute para la API (solo la llaman `publico.cotizar_presupuesto_tienda` y `publico.crear_presupuesto_tienda`).
--
-- `private.motor_presupuesto_tienda(p_cuenta uuid, p_items jsonb) → setof línea`
--   Es el ÚNICO lugar que arma las líneas de un presupuesto de la tienda: la cotización y la creación lo usan, así que «lo que ves es lo que se crea».
--   * Identidad: recibe la cuenta (`cuentas_cliente.id`, que la RPC derivó de `private.cuenta_de_tienda`) y de ella saca TODO lo demás: cliente, organización, empresa,
--     tipo de cliente y descuento de la ficha (`public.clientes`, siempre con `organizacion_id` = el de la empresa de la cuenta). Una cuenta que no está `activa`
--     no devuelve nada. Nunca recibe empresa, organización, cliente, escala, descuento, instante ni depósito del exterior.
--   * Entrada de ítems: se vuelve a normalizar con `private.validar_items_pedido` (1 a 50 líneas, cantidad 1 a 9.999, claves ajenas ignoradas); una lista inválida no
--     devuelve nada.
--   * Productos: solo los EFECTIVAMENTE visibles en la tienda (`private.catalogo_tienda_efectivo`: con fila en `producto_empresa`, activos y no ocultos): los demás
--     salen con `estado = 'no_disponible'`, todos iguales (inexistente, ajeno, oculto o inactivo no se distinguen).
--   * Precio: SIEMPRE `private.precio_linea_venta_calculo` (la fórmula única de MSF-816 sin sesión de panel, D-17) con el tipo y el descuento de la ficha del cliente, el
--     instante del SERVIDOR (`clock_timestamp()`, nunca un parámetro) y el descuento siempre aplicado (sin precio manual): escala según el tipo y la cantidad de ESA
--     línea, precio propio, promoción vigente si es menor (sin acumular), IVA. Un neto nulo o <= 0 sale `estado = 'sin_precio'` y NUNCA una línea en cero; un importe
--     de línea >= 10^12 sale `estado = 'excedido'`.
--   * Depósito: el por defecto, activo, que vende la tienda (igual que el panel cuando no se elige); si no hay, `deposito_id` queda nulo (la creación responde `error`).
--   * Salida por línea (interna; las RPC públicas filtran lo que muestran): orden, producto, estado, descripción y código (copia del producto), cantidad, precio unitario,
--     escala, alícuota (id y porcentaje, 0 si es exenta), depósito, a pedido, subtotal, IVA, descuento, precio de referencia y promoción (solo si ganó), disponibilidad.
--
-- `private.limite_cotizaciones_por_minuto()` y `private.limite_presupuestos_por_minuto()`: topes de LLAMADAS por cuenta y minuto (constantes versionadas, sin acceso de API).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists private.motor_presupuesto_tienda(uuid, jsonb);
--   drop function if exists private.limite_presupuestos_por_minuto();
--   drop function if exists private.limite_cotizaciones_por_minuto();

create or replace function private.limite_cotizaciones_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 20; $$;

revoke execute on function private.limite_cotizaciones_por_minuto() from public, anon, authenticated;

create or replace function private.limite_presupuestos_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10; $$;

revoke execute on function private.limite_presupuestos_por_minuto() from public, anon, authenticated;

create or replace function private.motor_presupuesto_tienda(p_cuenta uuid, p_items jsonb)
returns table (
  orden integer,
  producto_id uuid,
  estado text,
  descripcion text,
  codigo text,
  cantidad integer,
  precio_unitario numeric,
  escala text,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  deposito_id uuid,
  a_pedido boolean,
  subtotal_sin_iva numeric,
  iva numeric,
  descuento_pct numeric,
  precio_referencia numeric,
  promocion_id uuid,
  disponible boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_empresa uuid;
  v_tipo text;
  v_descuento numeric;
  v_items jsonb;
  v_deposito uuid;
  v_visibles uuid[];
  v_ahora timestamptz := clock_timestamp();
  v_item record;
  v_pr dominio.productos;
  v_precio record;
  v_porcentaje numeric;
  v_subtotal numeric;
begin
  -- Todo sale de la cuenta (que la RPC derivó de la sesión y del host): cliente, organización, empresa, tipo y descuento de la ficha.
  select cc.organizacion_id, cc.empresa_id, cl.tipo, coalesce(cl.descuento, 0)
    into v_org, v_empresa, v_tipo, v_descuento
    from public.cuentas_cliente cc
    join dominio.empresas e on e.id = cc.empresa_id and e.organizacion_id = cc.organizacion_id and e.activa
    join public.clientes cl on cl.id = cc.cliente_id and cl.organizacion_id = cc.organizacion_id
   where cc.id = p_cuenta and cc.estado = 'activa';
  if v_org is null then
    return;
  end if;

  v_items := private.validar_items_pedido(p_items);
  if v_items is null then
    return;
  end if;

  select d.id into v_deposito
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_empresa and de.organizacion_id = v_org
   where d.organizacion_id = v_org and d.por_defecto and d.activo
   limit 1;

  select coalesce(array_agg(x.producto_id), '{}'::uuid[]) into v_visibles
    from private.catalogo_tienda_efectivo(v_empresa) x
   where x.efectivo
     and x.producto_id in (select (e.valor ->> 'producto_id')::uuid from jsonb_array_elements(v_items) e(valor));

  for v_item in
    select e.ord::integer as ord, (e.valor ->> 'producto_id')::uuid as producto, (e.valor ->> 'cantidad')::integer as cant
      from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
     order by e.ord
  loop
    -- Fila de resultado vacía por defecto (se completa abajo).
    orden := v_item.ord;
    producto_id := v_item.producto;
    cantidad := v_item.cant;
    estado := 'no_disponible';
    descripcion := null; codigo := null; precio_unitario := null; escala := null; alicuota_id := null; alicuota_porcentaje := null;
    deposito_id := v_deposito; a_pedido := null; subtotal_sin_iva := null; iva := null; descuento_pct := null;
    precio_referencia := null; promocion_id := null; disponible := null;

    v_pr := null;
    if v_item.producto = any (v_visibles) then
      select * into v_pr from dominio.productos pr where pr.id = v_item.producto and pr.organizacion_id = v_org and pr.activo;
    end if;
    if v_pr.id is null then
      return next;
      continue;
    end if;

    descripcion := left(coalesce(nullif(btrim(v_pr.nombre), ''), 'Producto sin nombre'), 300);
    codigo := left(nullif(btrim(v_pr.sku), ''), 100);
    a_pedido := v_pr.disponibilidad_manual is not distinct from 'a_pedido';
    disponible := private.disponible_publico(v_pr.id);

    select * into v_precio
      from private.precio_linea_venta_calculo(v_pr.id, v_empresa, v_tipo, v_item.cant, v_descuento, v_ahora, true);
    if not found or v_precio.neto_unitario is null or v_precio.neto_unitario <= 0 then
      estado := 'sin_precio';
      return next;
      continue;
    end if;

    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_precio.neto_unitario * v_item.cant, 2);
    if v_precio.neto_unitario >= 1000000000000 or v_subtotal >= 1000000000000 then
      estado := 'excedido';
      return next;
      continue;
    end if;

    estado := 'ok';
    precio_unitario := v_precio.neto_unitario;
    escala := v_precio.escala_usada;
    alicuota_id := v_precio.alicuota_id;
    alicuota_porcentaje := v_porcentaje;
    subtotal_sin_iva := v_subtotal;
    iva := round(v_subtotal * v_porcentaje / 100, 2);
    descuento_pct := v_precio.descuento_aplicado;
    precio_referencia := v_precio.precio_referencia;
    promocion_id := v_precio.promocion_id;
    return next;
  end loop;
end;
$$;

revoke execute on function private.motor_presupuesto_tienda(uuid, jsonb) from public, anon, authenticated, service_role;

comment on function private.motor_presupuesto_tienda(uuid, jsonb) is
  'MSF-176 (B2, FR-051 a FR-056, D-17): arma las líneas de un presupuesto de la tienda para una cuenta ACTIVA: cliente, organización, empresa, tipo y descuento salen de la cuenta; solo productos efectivamente visibles; precio con private.precio_linea_venta_calculo (instante del servidor, descuento de la ficha, sin precio manual); estado por línea (ok, no_disponible, sin_precio, excedido). La usan cotizar y crear (lo que ves es lo que se crea). Sin execute para la API.';
