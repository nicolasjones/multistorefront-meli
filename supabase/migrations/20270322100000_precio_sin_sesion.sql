-- MSF-176 · Tienda compra y cuentas, historia B2 «Presupuesto desde la tienda», T050 (etapa 1). D-17, FR-053, SC-003.
--
-- Qué hace: EXTRAE el cálculo de precio de línea de la sesión de panel, SIN cambiar el comportamiento de lo existente, para que
-- el presupuesto que arma la tienda (B2) use la MISMA fórmula que el panel y no un motor propio.
--
-- Por qué hace falta (D-17, verificado en el código de `dokploy`):
--   1. `private.precio_para` devuelve vacío si la sesión no tiene `empresas` o `ventas` en lectura/edición: un cliente web no tiene ninguna.
--   2. Aun llamada desde una función `security definer`, dos piezas internas leen la SESIÓN DE PANEL y fallan EN SILENCIO sin ella:
--      `private.alicuota_producto` filtra por `private.organizacion_id()` (nulo para el cliente: sin alícuota, IVA 0) y
--      `private.precio_propio_empresa` filtra por `private.organizacion_id()` cuando hay `auth.uid()` (ignora el precio propio).
--
-- Funciones NUEVAS (sin `execute` para `public`, `anon`, `authenticated` ni `service_role`: solo las llaman funciones `security
-- definer` del propio esquema `private`):
--   * `private.precio_para_calculo(producto, empresa, escala)`: la lógica de `precio_para` SIN la compuerta de sesión.
--     `security definer`, `search_path = ''`. El aislamiento por organización lo da la EMPRESA (`e.organizacion_id = p.organizacion_id`
--     y todas las tablas hijas por esa misma organización), no `private.organizacion_id()`. La alícuota sale por join (la misma regla
--     que `alicuota_producto`: la propia o la de la categoría) y el precio propio por `private.neto_precio_propio` (la misma regla
--     que `precio_propio_empresa`: ARS tal cual; USD × la cotización de la empresa, a 2 decimales).
--   * `private.precio_linea_venta_calculo(...)`: la lógica de `precio_linea_venta` (gana el más bajo, sin acumular) sobre aquélla y sobre
--     `private.promocion_vigente_fila`. Misma firma y mismas columnas que `precio_linea_venta`.
--   * `private.precio_sesion_alcanza(producto, empresa)`: la COMPUERTA y el AISLAMIENTO de la sesión de panel, en un solo lugar:
--     `empresas` o `ventas` en lectura/edición, y producto y empresa de la organización de la sesión. Devuelve boolean.
--
-- Funciones que CAMBIAN (misma firma, mismas columnas, mismos grants; el resultado es el mismo para la sesión de panel):
--   * `private.precio_para`: pasa a ser un ENVOLTORIO: valida la escala (22023, antes que nada, como hoy), pregunta a
--     `precio_sesion_alcanza` y delega en `precio_para_calculo`. Antes era `security invoker` y el aislamiento por organización lo
--     daba la RLS de las tablas que leía; como ya no las lee con la identidad del llamador, lo da `precio_sesion_alcanza`
--     (organización de la sesión), y el envoltorio pasa a `security definer` para poder llamar a la función de cálculo (que no tiene
--     `execute` para `authenticated`; `precio_para` SÍ lo conserva). Las funciones que lo llaman en producción ya son `security
--     definer` y no estaban sujetas a la RLS de esas tablas; `private` no está expuesto por la API.
--   * `private.precio_linea_venta`: pasa a ser un ENVOLTORIO que sigue siendo `security invoker`, sin `execute` para `authenticated`
--     (lo prueban los pgTAP vigentes): `precio_sesion_alcanza` y delega en `precio_linea_venta_calculo`.
--
-- Única diferencia deliberada (caso degenerado, sin llamador real): un producto o una empresa de OTRA organización respecto de la
-- sesión. Antes, llamado desde una función `security definer` (sin RLS), devolvía el neto SIN alícuota y SIN precio propio (el mismo
-- fallo silencioso); ahora devuelve vacío, como ya devolvía con la RLS de una sesión directa. Los pgTAP lo fijan.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla; lógica de cálculo sin datos, todo en `private`.
-- Migración aditiva (`create or replace`, mismas firmas). Coordinación: ninguna rama abierta redefine estas funciones.
-- Reversión (migración posterior; no se ejecuta en el mismo PR): restaurar `private.precio_para` al cuerpo de `20270213200002` (con
-- `grant execute ... to authenticated`) y `private.precio_linea_venta` al de `20270310100100`; luego
--   drop function if exists private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean);
--   drop function if exists private.precio_para_calculo(uuid, uuid, text);
--   drop function if exists private.precio_sesion_alcanza(uuid, uuid);

