-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro», T031. FR-028; amenaza 1.3 (jsonb malicioso).
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. Dos funciones `private` (lógica interna, sin acceso de API):
--   * private.validar_items_pedido(p_items)      -> valida y normaliza la lista antes de recorrerla.
--   * private.precio_referencia_pedido(...)      -> ÚNICA fórmula del precio de referencia de la lista (D-28): la usan la lectura
--                                                   (`lista_pedido_por_dominio`) y el alta (`crear_consulta_pedido`), así lo que se ve y
--                                                   lo que se guarda no pueden divergir.
--
-- `validar_items_pedido(p_items jsonb) → jsonb`
--   Devuelve `[{"producto_id": "<uuid en minúsculas>", "cantidad": n}, …]` normalizado, o NULL si la entrada es inválida. NUNCA lanza
--   un error de Postgres: no hay ningún cast sin una comprobación previa por expresión regular.
--   Reglas (contrato «Entrada de ítems»): `jsonb_typeof = 'array'`; entre 1 y 50 elementos; tamaño de a lo sumo 8.000 bytes (`pg_column_size`)
--   (se mira antes de recorrer); cada elemento un objeto con `producto_id` (texto con la forma de uuid) y `cantidad` (número entero
--   o texto, de 1 a 4 dígitos, mayor que cero); los repetidos se SUMAN con tope 9.999 y conservan el orden de la primera aparición;
--   TODA otra clave se ignora (`precio`, `descuento`, `escala`, `deposito_id`, `cliente_id`, …).
--
-- `precio_referencia_pedido(p_producto, p_empresa, p_tipo, p_cantidad) → (precio, precio_anterior, escala)`  (D-28)
--   Es el precio que la persona VE en la tienda, sin el descuento de la ficha del cliente (ése solo aparece en la cotización de B2):
--     * visitante (p_tipo nulo) y minorista (escala x1): el de la ficha, `private.precio_vigente_empresa` (con la promoción vigente);
--       `precio_anterior` es el precio normal tachado, o null sin promoción;
--     * mayorista: la escala que corresponde a la cantidad de ESA línea (`private.escala_para_linea`); si hay una promoción vigente
--       menor que el precio de esa escala, gana la promoción y el precio de la escala pasa a ser el `precio_anterior`
--       («gana el más bajo, sin acumular», como el panel).
--   `precio` es null si el producto no tiene precio visible. Sin acceso de API.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function if exists private.precio_referencia_pedido(uuid, uuid, text, integer);
--   drop function if exists private.validar_items_pedido(jsonb);

create or replace function private.validar_items_pedido(p_items jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_max_lineas constant integer := 50;
  c_max_texto constant integer := 8000;
  c_max_cantidad constant integer := 9999;
  v_resultado jsonb;
  v_cuenta integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return null;
  end if;
  v_cuenta := jsonb_array_length(p_items);
  if v_cuenta < 1 or v_cuenta > c_max_lineas then
    return null;
  end if;
  -- Tamaño binario del jsonb (`pg_column_size`): no materializa el texto de una entrada enorme solo para medirla.
  if pg_column_size(p_items) > c_max_texto then
    return null;
  end if;

  -- Un solo pase: cualquier elemento inválido invalida la lista entera (se compara la cantidad de válidos con la de elementos).
  with elementos as (
    select e.ord,
           e.valor,
           (jsonb_typeof(e.valor) = 'object') as es_objeto
      from jsonb_array_elements(p_items) with ordinality as e(valor, ord)
  ),
  campos as (
    select x.ord,
           case when x.es_objeto and jsonb_typeof(x.valor -> 'producto_id') = 'string'
                  and (x.valor ->> 'producto_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then lower(x.valor ->> 'producto_id') end as producto,
           case when x.es_objeto and jsonb_typeof(x.valor -> 'cantidad') in ('number', 'string')
                  and (x.valor ->> 'cantidad') ~ '^[0-9]{1,4}$'
                then (x.valor ->> 'cantidad')::integer end as cantidad
      from elementos x
  ),
  validos as (
    select * from campos where producto is not null and cantidad is not null and cantidad >= 1
  ),
  sumados as (
    select v.producto, least(sum(v.cantidad), c_max_cantidad)::integer as cantidad, min(v.ord) as primero
      from validos v
     group by v.producto
  )
  select case when (select count(*) from validos) = v_cuenta
              then (select jsonb_agg(jsonb_build_object('producto_id', s.producto, 'cantidad', s.cantidad) order by s.primero) from sumados s)
         end
    into v_resultado;

  return v_resultado;
end;
$$;

comment on function private.validar_items_pedido(jsonb) is
  'MSF-176 (B1, amenaza 1.3): valida y normaliza la lista de ítems (1 a 50 objetos {producto_id uuid, cantidad 1..9999}, tamaño <= 8000 bytes, repetidos sumados con tope 9999, claves ajenas ignoradas). Devuelve [{producto_id, cantidad}] o NULL si es inválida; nunca lanza un error de Postgres. Sin acceso de API.';

revoke execute on function private.validar_items_pedido(jsonb) from public, anon, authenticated;

create or replace function private.precio_referencia_pedido(p_producto uuid, p_empresa uuid, p_tipo text, p_cantidad integer)
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
begin
  select pv.precio, pv.precio_anterior into v_vigente_precio, v_vigente_anterior
    from private.precio_vigente_empresa(p_producto, p_empresa, now()) pv;

  v_escala := case when p_tipo is null then 'x1' else private.escala_para_linea(p_tipo, p_cantidad) end;

  if v_escala = 'x1' then
    -- Visitante y minorista (y mayorista de 1 a 4 unidades): el precio de la ficha.
    return query select v_vigente_precio, v_vigente_anterior, v_escala;
    return;
  end if;

  v_escalado := private.precio_final_publico_escala(p_producto, p_empresa, v_escala);
  if v_escalado is null then
    return query select null::numeric, null::numeric, v_escala;
  elsif v_vigente_anterior is not null and v_vigente_precio is not null and v_vigente_precio < v_escalado then
    -- Promoción vigente más baja que la escala del cliente: gana la promoción; la escala queda como precio anterior.
    return query select v_vigente_precio, v_escalado, v_escala;
  else
    return query select v_escalado, null::numeric, v_escala;
  end if;
end;
$$;

comment on function private.precio_referencia_pedido(uuid, uuid, text, integer) is
  'MSF-176 (B1, D-28): precio de referencia de una línea de la lista de pedido = el que la persona ve en la tienda (ficha con promoción vigente y precio_anterior; con cuenta mayorista, la escala de la cantidad de la línea), sin el descuento de la ficha del cliente. Fuente única de lista_pedido_por_dominio y crear_consulta_pedido. Sin acceso de API.';

revoke execute on function private.precio_referencia_pedido(uuid, uuid, text, integer) from public, anon, authenticated;
