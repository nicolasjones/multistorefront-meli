-- MSF-176 · Tienda compra y cuentas, historia A «Mi cuenta» (F-CLI-20 · MSF-452), T011. FR-007 a FR-010, FR-014, D-2, D-11.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.cambiar_favorito_por_dominio / mis_favoritos_por_dominio / favoritos_entre_por_dominio -> `publico`
--     (superficie de la tienda; `publico` sigue SIN tablas). Leen y escriben `dominio.favoritos_cliente`, que no tiene
--     privilegios de API.
--
-- Reglas comunes (contrato `contracts/tienda-compra-y-cuentas.md`):
--   * `security definer`, `search_path = ''`, nombres calificados, SIN SQL dinámico.
--   * Orden de verificaciones: bandera `tienda_pedidos` → `private.cuenta_de_tienda(host)` → validar entradas → trabajar.
--     Con la bandera apagada responden `sin_acceso` sin tocar datos; `sin_acceso` es idéntico para sin sesión, sin cuenta,
--     cuenta suspendida, cliente no habilitado, otra tienda, usuario de panel, host desconocido y empresa desactivada.
--   * Ninguna recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`: todo sale de la cuenta de la sesión.
--   * Respuestas siempre `jsonb` con `estado`; el `exception when others` registra solo `sqlstate`, nunca `sqlerrm`.
--   * Solo `authenticated`: `revoke … from public, anon` y `grant … to authenticated` explícitos.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.cambiar_favorito_por_dominio(text, uuid, boolean);
--   drop function if exists publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer);
--   drop function if exists publico.favoritos_entre_por_dominio(text, uuid[]);

-- ============================================================================
-- Alternar un favorito (idempotente, tope 200 por cuenta con lock)
-- ============================================================================
create or replace function publico.cambiar_favorito_por_dominio(host text, producto_id uuid, favorito boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope constant integer := 200;
  v_cuenta record;
  v_total integer;
  v_visible boolean;
  v_existe boolean;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  if favorito is null then
    return jsonb_build_object('estado', 'error');
  end if;
  if producto_id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  -- Un lock por cuenta: dos altas simultáneas no superan el tope.
  perform pg_advisory_xact_lock(hashtextextended('favoritos|' || v_cuenta.cuenta_cliente_id::text, 0));

  if not favorito then
    -- Quitar es siempre posible (sin error si no existe) y solo toca filas de la propia cuenta: un favorito cuyo producto
    -- se ocultó después no se lista, pero la persona puede liberarlo para no quedar trabada en el tope.
    delete from dominio.favoritos_cliente f
     where f.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and f.producto_id = producto_id;
    return jsonb_build_object('estado', 'ok', 'favorito', false);
  end if;

  -- Guardar: el producto debe ser efectivamente visible en ESTA tienda (inexistente, inactivo, oculto o de otra tienda u
  -- organización responden igual: no_encontrado). Una sola evaluación del catálogo efectivo (la misma regla que la ficha y que
  -- `precios_cliente_por_dominio`, sin duplicarla) sirve para la visibilidad y para contar el tope.
  --
  -- El tope de 200 cuenta SOLO los favoritos de productos visibles hoy: uno que se ocultó no se lista ni se cuenta (FR-008), así
  -- que tampoco ocupa lugar. Las filas igual están acotadas (solo se puede guardar lo visible).
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo(v_cuenta.empresa_id) x
     where x.efectivo
  )
  select exists (select 1 from visibles v where v.producto_id = producto_id),
         exists (select 1 from dominio.favoritos_cliente f
                  where f.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and f.producto_id = producto_id),
         (select count(*)::integer
            from dominio.favoritos_cliente f
            join visibles v on v.producto_id = f.producto_id
           where f.cuenta_cliente_id = v_cuenta.cuenta_cliente_id)
    into v_visible, v_existe, v_total;

  if not v_visible then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;
  if v_existe then
    return jsonb_build_object('estado', 'ok', 'favorito', true);
  end if;
  if v_total >= c_tope then
    return jsonb_build_object('estado', 'limite_favoritos');
  end if;

  insert into dominio.favoritos_cliente (organizacion_id, empresa_id, cuenta_cliente_id, producto_id)
  values (v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cuenta_cliente_id, producto_id)
  on conflict on constraint favoritos_cliente_cuenta_producto_uq do nothing;

  return jsonb_build_object('estado', 'ok', 'favorito', true);
exception when others then
  -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
  raise warning 'cambiar_favorito_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) from public, anon;
grant execute on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) to authenticated;

comment on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) is
  'MSF-176 (FR-007, FR-009): guarda o quita un favorito de la cuenta activa en la tienda del host. Idempotente; tope 200 por cuenta con lock, contando solo favoritos de productos visibles (el 201 → limite_favoritos sin guardar); guardar exige producto visible en la tienda (si no, no_encontrado). {estado: ok|limite_favoritos|no_encontrado|sin_acceso|error, favorito?}.';

-- ============================================================================
-- «Favoritos»: lista con carga infinita
-- ============================================================================
create or replace function publico.mis_favoritos_por_dominio(
  host text,
  desde_creado timestamptz default null,
  desde_id uuid default null,
  limite integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_limite integer := least(greatest(coalesce(limite, 20), 1), 50);
  v_escala text;
  v_total bigint;
  v_filas jsonb;
  v_siguiente jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Misma escala que ve la cuenta en la ficha a cantidad 1 (minorista y mayorista: x1).
  v_escala := private.escala_para_linea(v_cuenta.tipo, 1);

  -- Solo productos visibles hoy en la tienda (un favorito cuyo producto se ocultó no se lista ni se cuenta; no se borra).
  -- El cursor (creado_en, id) solo ordena: la consulta siempre filtra por la cuenta.
  with base as (
    select f.id, f.creado_en, f.producto_id
      from dominio.favoritos_cliente f
      join private.catalogo_tienda_efectivo(v_cuenta.empresa_id) x on x.producto_id = f.producto_id and x.efectivo
     where f.cuenta_cliente_id = v_cuenta.cuenta_cliente_id
       and f.empresa_id = v_cuenta.empresa_id
       and f.organizacion_id = v_cuenta.organizacion_id
  ),
  pagina as (
    select b.*
      from base b
     where desde_creado is null or desde_id is null or (b.creado_en, b.id) < (desde_creado, desde_id)
     order by b.creado_en desc, b.id desc
     limit v_limite + 1
  ),
  numerada as (
    select p.*, row_number() over (order by p.creado_en desc, p.id desc) as n
      from pagina p
  )
  select (select count(*) from base),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'producto_id', pr.id,
             'nombre', pr.nombre,
             'sku', nullif(btrim(pr.sku), ''),
             'imagen', (select i.ruta from dominio.producto_imagenes i
                         where i.producto_id = pr.id and i.organizacion_id = pr.organizacion_id
                         order by i.posicion limit 1),
             'disponible', private.disponible_publico(pr.id),
             'precio_final', private.precio_final_publico_escala(pr.id, v_cuenta.empresa_id, v_escala),
             'escala', v_escala
           ) order by nu.n) filter (where nu.n <= v_limite), '[]'::jsonb),
         (select jsonb_build_object('creado', u.creado_en, 'id', u.id)
            from numerada u
           where u.n = v_limite and exists (select 1 from numerada s where s.n = v_limite + 1))
    into v_total, v_filas, v_siguiente
    from numerada nu
    join dominio.productos pr on pr.id = nu.producto_id and pr.organizacion_id = v_cuenta.organizacion_id;

  return jsonb_build_object('estado', 'ok', 'total', v_total, 'filas', v_filas, 'siguiente', v_siguiente);
exception when others then
  raise warning 'mis_favoritos_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) from public, anon;
grant execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) to authenticated;

comment on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) is
  'MSF-176 (FR-008): favoritos de la cuenta activa en la tienda del host, nuevos primero, cursor (desde_creado, desde_id) que solo ordena, límite 1–50. Solo productos visibles hoy; total cuenta solo esos. Lista blanca: producto_id, nombre, sku, imagen, disponible (sin cantidades), precio_final, escala. siguiente = {creado, id} o null.';

-- ============================================================================
-- Pintar el corazón de una pantalla con una sola llamada
-- ============================================================================
create or replace function publico.favoritos_entre_por_dominio(host text, productos uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_favoritos jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  if productos is not null and cardinality(productos) > 50 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('productos'));
  end if;

  select coalesce(jsonb_agg(f.producto_id order by f.creado_en desc, f.id desc), '[]'::jsonb)
    into v_favoritos
    from dominio.favoritos_cliente f
   where f.cuenta_cliente_id = v_cuenta.cuenta_cliente_id
     and f.empresa_id = v_cuenta.empresa_id
     and f.organizacion_id = v_cuenta.organizacion_id
     and f.producto_id = any (coalesce(productos, '{}'::uuid[]));

  return jsonb_build_object('estado', 'ok', 'favoritos', v_favoritos);
exception when others then
  raise warning 'favoritos_entre_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.favoritos_entre_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.favoritos_entre_por_dominio(text, uuid[]) to authenticated;

comment on function publico.favoritos_entre_por_dominio(text, uuid[]) is
  'MSF-176 (FR-007): de hasta 50 productos, cuáles son favoritos de la cuenta activa en la tienda del host. {estado: ok, favoritos: [uuid]} | invalido (productos) | sin_acceso | error.';
