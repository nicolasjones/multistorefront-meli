-- MSF-176 · Tienda compra y cuentas: menores de las revisiones retroactivas de B1/B2 (#963/#964) y de «Mi cuenta» (#955/#961).
-- Ninguno cambia contrato ni tablas: son ajustes de robustez, rendimiento y claridad. Esquemas (Principio VII): no se crea ni altera ninguna tabla.
--
--   1. B1 · cupo de llamadas que SOBREVIVE a un fallo posterior. `publico.lista_pedido_por_dominio` y `publico.enviar_lista_pedido` tenían un
--      único `exception when others` exterior: una excepción después de consumir el cupo revertía también el cupo, y quien la provocaba pagaba cada
--      llamada sin gastarlo. Ahora todo lo posterior al cupo va en un sub-bloque con su manejador (patrón M-3 de B2: `crear_presupuesto_tienda`).
--   2. Rendimiento · `private.catalogo_tienda_efectivo_ids(empresa, ids)`: la MISMA definición de visibilidad efectiva que
--      `private.catalogo_tienda_efectivo(empresa)` (copia literal del cuerpo vigente) pero acotada a los productos pedidos. La usan la lista de
--      pedido, el envío, `mis_favoritos_por_dominio` y el alta de favoritos: ya no evalúan el catálogo ENTERO en cada llamada. La paridad con la
--      función completa la fija el pgTAP `tienda_menores_revision`; si cambia una, cambia la otra (misma migración).
--   3. `private.estado_publico_comprobante`: mapeo CERRADO. Presupuesto: anulada → anulado; pendiente → pendiente/vencido; los estados de un
--      presupuesto ya aceptado o convertido → aceptado; cualquier OTRO valor (estado nuevo o desconocido) → pendiente, el más neutro y el mismo que
--      usa el front cuando no reconoce un estado (`comoEstado` de `tiendaCuentaDatos.ts`), en vez de afirmar «aceptado». Factura: anulada → anulada;
--      el resto → confirmada. Nota de crédito: anulada → anulada (antes salía nota_credito aun anulada); el resto → nota_credito.
--   4. Comentarios (`comment on function`, porque las migraciones aplicadas son inmutables y no se editan ni los comentarios de su texto):
--      `capacidades_tienda_por_dominio` y la compuerta `precio_sesion_alcanza`. «Tienda pausada → error» significa que la RPC RESPONDE
--      `{estado: error}` (HTTP 200, sin lanzar excepción ni revelar si el host existe), no que levante un error de Postgres. Los filtros
--      `organizacion_id` de `mis_compras_por_dominio` / `mi_compra_por_dominio` (comprobante y líneas) son defensa en profundidad: las FK compuestas
--      `(…, organizacion_id)` ya impiden filas cruzadas, así que no se pueden construir datos que los distingan; un pgTAP de catálogo comprueba que
--      siguen en el SQL de las funciones.
--
-- Cuerpos: copiados COMPLETOS de la definición vigente en dev (con `public.clientes` ya reemplazado por `dominio.clientes` por la migración
-- 20270418000401). Atributos y ACL idénticos a los de antes (security definer, `search_path` vacío, mismos grants).
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR): restaurar los cuerpos de 20270321100200, 20270322100700,
-- 20270348000300 (`mis_favoritos_por_dominio`), 20270320100300 (`cambiar_favorito_por_dominio`) y 20270320100400 (`estado_publico_comprobante`) y
-- `drop function if exists private.catalogo_tienda_efectivo_ids(uuid, uuid[]);`

