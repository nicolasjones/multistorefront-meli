-- F-CAT-15 (MSF-408, épica MSF-229), guardado y lectura de variantes. FR-008, FR-009, FR-012.
-- Esquemas (Principio VII), verificados objeto por objeto:
--   public.guardar_variantes_producto  public (función)  contrato de aplicación (security definer: el evento de
--                                                        actividad solo lo registra una función definer; valida
--                                                        organización y rol `edicion` antes de escribir).
--   public.v_producto_variantes        public (VISTA)    contrato de lectura; no es una tabla.
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.guardar_variantes_producto(uuid, timestamptz, jsonb);
--   drop view public.v_producto_variantes;

create or replace function public.guardar_variantes_producto(
  p_producto uuid,
  p_actualizado_en timestamptz,
  p_variantes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_producto dominio.productos;
  v_items jsonb := coalesce(p_variantes, '[]'::jsonb);
  v_item jsonb;
  v_n integer;
  v_id uuid;
  v_nombre text;
  v_codigo text;
  v_barras text;
  v_activa boolean;
  v_stock integer;
  v_codigos text[] := '{}';
  v_barras_vistos text[] := '{}';
  v_ids_payload uuid[] := '{}';
  v_ids uuid[] := '{}';
  v_stocks integer[] := '{}';
  v_existentes integer;
  v_filas integer;
  v_cambio boolean := false;
  v_actual integer;
  v_actual_deposito integer;
  v_nuevo_deposito integer;
  v_motivo uuid;
  v_deposito uuid;
  v_lista text;
  v_ver_stock boolean;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  -- Serializa guardados del mismo producto y aplica el bloqueo optimista (como actualizar_producto).
  select * into v_producto from dominio.productos p
   where p.id = p_producto and p.organizacion_id = v_org for update;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is not null and v_producto.updated_at <> p_actualizado_en then
    raise exception 'El producto fue modificado por otra persona' using errcode = '40001';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Las variantes deben enviarse como una lista' using errcode = '22023';
  end if;

  -- 1. Validación de cada fila y de repetidos dentro del mismo envío.
  for v_item, v_n in select x.value, x.ordinality::integer from jsonb_array_elements(v_items) with ordinality as x loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada variante debe ser un objeto' using errcode = '22023';
    end if;
    v_nombre := btrim(coalesce(v_item ->> 'nombre', ''));
    v_codigo := btrim(coalesce(v_item ->> 'codigo', ''));
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    if v_nombre = '' then
      raise exception 'La variante % necesita un nombre', v_n using errcode = '22023', detail = 'nombre';
    end if;
    if length(v_nombre) > 120 then
      raise exception 'El nombre de la variante admite hasta 120 caracteres' using errcode = '22023', detail = 'nombre';
    end if;
    if v_codigo = '' then
      raise exception 'La variante "%" necesita un código', v_nombre using errcode = '22023', detail = 'codigo';
    end if;
    if length(v_codigo) > 80 then
      raise exception 'El código de la variante admite hasta 80 caracteres' using errcode = '22023', detail = 'codigo';
    end if;
    if v_barras is not null and v_barras !~ '^[0-9]{13}$' then
      raise exception 'El código de barras "%" debe tener 13 dígitos (EAN-13)', v_barras
        using errcode = '22023', detail = 'codigo_barras';
    end if;
    if lower(v_codigo) = any (v_codigos) then
      raise exception 'El código "%" está repetido entre las variantes', v_codigo using errcode = '23505', detail = 'codigo';
    end if;
    v_codigos := v_codigos || lower(v_codigo);
    if v_barras is not null then
      if v_barras = any (v_barras_vistos) then
        raise exception 'El código de barras "%" está repetido entre las variantes', v_barras
          using errcode = '23505', detail = 'codigo_barras';
      end if;
      v_barras_vistos := v_barras_vistos || v_barras;
    end if;
    if v_item ? 'stock' and jsonb_typeof(v_item -> 'stock') <> 'null' then
      if jsonb_typeof(v_item -> 'stock') <> 'number' or (v_item ->> 'stock')::numeric <> trunc((v_item ->> 'stock')::numeric)
         or (v_item ->> 'stock')::numeric < 0 then
        raise exception 'El stock de "%" debe ser un entero de cero o más', v_nombre using errcode = '22023', detail = 'stock';
      end if;
    end if;
    if nullif(v_item ->> 'id', '') is not null then
      v_ids_payload := v_ids_payload || (v_item ->> 'id')::uuid;
    end if;
  end loop;

  -- 2. Las variantes no se borran: las existentes tienen que venir en el envío.
  select count(*) into v_existentes from dominio.producto_variantes v
   where v.producto_id = p_producto and v.organizacion_id = v_org;
  if exists (select 1 from dominio.producto_variantes v
              where v.producto_id = p_producto and v.organizacion_id = v_org and v.id <> all (v_ids_payload)) then
    raise exception 'Enviá todas las variantes del producto: las que no uses se desactivan, no se borran'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids_payload) as x(id)
              where not exists (select 1 from dominio.producto_variantes v
                                 where v.id = x.id and v.producto_id = p_producto and v.organizacion_id = v_org)) then
    raise exception 'Alguna variante no pertenece a este producto' using errcode = '22023';
  end if;

  -- 3. Decisión 4: la primera variante no se agrega sobre un producto con stock.
  if v_existentes = 0 and jsonb_array_length(v_items) > 0 then
    select e.cantidad into v_actual from dominio.existencias e
     where e.producto_id = p_producto and e.organizacion_id = v_org;
    if coalesce(v_actual, 0) > 0 then
      raise exception 'Este producto tiene % % en stock: dejá el stock del producto en 0 y cargalo en las variantes',
        v_actual, case when v_actual = 1 then 'unidad' else 'unidades' end
        using errcode = '22023', detail = 'primera_variante';
    end if;
  end if;

  -- 4. Choques de código con otras variantes (los choques con productos los corta el disparador, con su mensaje).
  for v_item in select x.value from jsonb_array_elements(v_items) as x loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_codigo := btrim(v_item ->> 'codigo');
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    if exists (select 1 from dominio.producto_variantes v
                where v.organizacion_id = v_org and lower(btrim(v.codigo)) = lower(v_codigo) and v.id is distinct from v_id) then
      raise exception 'El código "%" ya lo usa otra variante', v_codigo using errcode = '23505', detail = 'codigo';
    end if;
    if v_barras is not null and exists (select 1 from dominio.producto_variantes v
                where v.organizacion_id = v_org and v.codigo_barras = v_barras and v.id is distinct from v_id) then
      raise exception 'El código de barras "%" ya lo usa otra variante', v_barras
        using errcode = '23505', detail = 'codigo_barras';
    end if;
  end loop;

  -- 5. Reemplazo completo e idempotente: el orden es la posición.
  for v_item, v_n in select x.value, x.ordinality::integer from jsonb_array_elements(v_items) with ordinality as x loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_nombre := btrim(v_item ->> 'nombre');
    v_codigo := btrim(v_item ->> 'codigo');
    v_barras := nullif(btrim(coalesce(v_item ->> 'codigo_barras', '')), '');
    v_activa := coalesce((v_item ->> 'activa')::boolean, true);
    v_stock := case when v_item ? 'stock' and jsonb_typeof(v_item -> 'stock') = 'number'
                    then (v_item ->> 'stock')::integer end;

    if v_id is null then
      insert into dominio.producto_variantes (organizacion_id, producto_id, nombre, codigo, codigo_barras, activa, orden)
      values (v_org, p_producto, v_nombre, v_codigo, v_barras, v_activa, v_n)
      returning id into v_id;
      v_cambio := true;
    else
      update dominio.producto_variantes v
         set nombre = v_nombre, codigo = v_codigo, codigo_barras = v_barras, activa = v_activa, orden = v_n
       where v.id = v_id and v.producto_id = p_producto and v.organizacion_id = v_org
         and (v.nombre, v.codigo, v.codigo_barras, v.activa, v.orden)
             is distinct from (v_nombre, v_codigo, v_barras, v_activa, v_n);
      get diagnostics v_filas = row_count;
      if v_filas > 0 then
        v_cambio := true;
      end if;
    end if;
    v_ids := v_ids || v_id;
    v_stocks := v_stocks || v_stock;
  end loop;

  -- 6. Stock contado: ajuste en el depósito por defecto, solo si difiere (requiere edición en Stock).
  for v_n in 1 .. coalesce(cardinality(v_ids), 0) loop
    continue when v_stocks[v_n] is null;
    select coalesce(sum(x.cantidad), 0)::integer into v_actual
      from dominio.existencias_variante x where x.variante_id = v_ids[v_n];
    continue when v_actual = v_stocks[v_n];

    if (select private.nivel_seccion('stock')) <> 'edicion' then
      raise exception 'Tu rol no puede ajustar el stock' using errcode = '42501';
    end if;
    select d.id into v_deposito from dominio.depositos d
     where d.organizacion_id = v_org and d.por_defecto and d.activo;
    if v_deposito is null then
      raise exception 'No hay un depósito por defecto activo para cargar el stock' using errcode = '22023';
    end if;
    select m.id into v_motivo from dominio.motivos_movimiento m
     where m.organizacion_id = v_org and m.nombre = 'Conteo de inventario' and m.activo and 'ajuste' = any (m.aplica_a)
     limit 1;
    if v_motivo is null then
      raise exception 'No hay un motivo activo «Conteo de inventario» para ajustar el stock' using errcode = '22023';
    end if;
    select coalesce((select x.cantidad from dominio.existencias_variante x
                      where x.variante_id = v_ids[v_n] and x.deposito_id = v_deposito), 0)
      into v_actual_deposito;
    v_nuevo_deposito := v_actual_deposito + (v_stocks[v_n] - v_actual);
    if v_nuevo_deposito < 0 then
      raise exception 'No se puede dejar el stock en %: hay unidades en otros depósitos', v_stocks[v_n]
        using errcode = '22023', detail = 'stock';
    end if;
    perform public.registrar_movimiento_stock(
      p_producto, 'ajuste', v_nuevo_deposito, v_motivo, null, current_date, v_deposito, null, v_ids[v_n]);
  end loop;

  -- 7. Evento solo con cambio real y con sesión; sin precios ni costo.
  if v_cambio and v_actor is not null then
    select string_agg(v.nombre, ', ' order by v.orden) into v_lista
      from dominio.producto_variantes v where v.producto_id = p_producto and v.organizacion_id = v_org;
    perform private.registrar_actividad(
      'producto.variantes_editadas',
      format('Cambió las variantes de %s%s: %s',
        v_producto.nombre,
        case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end,
        coalesce(v_lista, 'sin variantes')),
      null
    );
  end if;

  v_ver_stock := (select private.nivel_seccion('stock')) in ('lectura', 'edicion');
  return jsonb_build_object(
    'variantes',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'nombre', v.nombre, 'codigo', v.codigo, 'codigo_barras', v.codigo_barras,
        'activa', v.activa, 'orden', v.orden,
        'stock', case when v_ver_stock
                      then (select coalesce(sum(x.cantidad), 0)::integer from dominio.existencias_variante x where x.variante_id = v.id)
                 end
      ) order by v.orden)
      from dominio.producto_variantes v where v.producto_id = p_producto and v.organizacion_id = v_org
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.guardar_variantes_producto(uuid, timestamptz, jsonb) is
  'F-CAT-15: reemplaza las variantes de un producto (idempotente, atómico). Exige edición en productos (42501); P0002 producto inexistente; 40001 si el producto cambió; 23505 código o código de barras repetido (con el valor); 22023 formato EAN-13, nombre vacío, variantes faltantes o primera variante sobre producto con stock. Una fila con stock distinto del actual exige edición en Stock y registra un ajuste «Conteo de inventario». Evento producto.variantes_editadas solo con cambio real.';

revoke execute on function public.guardar_variantes_producto(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.guardar_variantes_producto(uuid, timestamptz, jsonb) to authenticated;

-- ============================================================================
-- Lectura (FR-009): sin precio ni costo; producto_id para que Precios resuelva por producto.
-- ============================================================================

create view public.v_producto_variantes
with (security_invoker = true) as
select
  v.id,
  v.producto_id,
  v.nombre,
  v.codigo,
  v.codigo_barras,
  v.activa,
  v.orden,
  case when (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
       then (select coalesce(sum(x.cantidad), 0)::integer from dominio.existencias_variante x where x.variante_id = v.id)
  end as stock
from dominio.producto_variantes v
order by v.producto_id, v.orden;

comment on view public.v_producto_variantes is
  'F-CAT-15: variantes de cada producto (id, producto_id, nombre, código, código de barras, activa, orden, stock). stock es nulo sin acceso a Stock. Sin precio ni costo: el precio es el del producto (private.precio_para por producto_id). security_invoker: rige la RLS.';

revoke all on public.v_producto_variantes from public, anon;
grant select on public.v_producto_variantes to authenticated;
