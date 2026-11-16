-- F-API-01 (MSF-403, FR-004, FR-006, SC-001): lecturas aisladas por
-- organización para la API pública.
--
-- Esquema (Principio VII): sin tablas nuevas. Las funciones viven en `private`
-- (superficie interna) y se exposedn al Service Role mediante envoltorios en
-- `public`: PostgREST no expone el esquema `private` (ver `[api] schemas` en
-- supabase/config.toml), así que la Edge Function `api-v1` no podría llamarlas
-- si vivieran solo ahí.
--
-- AISLAMIENTO (FR-006): el filtro de organización se arma DENTRO del SQL, no
-- en TypeScript. Cada función recibe `p_organizacion_id` —que la Edge Function
-- deriva de la clave, nunca de un parámetro del llamador— y filtra por él.
-- Como son `security definer`, la RLS de las tablas base no aplica: el filtro
-- explícito es el único que protege los datos.
--
-- El precio que se expone es `precio_lista` con su moneda: ni precio final
-- por empresa ni IVA (fuera del alcance de la épica).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   revoke execute on function public.api_leer_productos(uuid, text, integer, timestamptz) from service_role;
--   ... (idem api_leer_stock, api_leer_precios, api_leer_ventas)
--   drop function public.api_leer_productos(uuid, text, integer, timestamptz);
--   ... (idem las otras tres)
--   drop function private.api_leer_productos(uuid, text, integer, timestamptz);
--   ... (idem las otras tres)
--   drop function private.api_decodificar_cursor(text);
--   drop function private.api_codificar_cursor(timestamptz, uuid, uuid);

-- ============================================================================
-- Cursor opaco: base64url de «micros_desde_epoch|uuid[|uuid]».
-- El cliente lo trata como una cadena sinmeaningido; el servidor decide qué
-- clave guarda en cada recurso (producto, venta o producto+depósito).
-- ============================================================================

