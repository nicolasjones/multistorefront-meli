-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro», T033. FR-021, FR-023, FR-024; D-28;
-- amenazas 1.4 (enumeración), 1.9 (lecturas baratas y repetidas) y 1.10 (cruce de tenants).
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.lista_pedido_por_dominio -> `publico` (superficie de la tienda; `publico` sigue SIN tablas). Lee el catálogo; solo
--     escribe el contador del limitador de lecturas (`public.limite_pedidos_publicos`, existente, que solo tocan funciones
--     security definer).
--   * private.limite_listas_por_minuto -> `private` (constante, sin acceso de API).
--
-- Reglas del contrato (`contracts/tienda-compra-y-cuentas.md › lista_pedido_por_dominio`):
--   * `anon` y `authenticated`; `security definer`, `search_path = ''`, nombres calificados, SIN SQL dinámico; `revoke … from public, anon`
--     y `grant … to anon, authenticated` explícitos (superficie pública DELIBERADA: se suma a la lista cerrada de `anon` del pgTAP
--     `tienda_capacidades.test.sql`).
--   * La empresa sale SOLO del host. Host desconocido, empresa desactivada y tienda pausada responden `{estado: error}` idéntico, ANTES
--     de validar cualquier otro dato. Con la bandera `tienda_pedidos` apagada: el mismo `error`, sin tocar datos.
--   * Entrada: `private.validar_items_pedido` (`invalido` con `campos = ['items']`); ninguna clave ajena se lee.
--   * `no_disponibles`: producto inexistente, de otra tienda u organización, oculto, inactivo o fuera del catálogo efectivo: todos
--     INDISTINGUIBLES, y no se devuelven en `lineas`.
--   * Precio de referencia: el que ve la persona (`private.precio_referencia_pedido`, D-28), sin el descuento de la ficha del cliente.
--     Con cuenta activa (`private.cuenta_de_tienda`) se usa la escala del tipo del cliente según la cantidad de la línea.
--   * Lista blanca de claves por línea: producto_id, nombre, sku, imagen, cantidad, disponible (sin cantidades de stock), precio_unitario,
--     precio_anterior, escala, subtotal. Nunca costos, márgenes, existencias ni organizacion_id.
--
-- Amenaza 1.9 (decisión de T033): se APLICA el limitador de pedidos públicos de la búsqueda (`private.registrar_pedido_publico`) con su
-- propio cupo (`lista|` + visitante: no se come el de la búsqueda): 30 lecturas por minuto y visitante; el que lo supera recibe
-- `{estado: limite, espera_segundos}` (desvío del contrato, que no preveía `limite` en esta lectura; la pantalla lo trata como error
-- con reintento). Por eso la función es `volatile` (escribe el contador) y no `stable`. Además queda acotada a 50 productos por
-- llamada. `statement_timeout`: no se fija a nivel de función; rige el de los roles de API de Supabase (`anon` 3 s, `authenticated` 8 s),
-- que cubre la evaluación del catálogo efectivo (medida con 50 líneas en el pgTAP `tienda_lista_pedido`).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.lista_pedido_por_dominio(text, jsonb);
--   drop function if exists private.limite_listas_por_minuto();

create or replace function private.limite_listas_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30; $$;

revoke execute on function private.limite_listas_por_minuto() from public, anon, authenticated;

create or replace function publico.lista_pedido_por_dominio(host text, items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_org uuid;
  v_items jsonb;
  v_cuenta record;
  v_tipo text;
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

  -- Con cuenta activa y habilitada en ESTA tienda: la escala del tipo del cliente. Cualquier otro caso (visitante, suspendida, otra
  -- tienda, usuario del panel…) es un visitante: nunca se distingue.
  select * into v_cuenta from private.cuenta_de_tienda(host);
  if found then
    v_tipo := v_cuenta.tipo;
  end if;

  with entrada as (
    select (e.valor ->> 'producto_id')::uuid as producto_id,
           (e.valor ->> 'cantidad')::integer as cantidad,
           e.ord
      from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
  ),
  visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo(v_empresa) x
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
      cross join lateral private.precio_referencia_pedido(pr.id, v_empresa, v_tipo, en.cantidad) p
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
$$;

revoke execute on function publico.lista_pedido_por_dominio(text, jsonb) from public, anon;
grant execute on function publico.lista_pedido_por_dominio(text, jsonb) to anon, authenticated;

comment on function publico.lista_pedido_por_dominio(text, jsonb) is
  'MSF-176 (B1, FR-023, D-28): revalida la lista de pedido (hasta 50 líneas {producto_id, cantidad}) en la tienda del host: por línea nombre, SKU, imagen, disponibilidad (sin stock), precio de referencia del servidor (el que ve la persona; escala del tipo con cuenta activa), precio_anterior y subtotal; no_disponibles indistinguibles; total_referencia. Cupo propio de 30 lecturas por minuto y visitante (limite). {estado: ok|invalido|limite|error}. Superficie pública deliberada (anon y authenticated).';