-- ============================================================================
-- Compuerta y aislamiento de la sesión de panel (los comparte cada envoltorio)
-- ============================================================================

create or replace function private.precio_sesion_alcanza(p_producto uuid, p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ((select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
          or (select private.nivel_seccion('ventas')) in ('lectura', 'edicion'))
     and exists (
           select 1
             from dominio.productos p
             join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
            where p.id = p_producto
              and e.organizacion_id = (select private.organizacion_id())
         );
$$;

revoke execute on function private.precio_sesion_alcanza(uuid, uuid) from public, anon, authenticated, service_role;

comment on function private.precio_sesion_alcanza(uuid, uuid) is
  'MSF-176 B2 (D-17): compuerta y aislamiento de la sesión de panel para los envoltorios de precio: empresas o ventas en lectura/edición y producto y empresa de la organización de la sesión. Sin execute para la API.';

-- ============================================================================
-- Cálculo del precio por escala, sin sesión de panel
-- ============================================================================

create or replace function private.precio_para_calculo(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
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
    private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
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
  cross join lateral (
    select
      case when s.precio is not null and p_escala <> 'x1' then p_escala else 'x1' end as usada,
      case
        when pp.moneda is not null and (p_escala = 'x1' or s.precio is null)
          then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
        else private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id, e.id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10))
      end as neto
  ) x
  where p.id = p_producto;
end;
$$;

revoke execute on function private.precio_para_calculo(uuid, uuid, text) from public, anon, authenticated, service_role;

comment on function private.precio_para_calculo(uuid, uuid, text) is
  'MSF-176 B2 (D-17): neto, alícuota y final de un producto para una empresa y una escala, SIN depender de la sesión de panel: acotado por la organización de la empresa (alícuota por join, precio propio con neto_precio_propio). Misma fórmula que precio_para. Sin execute para la API; lo llaman precio_para y la tienda.';

-- ============================================================================
-- Cálculo del precio de línea (gana el más bajo, sin acumular), sin sesión de panel
-- ============================================================================

create or replace function private.precio_linea_venta_calculo(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean
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
    from private.precio_para_calculo(p_producto, p_empresa, private.escala_para_linea(p_tipo_cliente, p_cantidad));
  if not found then
    return;
  end if;

  -- Precio normal de la línea: la misma expresión de `precio_linea_venta` (y, antes, de guardar_lineas_comprobante).
  v_d := case when p_aplicar_descuento then coalesce(p_descuento, 0) else 0 end;
  v_normal := round(v_p.neto * (1 - v_d / 100), 2);

  -- La promoción solo se consulta cuando el precio normal existe (una sola búsqueda indexada por línea).
  if v_normal is not null then
    select f.promocion_id, f.precio into v_pr_id, v_pr_precio
      from private.promocion_vigente_fila(p_producto, p_empresa, p_ahora) f;
  end if;

  if v_normal is not null and v_pr_precio is not null and v_pr_precio < v_normal then
    return query select v_p.escala_usada, v_pr_precio, v_normal, v_pr_id, 0::numeric,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  else
    return query select v_p.escala_usada, v_normal, null::numeric, null::uuid, v_d,
      v_p.alicuota_id, v_p.alicuota_porcentaje, v_p.alicuota_exenta;
  end if;
end;
$$;

revoke execute on function private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean)
  from public, anon, authenticated, service_role;

comment on function private.precio_linea_venta_calculo(uuid, uuid, text, integer, numeric, timestamptz, boolean) is
  'MSF-176 B2 (D-17): precio de línea de venta SIN depender de la sesión de panel (la fórmula única de MSF-816: gana el más bajo sin acumular, promoción vigente de la tienda). Misma firma y columnas que precio_linea_venta. Sin execute para la API; la llama el panel (por su envoltorio) y la tienda con el tipo y el descuento del cliente de la cuenta.';

-- ============================================================================
-- Envoltorios: `precio_para` y `precio_linea_venta` (misma firma, mismos grants, mismo resultado)
-- ============================================================================

create or replace function private.precio_para(p_producto uuid, p_empresa uuid, p_escala text default 'x1')
returns table (
  escala_usada text,
  neto numeric,
  alicuota_id uuid,
  alicuota_nombre text,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean,
  final numeric
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
  if not (select private.precio_sesion_alcanza(p_producto, p_empresa)) then
    return;
  end if;

  return query
  select c.escala_usada, c.neto, c.alicuota_id, c.alicuota_nombre, c.alicuota_porcentaje, c.alicuota_exenta, c.final
    from private.precio_para_calculo(p_producto, p_empresa, p_escala) c;
end;
$$;

revoke execute on function private.precio_para(uuid, uuid, text) from public, anon;
grant execute on function private.precio_para(uuid, uuid, text) to authenticated;

comment on function private.precio_para(uuid, uuid, text) is
  'F-PRE-15: neto, alícuota y final de un producto para una empresa y una escala (x1/x5/x10/x50). Escala sin precio → lista (escala_usada = x1); escala inexistente → 22023. No consulta tipos_cliente. F-VTA-06: la compuerta acepta empresas o ventas (lectura o edición). MSF-176 B2 (D-17): envoltorio con la compuerta y el aislamiento de la sesión de panel (precio_sesion_alcanza) sobre precio_para_calculo.';

create or replace function private.precio_linea_venta(
  p_producto uuid,
  p_empresa uuid,
  p_tipo_cliente text,
  p_cantidad integer,
  p_descuento numeric default 0,
  p_ahora timestamptz default now(),
  p_aplicar_descuento boolean default true
)
returns table (
  escala_usada text,
  neto_unitario numeric,
  precio_referencia numeric,
  promocion_id uuid,
  descuento_aplicado numeric,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  alicuota_exenta boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (select private.precio_sesion_alcanza(p_producto, p_empresa)) then
    return;
  end if;

  return query
  select c.escala_usada, c.neto_unitario, c.precio_referencia, c.promocion_id, c.descuento_aplicado,
         c.alicuota_id, c.alicuota_porcentaje, c.alicuota_exenta
    from private.precio_linea_venta_calculo(p_producto, p_empresa, p_tipo_cliente, p_cantidad, p_descuento, p_ahora, p_aplicar_descuento) c;
end;
$$;

revoke execute on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean)
  from public, anon, authenticated;

comment on function private.precio_linea_venta(uuid, uuid, text, integer, numeric, timestamptz, boolean) is
  'MSF-816: precio de línea de venta. Gana el más bajo sin acumular: precio normal (escala/propio/lista con su descuento) o promoción vigente de la tienda del comprobante (bandera promociones_precio). Devuelve referencia y promoción solo si ganó la promoción. No pasa por acá el precio manual. MSF-176 B2 (D-17): envoltorio con la compuerta de la sesión de panel sobre precio_linea_venta_calculo.';
