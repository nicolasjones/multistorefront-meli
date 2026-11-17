-- MSF-176 · Tienda compra y cuentas, PR de cierre, H-3 de la revisión de seguridad integral (T070): CUPO DE LLAMADAS por cuenta en las cinco RPC de la historia A
-- («Mi cuenta»: historial, favoritos).
--
-- Antes las cinco (`cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio`, `favoritos_entre_por_dominio`, `mis_compras_por_dominio`, `mi_compra_por_dominio`) no tenían
-- límite: una cuenta activa podía repetirlas sin tope. Ahora, DESPUÉS de resolver la cuenta (el `sin_acceso` sigue siendo barato e idéntico) y ANTES de cualquier lectura o cálculo,
-- toman un cupo de 120 llamadas por minuto y cuenta (`private.registrar_pedido_publico('cuenta|<cuenta>', …)`, constante `private.limite_llamadas_cuenta_por_minuto()`, holgada para el
-- uso normal: la ficha pide una vez los favoritos y «Mi cuenta» carga de a 20). Superado: `{estado: limite, espera_segundos}`; la pantalla lo traduce a su error con reintento.
-- El cupo se toma ANTES del bloque anidado con `exception when others` (como en B2), de modo que un error provocado no lo revierte. Las cuatro que eran `stable` pasan a `volatile` (escriben el
-- contador). Misma firma, mismo resto de la lógica y mismos grants (`create or replace`: solo `authenticated`).
--
-- Cuerpos: los de las definiciones VIGENTES en `dokploy` (`20270430000000_tienda_menores_revision.sql` para los favoritos, `20270320100300` y `20270320100400` para el historial), con el
-- cupo y el bloque anidado. No se copian los cuerpos del PR original (2026-11-14): entre esa fecha y esta la base avanzó (catálogo acotado por ids, `dominio.clientes`, lista de precios del
-- cliente) y copiar los antiguos habría revertido esos cambios.
--
-- Un `statement_timeout` (57014, `query_canceled`) NO lo atrapa `when others` (PostgreSQL lo excluye): la llamada falla entera y su transacción, cupo incluido, se revierte; el costo de esa
-- vía lo acota el propio `statement_timeout` de los roles de la API (`authenticated` 8 s). Documentado en `docs/seguridad-tienda-compra-y-cuentas.md`.
--
-- Esquemas (Principio VII): sin tablas nuevas. Migración aditiva. Reversión (migración posterior): restaurar las cinco funciones a los cuerpos de `20270430000000_tienda_menores_revision.sql`
-- y `20270320100400_tienda_historial_rpc.sql`; `drop function if exists private.limite_llamadas_cuenta_por_minuto();`.

create or replace function private.limite_llamadas_cuenta_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 120; $$;

revoke execute on function private.limite_llamadas_cuenta_por_minuto() from public, anon, authenticated;

comment on function private.limite_llamadas_cuenta_por_minuto() is
  'MSF-176 (H-3): cupo de llamadas por minuto y cuenta de las cinco RPC de «Mi cuenta» (120; holgado para el uso normal). Interna, sin acceso de API.';

-- ============================================================================
-- Favoritos: guardar, quitar y listar
-- ============================================================================
CREATE OR REPLACE FUNCTION publico.cambiar_favorito_por_dominio(host text, producto_id uuid, favorito boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_cupo jsonb;
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

  -- Cupo de LLAMADAS por cuenta (H-3 de la revisión integral): ANTES de cualquier cálculo y tomado fuera del bloque con el manejador de excepciones, así
  -- sobrevive a un error. Cuenta también las llamadas inválidas.
  v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
  end if;

  begin

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
  -- organización responden igual: no_encontrado). Una sola evaluación del catálogo efectivo (acotada a los favoritos de la cuenta y al producto) (la misma regla que la ficha y que
  -- `precios_cliente_por_dominio`, sin duplicarla) sirve para la visibilidad y para contar el tope.
  --
  -- El tope de 200 cuenta SOLO los favoritos de productos visibles hoy: uno que se ocultó no se lista ni se cuenta (FR-008), así
  -- que tampoco ocupa lugar. Las filas están acotadas por la cantidad de productos de la tienda (única cuenta + producto); el total
  -- visible puede superar 200 si se vuelven a publicar productos que estaban ocultos.
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo_ids(
             v_cuenta.empresa_id,
             array_append((select coalesce(array_agg(f2.producto_id), '{}'::uuid[])
                             from dominio.favoritos_cliente f2
                            where f2.cuenta_cliente_id = v_cuenta.cuenta_cliente_id), producto_id)) x
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
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'cambiar_favorito_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