create or replace function private.api_codificar_cursor(
  p_fecha timestamptz,
  p_id uuid,
  p_extra uuid default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select rtrim(
    translate(
      encode(
        convert_to(
          (extract(epoch from p_fecha) * 1000000)::bigint::text || '|' || p_id::text ||
          case when p_extra is null then '' else '|' || p_extra::text end,
          'UTF8'
        ),
        'base64'
      ),
      '+/', '-_'
    ),
    '='
  );
$$;

create or replace function private.api_decodificar_cursor(p_cursor text)
returns table (p_clave text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bruto text;
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;

  -- Un cursor que no es base64 ni UTF-8 válido (por ejemplo `abc` o `____`) es un cursor inválido (400), no un error interno (500).
  begin
    v_bruto := convert_from(
      decode(rpad(translate(p_cursor, '-_', '+/'), (length(p_cursor) + 3) / 4 * 4, '='), 'base64'),
      'UTF8'
    );
  exception when others then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end;

  if position('|' in v_bruto) = 0 then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end if;

  p_clave := v_bruto;
end;
$$;

revoke execute on function private.api_codificar_cursor(timestamptz, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.api_decodificar_cursor(text) from public, anon, authenticated;

-- ============================================================================
-- Productos: catálogo de la organización.
-- ============================================================================

create or replace function private.api_leer_productos(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_clave text;
  v_partes text[];
  v_fecha timestamptz;
  v_id uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select d.p_clave into v_clave from private.api_decodificar_cursor(p_cursor) d;
  if v_clave is not null then
    v_partes := string_to_array(v_clave, '|');
    if array_length(v_partes, 1) is distinct from 2 then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end if;
    begin
      v_fecha := timestamptz 'epoch' + v_partes[1]::numeric * interval '1 microsecond';
      v_id := v_partes[2]::uuid;
    exception when others then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end;
  end if;

  with pagina as (
    select p.id, p.nombre, p.sku, p.activo, p.categoria_id,
      (select private.ruta_categoria(p.categoria_id)) as categoria,
      p.moneda, p.precio_lista, p.updated_at as actualizado_en
      from dominio.productos p
     where p.organizacion_id = p_organizacion_id
       and (p_actualizado_desde is null or p.updated_at >= p_actualizado_desde)
       and (v_id is null or (p.updated_at, p.id) > (v_fecha, v_id))
     order by p.updated_at, p.id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.id)
           from recortada r order by r.actualizado_en desc, r.id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

-- ============================================================================
-- Stock: cantidad, reservado y disponible por producto y depósito.
-- La clave del cursor es producto+depósito (la fila es la pareja).
-- ============================================================================

create or replace function private.api_leer_stock(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_clave text;
  v_partes text[];
  v_fecha timestamptz;
  v_id uuid;
  v_deposito uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select d.p_clave into v_clave from private.api_decodificar_cursor(p_cursor) d;
  if v_clave is not null then
    v_partes := string_to_array(v_clave, '|');
    if array_length(v_partes, 1) is distinct from 3 then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end if;
    begin
      v_fecha := timestamptz 'epoch' + v_partes[1]::numeric * interval '1 microsecond';
      v_id := v_partes[2]::uuid;
    exception when others then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end;
    v_deposito := v_partes[3]::uuid;
  end if;

  with pagina as (
    select e.producto_id, pr.nombre, pr.sku, e.deposito_id, dep.nombre as deposito,
      e.cantidad, e.reservado, e.cantidad - e.reservado as disponible,
      e.updated_at as actualizado_en
      from dominio.existencias_deposito e
      join dominio.productos pr
        on pr.id = e.producto_id and pr.organizacion_id = e.organizacion_id
      join dominio.depositos dep
        on dep.id = e.deposito_id and dep.organizacion_id = e.organizacion_id
     where e.organizacion_id = p_organizacion_id
       and (p_actualizado_desde is null or e.updated_at >= p_actualizado_desde)
       and (v_id is null or (e.updated_at, e.producto_id, e.deposito_id) > (v_fecha, v_id, v_deposito))
     order by e.updated_at, e.producto_id, e.deposito_id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.producto_id, r.deposito_id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.producto_id, r.deposito_id)
           from recortada r order by r.actualizado_en desc, r.producto_id desc, r.deposito_id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

-- ============================================================================
-- Precios: precio de lista y escalas x5/x10/x50 (nulo si la escala no tiene
-- precio cargado).
-- ============================================================================

create or replace function private.api_leer_precios(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_clave text;
  v_partes text[];
  v_fecha timestamptz;
  v_id uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select d.p_clave into v_clave from private.api_decodificar_cursor(p_cursor) d;
  if v_clave is not null then
    v_partes := string_to_array(v_clave, '|');
    if array_length(v_partes, 1) is distinct from 2 then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end if;
    begin
      v_fecha := timestamptz 'epoch' + v_partes[1]::numeric * interval '1 microsecond';
      v_id := v_partes[2]::uuid;
    exception when others then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end;
  end if;

  -- `actualizado_en` es lo ÚLTIMO que cambió del producto: él o cualquiera de sus escalas (un cambio solo de escala no toca
  -- `productos.updated_at` y la sincronización incremental lo perdía aunque se emitiera `precio.actualizado`). El filtro
  -- `actualizado_desde` y el cursor usan ese mismo valor.
  with base as (
    select p.id as producto_id, p.nombre, p.sku, p.moneda, p.precio_lista,
      max(e.precio) filter (where e.escala = 'x5') as precio_x5,
      max(e.precio) filter (where e.escala = 'x10') as precio_x10,
      max(e.precio) filter (where e.escala = 'x50') as precio_x50,
      greatest(p.updated_at, coalesce(max(e.updated_at), p.updated_at)) as actualizado_en
      from dominio.productos p
      left join dominio.producto_precios_escala e
        on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
     where p.organizacion_id = p_organizacion_id
     group by p.id, p.nombre, p.sku, p.moneda, p.precio_lista, p.updated_at
  ), pagina as (
    select b.*
      from base b
     where (p_actualizado_desde is null or b.actualizado_en >= p_actualizado_desde)
       and (v_id is null or (b.actualizado_en, b.producto_id) > (v_fecha, v_id))
     order by b.actualizado_en, b.producto_id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.producto_id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.producto_id)
           from recortada r order by r.actualizado_en desc, r.producto_id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

-- ============================================================================
-- Ventas: solo facturas confirmadas. No expone cliente ni contacto.
-- ============================================================================

create or replace function private.api_leer_ventas(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_clave text;
  v_partes text[];
  v_fecha timestamptz;
  v_id uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select d.p_clave into v_clave from private.api_decodificar_cursor(p_cursor) d;
  if v_clave is not null then
    v_partes := string_to_array(v_clave, '|');
    if array_length(v_partes, 1) is distinct from 2 then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end if;
    begin
      v_fecha := timestamptz 'epoch' + v_partes[1]::numeric * interval '1 microsecond';
      v_id := v_partes[2]::uuid;
    exception when others then
      raise exception 'CURSOR_INVALIDO' using errcode = '22023';
    end;
  end if;

  with pagina as (
    select c.id, c.numero, c.fecha, c.empresa_id, c.total_sin_iva, c.total_con_iva, c.estado,
      c.confirmado_en
      from dominio.comprobantes_venta c
     where c.organizacion_id = p_organizacion_id
       and c.tipo = 'factura'
       -- Confirmada (con `confirmado_en`) y no anulada, en cualquier estado posterior: una factura confirmada que pasa a
       -- cobrado, deuda, aceptado, en proceso o armando sigue siendo una venta y NO desaparece de la API.
       and c.confirmado_en is not null
       and c.estado <> 'anulada'
       and (p_actualizado_desde is null or c.confirmado_en >= p_actualizado_desde)
       and (v_id is null or (c.confirmado_en, c.id) > (v_fecha, v_id))
     order by c.confirmado_en, c.id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.confirmado_en, r.id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.confirmado_en, r.id)
           from recortada r order by r.confirmado_en desc, r.id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

revoke execute on function private.api_leer_productos(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function private.api_leer_stock(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function private.api_leer_precios(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function private.api_leer_ventas(uuid, text, integer, timestamptz) from public, anon, authenticated;

-- ============================================================================
-- Envoltorios en `public`: la Edge Function `api-v1` los llama por PostgREST.
-- Solo el Service Role los ejecuta; la organización la pone la clave.
-- ============================================================================

create or replace function public.api_leer_productos(
  p_organizacion_id uuid, p_cursor text, p_limite integer, p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language sql
security definer
set search_path = ''
as $$
  select * from private.api_leer_productos(p_organizacion_id, p_cursor, p_limite, p_actualizado_desde);
$$;

create or replace function public.api_leer_stock(
  p_organizacion_id uuid, p_cursor text, p_limite integer, p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language sql
security definer
set search_path = ''
as $$
  select * from private.api_leer_stock(p_organizacion_id, p_cursor, p_limite, p_actualizado_desde);
$$;

create or replace function public.api_leer_precios(
  p_organizacion_id uuid, p_cursor text, p_limite integer, p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language sql
security definer
set search_path = ''
as $$
  select * from private.api_leer_precios(p_organizacion_id, p_cursor, p_limite, p_actualizado_desde);
$$;

create or replace function public.api_leer_ventas(
  p_organizacion_id uuid, p_cursor text, p_limite integer, p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language sql
security definer
set search_path = ''
as $$
  select * from private.api_leer_ventas(p_organizacion_id, p_cursor, p_limite, p_actualizado_desde);
$$;

comment on function public.api_leer_productos(uuid, text, integer, timestamptz) is
  'F-API-01: lee el catálogo de la organización indicada (el filtro de organización va dentro del SQL). Solo service_role.';

revoke execute on function public.api_leer_productos(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.api_leer_stock(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.api_leer_precios(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.api_leer_ventas(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.api_leer_productos(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.api_leer_stock(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.api_leer_precios(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.api_leer_ventas(uuid, text, integer, timestamptz) to service_role;
