-- F-TDA-12 (MSF-355, épica MSF-167, spec 20261023-120000-tienda-catalogo-y-ficha): catálogo público con
-- filtros, orden y paginación. FR-030, FR-031, FR-032, FR-033, FR-034.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * private.precio_final_publico  -> `private` (lógica interna de precios, sin acceso de roles de API).
--   * private.imagen_publica        -> `private` (respalda la política de lectura de `anon`).
--   * política sobre storage.objects -> infraestructura de plataforma (patrón de `productos-imagenes`).
--   * publico.catalogo_pagina_por_dominio -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Desvíos respecto del plan, con su motivo:
--   * precio_final_publico NO llama a private.alicuota_producto: esa función se acota a
--     private.organizacion_id() (la sesión) y bajo `anon` no devolvería nada. Resuelve la alícuota inline con
--     la misma regla (la propia del producto, si no la de su categoría); el pgTAP de paridad con
--     private.precio_para evita la deriva. Las fórmulas (a_pesos, aplicar_regla_precio, aplicar_iva) son las únicas.
--   * El precio público respeta el interruptor «Precios que ve el cliente» de la empresa (mostrar_con_iva):
--     con IVA = final de precio_para; sin IVA = neto de precio_para (como public.precios_empresa_final.visible_ars).
--   * La política de storage la evalúa `anon`, que no tiene (ni debe tener) USAGE sobre `private`: la política
--     llama a publico.imagen_publica(text), un envoltorio SECURITY DEFINER que delega en private.imagen_publica.
--     `private` queda cerrado para `anon`; el envoltorio devuelve solo un booleano.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer);
--   drop policy productos_imagenes_select_anon on storage.objects;
--   drop function publico.imagen_publica(text);
--   drop function private.imagen_publica(text);
--   drop function private.precio_final_publico(uuid, uuid);

-- ============================================================================
-- FR-030 · precio final público
-- ============================================================================