CREATE OR REPLACE FUNCTION publico.mis_favoritos_por_dominio(host text, desde_creado timestamp with time zone DEFAULT NULL::timestamp with time zone, desde_id uuid DEFAULT NULL::uuid, limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_cupo jsonb;
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

  -- Cupo de LLAMADAS por cuenta (H-3 de la revisión integral): ANTES de cualquier cálculo y tomado fuera del bloque con el manejador de excepciones, así
  -- sobrevive a un error. Cuenta también las llamadas inválidas.
  v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
  end if;

  begin

  -- Misma escala que ve la cuenta en la ficha a cantidad 1 (minorista y mayorista: x1).
  v_escala := private.escala_para_linea(v_cuenta.tipo, 1);

  -- Solo productos visibles hoy en la tienda (un favorito cuyo producto se ocultó no se lista ni se cuenta; no se borra).
  -- El cursor (creado_en, id) solo ordena: la consulta siempre filtra por la cuenta.
  with base as (
    select f.id, f.creado_en, f.producto_id
      from dominio.favoritos_cliente f
      join private.catalogo_tienda_efectivo_ids(
             v_cuenta.empresa_id,
             (select coalesce(array_agg(f2.producto_id), '{}'::uuid[])
                from dominio.favoritos_cliente f2
               where f2.cuenta_cliente_id = v_cuenta.cuenta_cliente_id
                 and f2.empresa_id = v_cuenta.empresa_id
                 and f2.organizacion_id = v_cuenta.organizacion_id)) x on x.producto_id = f.producto_id and x.efectivo
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
             'precio_final', private.precio_final_publico_escala(pr.id, v_cuenta.empresa_id, v_escala, v_cuenta.cliente_id),
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
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'mis_favoritos_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

CREATE OR REPLACE FUNCTION publico.favoritos_entre_por_dominio(host text, productos uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_cupo jsonb;
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

  -- Cupo de LLAMADAS por cuenta (H-3 de la revisión integral): ANTES de cualquier cálculo y tomado fuera del bloque con el manejador de excepciones, así
  -- sobrevive a un error. Cuenta también las llamadas inválidas.
  v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
  end if;

  begin

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
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'favoritos_entre_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

-- ============================================================================
-- Historial: lista y detalle
-- ============================================================================
CREATE OR REPLACE FUNCTION publico.mis_compras_por_dominio(host text, desde_fecha date DEFAULT NULL::date, desde_id uuid DEFAULT NULL::uuid, limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_cupo jsonb;
  v_cuenta record;
  v_limite integer := least(greatest(coalesce(limite, 20), 1), 50);
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

  -- Cupo de LLAMADAS por cuenta (H-3 de la revisión integral): ANTES de cualquier cálculo y tomado fuera del bloque con el manejador de excepciones, así
  -- sobrevive a un error. Cuenta también las llamadas inválidas.
  v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
  end if;

  begin

  -- El cursor (fecha, id) solo ordena (siguientes filas con (fecha, id) < cursor); la consulta siempre filtra por el cliente y
  -- la empresa de la cuenta. Sin borradores. Un cursor a medias (solo uno de sus dos valores) se ignora.
  with base as (
    select c.id, c.numero, c.fecha, c.tipo, c.estado, c.valido_hasta, c.total_con_iva
      from dominio.comprobantes_venta c
     where c.cliente_id = v_cuenta.cliente_id
       and c.empresa_id = v_cuenta.empresa_id
       and c.organizacion_id = v_cuenta.organizacion_id
       and c.estado <> 'borrador'
  ),
  pagina as (
    select b.*
      from base b
     where desde_fecha is null or desde_id is null or (b.fecha, b.id) < (desde_fecha, desde_id)
     order by b.fecha desc, b.id desc
     limit v_limite + 1
  ),
  numerada as (
    select p.*, row_number() over (order by p.fecha desc, p.id desc) as n
      from pagina p
  )
  select (select count(*) from base),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', nu.id,
             'numero', nu.numero,
             'fecha', nu.fecha,
             'tipo', case nu.tipo when 'factura' then 'compra' else nu.tipo end,
             'estado_publico', private.estado_publico_comprobante(nu.tipo, nu.estado, nu.valido_hasta),
             'total_con_iva', case when nu.tipo = 'nota_credito' then -nu.total_con_iva else nu.total_con_iva end
           ) order by nu.n) filter (where nu.n <= v_limite), '[]'::jsonb),
         (select jsonb_build_object('fecha', u.fecha, 'id', u.id)
            from numerada u
           where u.n = v_limite and exists (select 1 from numerada s where s.n = v_limite + 1))
    into v_total, v_filas, v_siguiente
    from numerada nu;

  return jsonb_build_object('estado', 'ok', 'total', v_total, 'filas', v_filas, 'siguiente', v_siguiente);
  exception when others then
    raise warning 'mis_compras_por_dominio falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'mis_compras_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

CREATE OR REPLACE FUNCTION publico.mi_compra_por_dominio(host text, comprobante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_cupo jsonb;
  v_cuenta record;
  v_c record;
  v_signo integer;
  v_lineas jsonb;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Cupo de LLAMADAS por cuenta (H-3 de la revisión integral): ANTES de cualquier cálculo y tomado fuera del bloque con el manejador de excepciones, así
  -- sobrevive a un error. Cuenta también las llamadas inválidas.
  v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
  end if;

  begin

  -- Del cliente y de la tienda de la cuenta, y sin borradores. Otro cliente, otra tienda, otra organización, un borrador y un
  -- id inexistente (o nulo) dan la MISMA respuesta (IDOR).
  select c.id, c.numero, c.fecha, c.tipo, c.estado, c.valido_hasta, c.total_sin_iva, c.total_con_iva
    into v_c
    from dominio.comprobantes_venta c
   where c.id = comprobante_id
     and c.cliente_id = v_cuenta.cliente_id
     and c.empresa_id = v_cuenta.empresa_id
     and c.organizacion_id = v_cuenta.organizacion_id
     and c.estado <> 'borrador';
  if not found then
    return jsonb_build_object('estado', 'no_encontrada');
  end if;

  v_signo := case when v_c.tipo = 'nota_credito' then -1 else 1 end;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'descripcion', l.descripcion,
             'codigo', l.codigo,
             'cantidad', l.cantidad,
             'precio_unitario', l.precio_unitario,
             'subtotal', v_signo * l.subtotal_sin_iva
           ) order by l.orden), '[]'::jsonb)
    into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_cuenta.organizacion_id;

  return jsonb_build_object(
    'estado', 'ok',
    'numero', v_c.numero,
    'fecha', v_c.fecha,
    'tipo', case v_c.tipo when 'factura' then 'compra' else v_c.tipo end,
    'estado_publico', private.estado_publico_comprobante(v_c.tipo, v_c.estado, v_c.valido_hasta),
    'valido_hasta', case when v_c.tipo = 'presupuesto' then v_c.valido_hasta end,
    'total_sin_iva', v_signo * v_c.total_sin_iva,
    'iva', v_signo * (v_c.total_con_iva - v_c.total_sin_iva),
    'total_con_iva', v_signo * v_c.total_con_iva,
    'lineas', v_lineas
  );
  exception when others then
    raise warning 'mi_compra_por_dominio falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'mi_compra_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

