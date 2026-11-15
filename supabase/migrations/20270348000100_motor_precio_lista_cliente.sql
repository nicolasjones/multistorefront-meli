-- F-CLI-21 (MSF-453, épica MSF-450, spec 20270327-100000-listas-de-precios-por-cliente, Fase 3, T015): el motor de precio aplica la
-- lista del cliente. ESTA MIGRACIÓN CAMBIA LO QUE SE COBRA, pero solo con la bandera `listas_precios` ENCENDIDA y para un cliente con
-- una lista activa; con la bandera apagada (estado de nacimiento en todos los entornos) el resultado es BIT A BIT el de
-- `20270322100000` (pgTAP `precio_lista_cliente.test.sql`, bloque de paridad contra una copia del cálculo anterior).
--
-- Esquemas (Principio VII): sin tablas nuevas; todo cálculo en `private`, sin `execute` para ningún rol de la API.
--
-- Cuerpos de partida (verificados contra la definición VIVA de dev: iguales, sin deriva): `private.precio_para_calculo`,
-- `private.precio_linea_venta_calculo` y `private.precio_linea_venta` de 20270322100000 (que a su vez extraen de 20270213200002 y
-- 20270310100100). `private.precio_para` y `private.precio_sesion_alcanza` NO se tocan.
--
-- Precedencia de la línea (D5, de la más específica a la menos), en UN solo lugar:
--   1. precio manual de la línea (lo resuelve `guardar_lineas_comprobante`; no pasa por el motor);
--   2. escala x5/x10/x50 cargada en el producto y elegida por el tipo y la cantidad (F-PRE-15);
--   3. precio propio del producto en la tienda (F-PRE-08);
--   4. LISTA del cliente (D3): `central_en_pesos × (1 + ajuste/100)`, redondeo de la tienda, SIN IVA; REEMPLAZA el ajuste de la tienda;
--   5. regla de la tienda (hoy).
-- Sobre el neto, el descuento personal (D6: NO se aplica si el precio lo fijó la lista) y, al final, la promoción (D7: gana solo si es
-- estrictamente menor al precio normal, que ya incluye la lista; `precio_referencia` = precio de lista).
--
-- Cambios de firma (necesarios: una función con un parámetro más y columnas de retorno más NO se puede `create or replace` sobre la
-- anterior sin crear una sobrecarga ambigua para quien llama con los argumentos de antes):
--   · `private.precio_para_calculo(producto, empresa, escala)` -> `(…, p_cliente uuid default null)` y dos columnas AL FINAL:
--     `lista_precio_id`, `lista_ajuste_pct` (solo con valor si la lista fijó el neto);
--   · `private.precio_linea_venta_calculo(…7 args)` y `private.precio_linea_venta(…7 args)` -> `(…, p_cliente uuid default null)` y las
--     mismas dos columnas al final.
-- Todos los llamadores vigentes pasan los argumentos de antes y siguen resolviendo (el parámetro nuevo tiene valor por omisión; las
-- columnas nuevas van al final). Mismos grants que antes: ninguno para `public`, `anon`, `authenticated`, `service_role` salvo lo que
-- cada función ya tenía (`precio_para` conserva `execute` de `authenticated`; no se redefine).
--
-- `private.lista_precios_cliente(cliente, organización)`: la lista que rige hoy para el cliente; sin filas si la bandera está apagada,
-- el cliente no existe en esa organización, es el Consumidor final, no tiene lista o la lista está archivada. Es el ÚNICO punto donde
-- se lee la bandera `listas_precios` y la lista del cliente (el motor de la tienda y el del mostrador llaman a esta misma función).
--
-- Migración aditiva en datos (no toca ninguna fila). Reversión operativa inmediata, SIN migrar: apagar la bandera `listas_precios`.
-- Reversión de código (migración posterior): restaurar los tres cuerpos de 20270322100000 (con `drop function` de las firmas nuevas) y
--   drop function private.lista_precios_cliente(uuid, uuid);

-- ============================================================================
-- La lista que rige para un cliente
-- ============================================================================

create or replace function private.lista_precios_cliente(p_cliente uuid, p_organizacion uuid)
returns table (lista_id uuid, ajuste_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.ajuste_pct
    from public.clientes c
    join dominio.listas_precios l on l.id = c.lista_precio_id and l.organizacion_id = c.organizacion_id
   where p_cliente is not null
     and c.id = p_cliente
     and c.organizacion_id = p_organizacion
     and not c.es_consumidor_final
     and l.archivada_en is null
     and (select private.bandera_activa('listas_precios'));
$$;

revoke execute on function private.lista_precios_cliente(uuid, uuid) from public, anon, authenticated, service_role;

comment on function private.lista_precios_cliente(uuid, uuid) is
  'F-CLI-21 (D13): lista de precios vigente del cliente (id y ajuste). Sin filas con la bandera listas_precios apagada, cliente ajeno a la organización, Consumidor final, sin lista o lista archivada. Única lectura de bandera y lista del motor. Sin execute para la API.';

-- ============================================================================
-- Cálculo del precio por escala (con la lista del cliente)
-- ============================================================================

drop function if exists private.precio_para_calculo(uuid, uuid, text);

create or replace function private.precio_para_calculo(
  p_producto uuid,
  p_empresa uuid,
  p_escala text default 'x1',
  p_cliente uuid default null
)
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric,
  lista_precio_id uuid,
  lista_ajuste_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;

  return query
  select
    x.usada,
    x.neto,
    al.id,
    al.nombre,
    al.porcentaje,
    coalesce(al.exento, false),
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false)),
    case when x.por_lista and x.neto is not null then lp.lista_id end,
    case when x.por_lista and x.neto is not null then lp.ajuste_pct end
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  left join dominio.producto_precios_escala s
    on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
  left join dominio.precios_propios_empresa pp
    on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
  left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
  left join dominio.alicuotas_iva al
    on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
  left join lateral private.lista_precios_cliente(p_cliente, p.organizacion_id) lp on true
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      -- La lista rige solo si no hay escala cargada (paso 2) ni precio propio (paso 3): D5.
      (lp.lista_id is not null
        and not (pp.moneda is not null and (p_escala = 'x1' or s.precio is null))
        and not (s.precio is not null and p_escala <> 'x1')) as por_lista,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null)
          then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
        when lp.lista_id is not null and not (s.precio is not null and p_escala <> 'x1')
          then private.aplicar_regla_precio(
                 private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
                 'central_ajuste', lp.ajuste_pct, coalesce(r.redondeo_pesos, 10))
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  where p.id = p_producto;
end;
$$;