-- Sin guardia de sesión (la ejecutan las funciones públicas bajo `anon`): el aislamiento lo da quien la
-- llama; igual exige que el producto sea de la organización de la empresa y que la empresa lo tenga
-- asignado (producto_empresa). null si no es calculable (USD sin cotización, sin alícuota con IVA visible).
create or replace function private.precio_final_publico(p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.producto_precios_escala s
      on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = 'x1'
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    cross join lateral (
      select private.aplicar_regla_precio(
               private.a_pesos(coalesce(s.precio, p.precio_lista), p.moneda, p.organizacion_id),
               coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(r.redondeo_pesos, 10)
             ) as neto
    ) x
   where p.id = p_producto;
$$;

comment on function private.precio_final_publico(uuid, uuid) is
  'F-TDA-12: precio público en pesos enteros de un producto para una empresa (regla de la empresa + IVA según su interruptor), con las fórmulas únicas de Precios. null si no es calculable. Sin acceso para anon/authenticated: la usan las funciones públicas.';

revoke execute on function private.precio_final_publico(uuid, uuid) from public, anon, authenticated;

-- ============================================================================
-- FR-031 · acceso público a las imágenes (supuesto D1)
-- ============================================================================

-- true si la ruta es una imagen de un producto efectivamente visible de una tienda activa. Misma regla que
-- private.catalogo_tienda_efectivo (producto activo, no oculto y categoría visible con su padre), escrita
-- inline y por empresa para no calcular el catálogo entero en cada pedido de imagen; el pgTAP verifica la
-- paridad con la visibilidad efectiva.
create or replace function private.imagen_publica(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from dominio.producto_imagenes i
      join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
      join dominio.producto_empresa pe on pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id
      join dominio.tiendas ti on ti.empresa_id = pe.empresa_id and ti.organizacion_id = pe.organizacion_id
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id and e.activa
      left join dominio.productos_tienda pt on pt.empresa_id = e.id and pt.producto_id = p.id
      left join dominio.categorias_tienda ct on ct.empresa_id = e.id and ct.categoria_id = p.categoria_id
      left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
      left join dominio.categorias_tienda cp on cp.empresa_id = e.id and cp.categoria_id = c.padre_id
     where i.ruta = p_ruta
       and p.activo
       and coalesce(pt.visible, true)
       and coalesce(ct.visible, true)
       and coalesce(cp.visible, true)
  );
$$;

comment on function private.imagen_publica(text) is
  'F-TDA-12 (D1): true si la ruta del bucket productos-imagenes es una imagen de un producto efectivamente visible de una tienda activa. Respalda la política de lectura de anon; devuelve solo el booleano.';

revoke execute on function private.imagen_publica(text) from public, anon, authenticated;

-- Envoltorio para la política de `anon` (ver el encabezado): sin USAGE sobre `private`, `anon` no podría
-- evaluarla. Solo devuelve el booleano; `publico` sigue sin tablas.
create or replace function publico.imagen_publica(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.imagen_publica(p_ruta);
$$;

comment on function publico.imagen_publica(text) is
  'F-TDA-12 (D1): envoltorio de private.imagen_publica para la política de lectura de anon sobre el bucket productos-imagenes. Devuelve solo el booleano. Ejecutable por anon y authenticated (se puede llamar directo): permite confirmar si una ruta es imagen pública, algo ya legible igualmente; riesgo aceptado.';

revoke execute on function publico.imagen_publica(text) from public;
grant execute on function publico.imagen_publica(text) to anon, authenticated;

create policy productos_imagenes_select_anon on storage.objects
  for select to anon
  using (
    bucket_id = 'productos-imagenes'
    and (select publico.imagen_publica(name))
  );

-- ============================================================================
-- FR-032, FR-033, FR-034 · página del catálogo
-- ============================================================================

-- Lista blanca de campos: nunca costos, existencias, proveedor ni organizacion_id. Host desconocido y
-- empresa desactivada devuelven lo mismo: null. Tamaño de página: constante única (D3).
create or replace function publico.catalogo_pagina_por_dominio(
  host text,
  categoria uuid default null,
  solo_con_stock boolean default false,
  precio_max numeric default null,
  orden text default 'relevancia',
  pagina integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tamano constant integer := 24;
  v_empresa uuid;
  v_orden text := case when orden in ('relevancia', 'precio_asc', 'precio_desc') then orden else 'relevancia' end;
  v_pagina integer := greatest(coalesce(pagina, 1), 1);
  v_max numeric := case when precio_max is null or precio_max <= 0 then null else precio_max end;
  v_solo boolean := coalesce(solo_con_stock, false);
  v_resultado jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- Los productos de una categoría oculta o ajena no son «efectivos»: la lista sale vacía sin error.
  with prod as (
    select x.producto_id, x.nombre, x.categoria_id, x.destacado,
           private.precio_final_publico(x.producto_id, v_empresa) as precio,
           private.disponible_publico(x.producto_id) as disponible
      from private.catalogo_tienda_efectivo(v_empresa) x
     where x.efectivo and (categoria is null or x.categoria_id = categoria)
  ),
  filtrado as (
    select * from prod f
     where (not v_solo or f.disponible)
       and (v_max is null or (f.precio is not null and f.precio <= v_max))
  ),
  pagina_ord as (
    select f.*
      from filtrado f
     order by
       case when v_orden = 'relevancia' then (case when f.destacado then 0 else 1 end)
            else (case when f.precio is null then 1 else 0 end) end,
       case when v_orden = 'precio_asc' then f.precio end asc,
       case when v_orden = 'precio_desc' then f.precio end desc,
       lower(f.nombre), f.producto_id
     offset ((v_pagina - 1)::bigint * c_tamano) limit c_tamano
  )
  select jsonb_build_object(
           'total', (select count(*) from filtrado),
           'pagina', v_pagina,
           'tamano', c_tamano,
           'categorias', coalesce(publico.categorias_por_dominio(host) -> 'categorias', '[]'::jsonb),
           'productos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.producto_id,
                      'nombre', g.nombre,
                      'precio', g.precio,
                      'disponible', g.disponible,
                      'imagen', (select i.ruta from dominio.producto_imagenes i
                                  where i.producto_id = g.producto_id order by i.posicion limit 1),
                      'categoria_id', g.categoria_id,
                      'destacado', g.destacado
                    ) order by
                      case when v_orden = 'relevancia' then (case when g.destacado then 0 else 1 end)
                           else (case when g.precio is null then 1 else 0 end) end,
                      case when v_orden = 'precio_asc' then g.precio end asc,
                      case when v_orden = 'precio_desc' then g.precio end desc,
                      lower(g.nombre), g.producto_id)
               from pagina_ord g), '[]'::jsonb)
         )
    into v_resultado;
  return v_resultado;
end;
$$;

revoke execute on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) from public;
grant execute on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) to anon, authenticated;

comment on function publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer) is
  'F-TDA-12: página de 24 del catálogo público por host, con filtros (categoría, solo con stock, precio máximo) y orden (relevancia, menor/mayor precio). Parámetros inválidos se normalizan. Lista blanca de campos; null si el dominio no existe o la empresa está desactivada.';