-- La superficie de las cinco no cambia: solo `authenticated`.
revoke execute on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) from public, anon;
grant execute on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) to authenticated;
revoke execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) from public, anon;
grant execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) to authenticated;
revoke execute on function publico.favoritos_entre_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.favoritos_entre_por_dominio(text, uuid[]) to authenticated;
revoke execute on function publico.mis_compras_por_dominio(text, date, uuid, integer) from public, anon;
grant execute on function publico.mis_compras_por_dominio(text, date, uuid, integer) to authenticated;
revoke execute on function publico.mi_compra_por_dominio(text, uuid) from public, anon;
grant execute on function publico.mi_compra_por_dominio(text, uuid) to authenticated;

comment on function publico.cambiar_favorito_por_dominio(text, uuid, boolean) is
  'MSF-176 (FR-007 a FR-009): alterna un favorito de la cuenta activa en la tienda del host (tope de 200 visibles). MSF-176 (H-3): cupo de 120 llamadas por minuto y cuenta; superado devuelve {estado: limite, espera_segundos}. Solo authenticated.';
comment on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) is
  'MSF-176 (FR-008): favoritos de la cuenta activa en la tienda del host, nuevos primero, cursor (desde_creado, desde_id) que solo ordena, límite 1–50. Solo productos visibles hoy; total cuenta solo esos. Lista blanca: producto_id, nombre, sku, imagen, disponible (sin cantidades), precio_final, escala. siguiente = {creado, id} o null. MSF-176 (H-3): cupo de 120 llamadas por minuto y cuenta.';
comment on function publico.favoritos_entre_por_dominio(text, uuid[]) is
  'MSF-176 (FR-007): de hasta 50 productos, cuáles son favoritos de la cuenta activa en la tienda del host. {estado: ok, favoritos: [uuid]} | invalido (productos) | sin_acceso | limite | error. MSF-176 (H-3): cupo de 120 llamadas por minuto y cuenta.';
comment on function publico.mis_compras_por_dominio(text, date, uuid, integer) is
  'MSF-176 (FR-003, FR-004): comprobantes (sin borradores, cualquier canal) del cliente de la cuenta activa en la tienda del host, nuevos primero (fecha desc, id desc), cursor (desde_fecha, desde_id) que solo ordena, límite 1–50. Lista blanca: id, numero, fecha, tipo (compra|presupuesto|nota_credito), estado_publico, total_con_iva (negativo en notas de crédito). siguiente = {fecha, id} o null. MSF-176 (H-3): cupo de 120 llamadas por minuto y cuenta.';
comment on function publico.mi_compra_por_dominio(text, uuid) is
  'MSF-176 (FR-005, FR-006): detalle de un comprobante del cliente de la cuenta activa en la tienda del host. Lista blanca: numero, fecha, tipo, estado_publico, valido_hasta, total_sin_iva, iva, total_con_iva, lineas[descripcion, codigo, cantidad, precio_unitario, subtotal]. Otro cliente/tienda/organización, borrador o id inexistente → no_encontrada idéntica (IDOR). Totales y subtotales de línea negativos en notas de crédito (precio_unitario positivo). MSF-176 (H-3): cupo de 120 llamadas por minuto y cuenta.';