revoke execute on function private.precio_para_calculo(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

comment on function private.precio_para_calculo(uuid, uuid, text, uuid) is
  'MSF-176 B2 (D-17) + F-CLI-21: neto, alícuota y final de un producto para una empresa, una escala y (opcional) un cliente, SIN depender de la sesión de panel. Precedencia D5: escala cargada, precio propio, lista del cliente (central × (1 + ajuste), redondeo de la tienda; reemplaza el ajuste de la tienda), regla de la tienda. Las dos últimas columnas dicen qué lista fijó el neto. Sin cliente o con la bandera listas_precios apagada es idéntica a la versión anterior. Sin execute para la API.';

-- ============================================================================
-- Cálculo del precio de línea (gana el más bajo, sin acumular), con la lista del cliente
-- ============================================================================

drop function if exists private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean);

create or replace function private.precio_linea_venta_calculo(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true,
  p_cliente uuid default null
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  lista_precio_id uuid,
  lista_ajuste_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_pr_id uuid;
  v_pr_precio numeric;
  v_d numeric;
  v_normal numeric;
begin
  select * into v_p
    from private.precio_para_calculo(p_producto, p_empresa, private.escala_para_linea(p_tipo_cliente, p_cantidad), p_cliente);
  if not found then
    return;
  end if;

  -- Precio normal de la línea: la misma expresión de siempre. D6: si el precio lo fijó la lista, el descuento personal NO se aplica.
  v_d := case when p_aplicar_descuento and v_p.lista_precio_id is null then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_p.neto * (1 - v_d / 100), 2);

  -- La promoción solo se consulta cuando el precio normal existe (una sola búsqueda indexada por línea).
  if v_normal is not null then
    select f.promocion_id, f.precio into v_pr_id, v_pr_precio
      from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora) f;
  end if;

  -- D7: gana el más bajo, sin acumular; la promoción solo si es ESTRICTAMENTE menor al precio normal (que ya incluye la lista).
  if v_normal is not null and v_pr_precio is not null and v_pr_precio < v_normal then
    return query select v_p.escala_usada, v_pr_precio, v_normal, v_pr_id, 0::numeric,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta, v_p.lista_precio_id, v_p.lista_ajuste_pct;
  else
    return query select v_p.escala_usada, v_normal, null::numeric, null::uuid, v_d,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta, v_p.lista_precio_id, v_p.lista_ajuste_pct;
  end if;
end;
$$;

revoke execute on function private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)
  from public, anon, authenticated, service_role;

comment on function private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid) is
  'MSF-816 + F-CLI-21: precio de línea de venta SIN depender de la sesión de panel. Gana el más bajo sin acumular: precio normal (escala/propio/lista del cliente/regla de la tienda con su descuento personal, que NO se aplica si rige la lista) o promoción vigente si es estrictamente menor. Devuelve además la lista que fijó el precio normal (snapshot de la línea, también cuando gana la promoción). Con p_cliente nulo o la bandera listas_precios apagada es idéntica a la versión anterior. Sin execute para la API.';

-- ============================================================================
-- Envoltorio de la sesión de panel
-- ============================================================================

drop function if exists private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean);

create or replace function private.precio_linea_venta(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true,
  p_cliente uuid default null
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  lista_precio_id uuid,
  lista_ajuste_pct numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- Falla cerrada: solo un `true` explícito deja pasar (un nulo cierra).
  if (select private.precio_sesion_alcanza(p_producto, p_empresa)) is not true then
    return;
  end if;

  return query
  select c.escala_usada, c.neto_unitario, c.precio_referencia, c.promocion_id, c.descuento_aplicado,
         c.alicuota_id, c.alicuota_porcentaje, c.alicuota_exenta, c.lista_precio_id, c.lista_ajuste_pct
    from private.precio_linea_venta_calculo(p_producto, p_empresa, p_tipo_cliente, p_cantidad, p_descuento, p_ahora, p_aplicar_descuento, p_cliente) c;
end;
$$;

revoke execute on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid)
  from public, anon, authenticated;

comment on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean, uuid) is
  'MSF-816 + F-CLI-21: precio de línea de venta. Gana el más bajo sin acumular: precio normal (escala/propio/lista del cliente/regla de la tienda) o promoción vigente de la tienda del comprobante (bandera promociones_precio). Devuelve referencia y promoción solo si ganó la promoción, y la lista que fijó el precio normal. No pasa por acá el precio manual. Envoltorio con la compuerta de la sesión de panel sobre precio_linea_venta_calculo.';