-- ============================================================================
-- 2. Catálogo efectivo acotado a unos productos
-- ============================================================================
CREATE OR REPLACE FUNCTION private.catalogo_tienda_efectivo_ids(p_empresa uuid, p_ids uuid[])
 RETURNS TABLE(producto_id uuid, nombre text, activo boolean, moneda text, precio numeric, stock integer, categoria_id uuid, visible boolean, destacado boolean, efectivo boolean, motivo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cat as (
    -- Una categoría es visible si ella y todas sus antecesoras lo son.
    select v.categoria_id as id, v.visible
      from private.categorias_visibles_efectivas(p_empresa) v
  ),
  base as (
    select p.id, p.nombre, p.activo, p.moneda, p.precio_lista, p.categoria_id,
           coalesce(pt.visible, true) as visible,
           coalesce(pt.destacado, false) as destacado,
           coalesce(cat.visible, true) as cat_visible,
           ex.cantidad
      from dominio.producto_empresa pe
      join dominio.productos p on p.id = pe.producto_id and p.organizacion_id = pe.organizacion_id
      left join dominio.productos_tienda pt on pt.empresa_id = pe.empresa_id and pt.producto_id = p.id
      left join cat on cat.id = p.categoria_id
      left join dominio.existencias ex on ex.producto_id = p.id and ex.organizacion_id = p.organizacion_id
     where pe.empresa_id = p_empresa
       and pe.producto_id = any (p_ids)
  )
  select b.id, b.nombre, b.activo, b.moneda, b.precio_lista, b.cantidad, b.categoria_id, b.visible, b.destacado,
         b.activo and b.visible and b.cat_visible,
         case
           when not b.activo then 'No se muestra: producto inactivo'
           when not b.cat_visible then 'No se muestra: categoría oculta'
         end
    from base b;
$function$;

revoke execute on function private.catalogo_tienda_efectivo_ids(uuid, uuid[]) from public, anon, authenticated;

comment on function private.catalogo_tienda_efectivo_ids(uuid, uuid[]) is
  'MSF-176 (menores B1): igual que private.catalogo_tienda_efectivo(empresa) pero solo para los productos de p_ids (nulo = ninguno). La paridad con la completa la fija el pgTAP tienda_menores_revision. Interna.';

-- ============================================================================
-- 1. B1: el cupo de llamadas sobrevive a un fallo posterior (y catálogo acotado a los ids pedidos)
-- ============================================================================
CREATE OR REPLACE FUNCTION publico.lista_pedido_por_dominio(host text, items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Todo lo que sigue va en un bloque propio con su manejador (patrón M-3 de B2, ver `crear_presupuesto_tienda`): una excepción revierte SOLO este
  -- bloque y el cupo de lecturas (arriba) sobrevive. Con un único manejador exterior, un fallo posterior deshacía también el cupo y quien provocaba
  -- el fallo (p. ej. con datos que rompen el cálculo) pagaba cada llamada sin gastar cupo.
  begin
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
      from private.catalogo_tienda_efectivo_ids(v_empresa, (select array_agg(en.producto_id) from entrada en)) x
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
exception when others then
  -- Manejador EXTERIOR: cubre solo lo que corre ANTES del sub-bloque (resolver el host, la bandera, validar las líneas y consumir el cupo: un fallo de
  -- cualquiera de ellos responde `error` y, si falla el propio cupo, no hay cupo que conservar). Lo posterior al cupo lo atrapa el sub-bloque, que
  -- conserva el cupo. Un pgTAP fuerza un fallo de cada lado.
  -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
  raise warning 'lista_pedido_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

CREATE OR REPLACE FUNCTION publico.enviar_lista_pedido(host text, nombre text, contacto text, nota text, items jsonb, clave_envio uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan: de control, separadores de línea Unicode y marcas de dirección del texto.
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  v_empresa uuid;
  v_items jsonb;
  v_cuenta record;
  v_cliente record;
  v_nombre text;
  v_contacto text;
  v_nota text;
  v_campos text[] := '{}';
  v_pendientes jsonb;
  v_registro jsonb;
  v_candidato text;
  v_limite jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or clave_envio is null or not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'error');
  end if;

  -- Cupo de LLAMADAS (S1, amenaza 1.1): se consume ANTES de validar ni de evaluar el catálogo, así también cuentan las llamadas `invalido` (uuids bien
  -- formados al azar con una clave nueva por pedido): sin esto un atacante pagaba la evaluación del catálogo efectivo sin límite. Cupo propio
  -- (`envio|` + visitante, por minuto); es independiente del cupo de 5 ENVÍOS por hora, que sigue siendo `registrar_envio_tienda`.
  v_limite := private.registrar_pedido_publico('envio|' || private.visitante_publico(host), private.limite_llamadas_envio_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador (patrón M-3 de B2, ver `crear_presupuesto_tienda`): una excepción revierte SOLO este
  -- bloque y el cupo de LLAMADAS (arriba) sobrevive; con un único manejador exterior un fallo posterior deshacía también el cupo.
  begin
  -- Con cuenta activa y habilitada en ESTA tienda: sus datos y su cliente. Cualquier otro caso es un visitante.
  select * into v_cuenta from private.cuenta_de_tienda(host);

  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n')), '');
  if v_cuenta.cuenta_cliente_id is not null then
    select c.nombre, c.correo, c.telefono, c.celular
      into v_cliente
      from dominio.clientes c
     where c.id = v_cuenta.cliente_id and c.organizacion_id = v_cuenta.organizacion_id;
    -- Los datos de la ficha pasan por las MISMAS reglas que los de un visitante (S2): del nombre se sacan los caracteres de control, separadores
    -- de línea y marcas de dirección; como contacto se usa el primero de correo, teléfono y celular con formato válido y sin esos caracteres.
    v_nombre := btrim(regexp_replace(regexp_replace(coalesce(v_cliente.nombre, ''), c_prohibidos_linea, ' ', 'g'), '[[:space:]]+', ' ', 'g'));
    v_nombre := left(v_nombre, 100);
    v_contacto := null;
    foreach v_candidato in array array[v_cliente.correo, v_cliente.telefono, v_cliente.celular] loop
      v_candidato := btrim(coalesce(v_candidato, ''));
      if v_candidato <> '' and v_candidato !~ c_prohibidos_linea
         and not ('contacto' = any (private.validar_contacto_tienda('x', v_candidato, 'x'))) then
        v_contacto := v_candidato;
        exit;
      end if;
    end loop;
    -- Una ficha sin nombre o sin ningún contacto válido no se puede responder: error genérico (la cuenta web exige correo, D-25).
    if v_nombre = '' or v_contacto is null then
      return jsonb_build_object('estado', 'error');
    end if;
  else
    v_nombre := btrim(coalesce(nombre, ''));
    v_contacto := btrim(coalesce(contacto, ''));
    v_campos := array_remove(private.validar_contacto_tienda(v_nombre, v_contacto, 'x'), 'mensaje');
    if v_nombre ~ c_prohibidos_linea and not ('nombre' = any (v_campos)) then
      v_campos := array_append(v_campos, 'nombre');
    end if;
    if v_contacto ~ c_prohibidos_linea and not ('contacto' = any (v_campos)) then
      v_campos := array_append(v_campos, 'contacto');
    end if;
  end if;
  if v_nota is not null and (length(v_nota) > 500 or v_nota ~ c_prohibidos_nota) then
    v_campos := array_append(v_campos, 'nota');
  end if;

  v_items := private.validar_items_pedido(items);
  if v_items is null then
    v_campos := array_append(v_campos, 'items');
  end if;
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Un reintento de una clave ya registrada (corte de red) es siempre `ok` y no crea nada, aunque entre tanto un producto se haya
  -- ocultado. (La comprobación definitiva y atómica la hace `registrar_envio_tienda`, más abajo.)
  if exists (select 1 from dominio.tienda_envios t where t.empresa_id = v_empresa and t.clave_envio = clave_envio) then
    return jsonb_build_object('estado', 'ok');
  end if;

  -- Cada producto debe ser visible en ESTA tienda; si alguno no lo es, la lista entera se rechaza (la pantalla ya los avisó al
  -- revalidar). Inexistente, ajeno, oculto o inactivo: indistinguibles.
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo_ids(
             v_empresa, (select array_agg((e.valor ->> 'producto_id')::uuid) from jsonb_array_elements(v_items) e(valor))) x
     where x.efectivo
       and x.producto_id in (select (e.valor ->> 'producto_id')::uuid from jsonb_array_elements(v_items) e(valor))
  )
  select coalesce(jsonb_agg(to_jsonb((e.valor ->> 'producto_id')::uuid) order by e.ord), '[]'::jsonb)
    into v_pendientes
    from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
   where (e.valor ->> 'producto_id')::uuid not in (select v.producto_id from visibles v);
  if jsonb_array_length(v_pendientes) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'), 'no_disponibles', v_pendientes);
  end if;

  -- Sub-transacción: si la entrega falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'pedido', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' = 'nuevo' then
      perform private.crear_consulta_pedido(v_empresa, v_nombre, v_contacto, v_nota, v_cuenta.cliente_id, v_items, v_cuenta.tipo);
    end if;
  exception when others then
    -- Rastro en el servidor (log de Postgres) solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'enviar_lista_pedido falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  return jsonb_build_object('estado', 'ok');
  exception when others then
    -- Rastro en el servidor solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'enviar_lista_pedido falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Manejador EXTERIOR: cubre solo lo que corre ANTES del sub-bloque (host, bandera y consumo del cupo de llamadas). Lo posterior lo atrapa el
  -- sub-bloque, que conserva el cupo. Un pgTAP fuerza un fallo de cada lado.
  raise warning 'enviar_lista_pedido falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$function$;

-- Favoritos: el catálogo se acota a los favoritos de la cuenta (y al producto que se guarda).
CREATE OR REPLACE FUNCTION publico.mis_favoritos_por_dominio(host text, desde_creado timestamp with time zone DEFAULT NULL::timestamp with time zone, desde_id uuid DEFAULT NULL::uuid, limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION publico.cambiar_favorito_por_dominio(host text, producto_id uuid, favorito boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ============================================================================
-- 3. Estado público de un comprobante: mapeo cerrado con caso por defecto seguro
-- ============================================================================
create or replace function private.estado_publico_comprobante(p_tipo text, p_estado text, p_valido_hasta date)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_tipo
    when 'presupuesto' then
      case
        when p_estado = 'anulada' then 'anulado'
        when p_estado = 'pendiente' then
          case when p_valido_hasta is not null and p_valido_hasta < private.hoy_argentina() then 'vencido' else 'pendiente' end
        -- Presupuesto ya aceptado, convertido o en curso de preparación/cobro: el cliente lo ve «aceptado».
        when p_estado in ('aceptado', 'convertido', 'confirmada', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then 'aceptado'
        -- Cualquier otro valor (estado nuevo o desconocido): el más neutro, el mismo que usa el front. Nunca se afirma «aceptado» sin saberlo.
        else 'pendiente'
      end
    when 'factura' then
      case when p_estado = 'anulada' then 'anulada' else 'confirmada' end
    when 'nota_credito' then
      case when p_estado = 'anulada' then 'anulada' else 'nota_credito' end
  end;
$$;

revoke execute on function private.estado_publico_comprobante(text, text, date) from public, anon, authenticated;

comment on function private.estado_publico_comprobante(text, text, date) is
  'MSF-176 (FR-004): estado público simplificado de un comprobante, mapeo CERRADO. Presupuesto: pendiente|vencido|aceptado|anulado (estado desconocido → pendiente). Factura: confirmada|anulada. Nota de crédito: nota_credito|anulada. Nunca expone cobro ni despacho. Interna.';

-- ============================================================================
-- 4. Comentarios que aclaran (las migraciones aplicadas no se editan)
-- ============================================================================
comment on function publico.capacidades_tienda_por_dominio(text) is
  'MSF-176 (D-27): {estado, pedidos} con el valor de la bandera tienda_pedidos para la tienda del host. Host desconocido, empresa desactivada y tienda pausada responden el MISMO {estado: error}: es un valor de la respuesta (la RPC no lanza excepción de Postgres ni devuelve un error HTTP), para no revelar qué hosts existen. No devuelve ningún otro dato.';

comment on function private.precio_sesion_alcanza(uuid, uuid) is
  'MSF-176 B2 (D-17): compuerta y aislamiento de la sesión de panel para los envoltorios de precio (precio_para, precio_linea_venta): empresas o ventas en lectura/edición y producto y empresa de la organización de la sesión (security definer, search_path vacío). Sin execute para ningún rol de API; un cliente web o una sesión sin permisos da false. Fijada por el pgTAP precio_para_compuerta.';

comment on function publico.mis_compras_por_dominio(text, date, uuid, integer) is
  'MSF-176 (FR-003, FR-004): comprobantes (sin borradores, cualquier canal) del cliente de la cuenta activa en la tienda del host, nuevos primero (fecha desc, id desc), cursor (desde_fecha, desde_id) que solo ordena, límite 1–50. Lista blanca: id, numero, fecha, tipo (compra|presupuesto|nota_credito), estado_publico, total_con_iva (negativo en notas de crédito). siguiente = {fecha, id} o null. El filtro organizacion_id del comprobante es DEFENSA EN PROFUNDIDAD (las FK compuestas ya impiden filas cruzadas): se conserva a propósito y un pgTAP de catálogo comprueba que sigue en el SQL.';

comment on function publico.mi_compra_por_dominio(text, uuid) is
  'MSF-176 (FR-005, FR-006): detalle de un comprobante del cliente de la cuenta activa. Lista blanca: numero, fecha, tipo, estado_publico, valido_hasta, total_sin_iva, iva, total_con_iva, lineas[descripcion, codigo, cantidad, precio_unitario (SIN IVA), subtotal (SIN IVA)]. Otro cliente/tienda/organización, borrador o id inexistente → no_encontrada idéntica (IDOR). Totales y subtotales de línea negativos en notas de crédito (precio_unitario positivo). Los filtros organizacion_id del comprobante y de las líneas son DEFENSA EN PROFUNDIDAD (FK compuestas), fijados por un pgTAP de catálogo.';
