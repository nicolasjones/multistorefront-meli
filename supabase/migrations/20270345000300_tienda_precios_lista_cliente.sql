-- F-CLI-21 (MSF-453, épica MSF-450, spec 20270327-100000-listas-de-precios-por-cliente, Fase 4, T020, RF-CLI-21-7, D14): la tienda con
-- cuenta web usa la MISMA lista de precios que el mostrador. «Tu precio» de la ficha, los favoritos y el presupuesto armado desde la
-- tienda salen del mismo criterio (`private.lista_precios_cliente`, única lectura de la bandera `listas_precios` y de la lista):
-- el precio que ve la persona es el que se cobra. Las TARJETAS del catálogo y el visitante NO cambian (precio público x1, como hoy).
-- Con la bandera APAGADA todo resultado es idéntico al anterior.
--
-- Esquemas (Principio VII): sin tablas nuevas. `publico` sigue sin tablas (solo funciones de lectura/escritura por Host); `private` es
-- cálculo sin `execute` para la API.
--
-- Funciones redefinidas (cada cuerpo parte de la última versión de `dokploy`, igual a la definición VIVA de dev; mismos grants y misma
-- lista blanca de respuesta: no se agrega ningún campo a lo que ve el visitante ni la cuenta):
--   1. `private.precio_final_publico_escala(producto, empresa, escala)` -> `(…, p_cliente uuid default null)`: con cliente y bandera
--      encendida, la lista del cliente reemplaza la regla de la tienda cuando no hay escala cargada ni precio propio (D5). Mismo
--      criterio que `precio_para_calculo` (el número es el neto sin IVA; el IVA sigue el interruptor de la empresa). Se borra la firma
--      de 3 argumentos para no dejar una sobrecarga ambigua: todos los llamadores pasan 3 y resuelven a la nueva (valor por omisión).
--   2. `publico.precios_cliente_por_dominio`: pasa el cliente de la cuenta ACTIVA (`private.cuenta_de_tienda`); visitante, cuenta
--      suspendida, no habilitada, host desconocido o empresa desactivada siguen devolviendo `null`, idéntico.
--   3. `publico.mis_favoritos_por_dominio`: el `precio_final` usa la lista del cliente de la cuenta.
--   4. `private.motor_presupuesto_tienda`: usa `precio_linea_venta_calculo` con el cliente de la cuenta y devuelve `lista_precio_id` y
--      `lista_ajuste_pct` AL FINAL (cambia el tipo de retorno: se borra y se vuelve a crear; sin `execute` para la API).
--   5. `publico.crear_presupuesto_tienda`: guarda el snapshot de la lista en las líneas del presupuesto (D12).
-- `publico.cotizar_presupuesto_tienda` no se toca: arma su salida de lista blanca por clave y ya usa el motor.
-- NO cambia: `precio_referencia_pedido` y la lista de pedido (consulta al local sin cobrar: muestra el precio público; seguimiento
-- declarado en la spec y en el PR).
--
-- Migración aditiva en datos. Reversión operativa inmediata, SIN migrar: apagar la bandera `listas_precios`.
-- Reversión de código (migración posterior): restaurar los cuerpos de 20270213200002, 20261211110100, 20270320100300, 20270322100300 y
-- 20270322100400 (con `drop function` de las firmas nuevas).

-- ============================================================================
-- 1. Precio final público de la tienda, con la lista del cliente
-- ============================================================================
drop function if exists private.precio_final_publico_escala(uuid, uuid, text);

create or replace function private.precio_final_publico_escala(p_producto uuid, p_empresa uuid, p_escala text, p_cliente uuid default null)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_final numeric;
begin
  if p_escala is null or p_escala not in ('x1', 'x5', 'x10', 'x50') then
    raise exception 'La escala % no existe: usá x1, x5, x10 o x50', coalesce(p_escala, '(vacía)')
      using errcode = '22023';
  end if;

  select case
           when coalesce(r.mostrar_con_iva, false)
             then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
           else x.neto
         end
    into v_final
    from dominio.productos p
    join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
    join dominio.producto_empresa pe
      on pe.producto_id = p.id and pe.empresa_id = e.id and pe.organizacion_id = p.organizacion_id
    left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
    left join dominio.producto_precios_escala s
      on s.producto_id = p.id and s.organizacion_id = p.organizacion_id and s.escala = p_escala
    left join dominio.categorias c on c.id = p.categoria_id and c.organizacion_id = p.organizacion_id
    left join dominio.alicuotas_iva al
      on al.id = coalesce(p.alicuota_iva_id, c.alicuota_iva_id) and al.organizacion_id = p.organizacion_id
    left join dominio.precios_propios_empresa pp
      on pp.producto_id = p.id and pp.empresa_id = e.id and pp.organizacion_id = p.organizacion_id
    left join lateral private.lista_precios_cliente(p_cliente, p.organizacion_id) lp on true
    cross join lateral (
      select case
               when pp.moneda is not null and (p_escala = 'x1' or s.precio is null)
                 then private.neto_precio_propio(pp.moneda, pp.importe, p.organizacion_id, e.id)
               -- F-CLI-21 (D5): la lista del cliente rige si no hay escala cargada ni precio propio (misma regla que precio_para_calculo).
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

  return v_final;
end;
$$;

revoke execute on function private.precio_final_publico_escala(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

comment on function private.precio_final_publico_escala(uuid, uuid, text, uuid) is
  'F-CLI-07 + F-CLI-21: precio final en pesos enteros de un producto para una empresa, una escala (x1/x5/x10/x50) y (opcional) un cliente: regla de la empresa (o la lista del cliente con la bandera listas_precios, mismo criterio que private.precio_para_calculo) + IVA según su interruptor. Sin cliente o con la bandera apagada es idéntica a la versión anterior. null si no es calculable; escala inexistente => 22023. Sin acceso para anon/authenticated.';


-- ============================================================================
-- 2. «Tu precio» de la ficha (precios del cliente por dominio)
-- ============================================================================
create or replace function publico.precios_cliente_por_dominio(host text, productos uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_max constant int := 50;
  v_acceso jsonb;
  v_tipo text;
  v_empresa uuid;
  v_cliente uuid;
  v_resultado jsonb;
begin
  if productos is not null and cardinality(productos) > v_max then
    raise exception 'Se pueden pedir hasta % productos por llamada', v_max using errcode = '22023';
  end if;

  v_acceso := publico.acceso_cliente_por_dominio(host);
  if v_acceso is null or v_acceso ->> 'estado' is distinct from 'activa' then
    return null;
  end if;
  v_tipo := v_acceso ->> 'tipo';
  if v_tipo is null or v_tipo not in ('minorista', 'mayorista') then
    return null;
  end if;

  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- F-CLI-21 (D14): el cliente de la cuenta activa (la misma identidad que usa el presupuesto de la tienda); la lista rige solo con la bandera encendida.
  select ca.cliente_id into v_cliente from private.cuenta_de_tienda(host) ca;

  select jsonb_build_object(
           'tipo', v_tipo,
           'precios', coalesce(jsonb_agg(
             jsonb_build_object(
               'producto_id', x.producto_id,
               'escalas', (
                 select jsonb_agg(
                          jsonb_build_object(
                            'escala', t.escala, 'desde', t.desde, 'hasta', t.hasta,
                            'final', private.precio_final_publico_escala(x.producto_id, v_empresa, t.escala, v_cliente)
                          ) order by t.desde)
                   from (values ('x1', 1, 4), ('x5', 5, 9), ('x10', 10, 49), ('x50', 50, null::int))
                        as t (escala, desde, hasta)
                  where t.escala = 'x1' or v_tipo = 'mayorista'
               )
             ) order by x.producto_id), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
   where x.efectivo and x.producto_id = any (coalesce(productos, '{}'::uuid[]));

  return v_resultado;
end;
$$;

revoke execute on function publico.precios_cliente_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.precios_cliente_por_dominio(text, uuid[]) to authenticated;

comment on function publico.precios_cliente_por_dominio(text, uuid[]) is
  'F-CLI-07: precio final por escala de los productos visibles pedidos, según el tipo del cliente con cuenta activa y habilitada en la tienda del host (minorista: x1; mayorista: x1/x5/x10/x50 con rango). Lista blanca; null idéntico si no hay cuenta activa habilitada, host desconocido o empresa desactivada. Máx. 50 productos por llamada (22023). F-CLI-21: con la bandera listas_precios encendida y una lista asignada al cliente, el precio es el de su lista (D5: no pisa escala cargada ni precio propio).';


-- ============================================================================
-- 3. Favoritos de la cuenta
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
$$;

revoke execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) from public, anon;
grant execute on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) to authenticated;

comment on function publico.mis_favoritos_por_dominio(text, timestamptz, uuid, integer) is
  'MSF-176 (FR-008): favoritos de la cuenta activa en la tienda del host, nuevos primero, cursor (desde_creado, desde_id) que solo ordena, límite 1–50. Solo productos visibles hoy; total cuenta solo esos. Lista blanca: producto_id, nombre, sku, imagen, disponible (sin cantidades), precio_final, escala. siguiente = {creado, id} o null. F-CLI-21: el precio_final usa la lista de precios del cliente de la cuenta (bandera listas_precios).';


-- ============================================================================
-- 4. Motor del presupuesto de la tienda
-- ============================================================================
drop function if exists private.motor_presupuesto_tienda(uuid, jsonb);

create or replace function private.motor_presupuesto_tienda(p_cuenta uuid, p_items jsonb)
returns table (
  orden integer,
  producto_id uuid,
  estado text,
  descripcion text,
  codigo text,
  cantidad integer,
  precio_unitario numeric,
  escala text,
  alicuota_id uuid,
  alicuota_porcentaje numeric,
  deposito_id uuid,
  a_pedido boolean,
  subtotal_sin_iva numeric,
  iva numeric,
  descuento_pct numeric,
  precio_referencia numeric,
  promocion_id uuid,
  disponible boolean,
  lista_precio_id uuid,
  lista_ajuste_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_empresa uuid;
  v_cliente uuid;
  v_tipo text;
  v_descuento numeric;
  v_items jsonb;
  v_deposito uuid;
  v_visibles uuid[];
  v_ahora timestamptz := clock_timestamp();
  v_item record;
  v_pr dominio.productos;
  v_precio record;
  v_porcentaje numeric;
  v_subtotal numeric;
begin
  -- Todo sale de la cuenta (que la RPC derivó de la sesión y del host): cliente, organización, empresa, tipo y descuento de la ficha.
  select cc.organizacion_id, cc.empresa_id, cc.cliente_id, cl.tipo, coalesce(cl.descuento, 0)
    into v_org, v_empresa, v_cliente, v_tipo, v_descuento
    from public.cuentas_cliente cc
    join dominio.empresas e on e.id = cc.empresa_id and e.organizacion_id = cc.organizacion_id and e.activa
    join public.clientes cl on cl.id = cc.cliente_id and cl.organizacion_id = cc.organizacion_id
   where cc.id = p_cuenta and cc.estado = 'activa';
  if v_org is null then
    return;
  end if;

  v_items := private.validar_items_pedido(p_items);
  if v_items is null then
    return;
  end if;

  select d.id into v_deposito
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_empresa and de.organizacion_id = v_org
   where d.organizacion_id = v_org and d.por_defecto and d.activo
   limit 1;

  select coalesce(array_agg(x.producto_id), '{}'::uuid[]) into v_visibles
    from private.catalogo_tienda_efectivo(v_empresa) x
   where x.efectivo
     and x.producto_id in (select (e.valor ->> 'producto_id')::uuid from jsonb_array_elements(v_items) e(valor));

  for v_item in
    select e.ord::integer as ord, (e.valor ->> 'producto_id')::uuid as producto, (e.valor ->> 'cantidad')::integer as cant
      from jsonb_array_elements(v_items) with ordinality as e(valor, ord)
     order by e.ord
  loop
    -- Fila de resultado vacía por defecto (se completa abajo).
    orden := v_item.ord;
    producto_id := v_item.producto;
    cantidad := v_item.cant;
    estado := 'no_disponible';
    descripcion := null; codigo := null; precio_unitario := null; escala := null; alicuota_id := null; alicuota_porcentaje := null;
    deposito_id := v_deposito; a_pedido := null; subtotal_sin_iva := null; iva := null; descuento_pct := null;
    precio_referencia := null; promocion_id := null; disponible := null;
    lista_precio_id := null; lista_ajuste_pct := null;

    v_pr := null;
    if v_item.producto = any (v_visibles) then
      select * into v_pr from dominio.productos pr where pr.id = v_item.producto and pr.organizacion_id = v_org and pr.activo;
    end if;
    if v_pr.id is null then
      return next;
      continue;
    end if;

    descripcion := left(coalesce(nullif(btrim(v_pr.nombre), ''), 'Producto sin nombre'), 300);
    codigo := left(nullif(btrim(v_pr.sku), ''), 100);
    a_pedido := v_pr.disponibilidad_manual is not distinct from 'a_pedido';
    disponible := private.disponible_publico(v_pr.id);

    select * into v_precio
      from private.precio_linea_venta_calculo(v_pr.id, v_empresa, v_tipo, v_item.cant, v_descuento, v_ahora, true, v_cliente);
    if not found or v_precio.neto_unitario is null or v_precio.neto_unitario <= 0 then
      estado := 'sin_precio';
      return next;
      continue;
    end if;

    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_precio.neto_unitario * v_item.cant, 2);
    if v_precio.neto_unitario >= 1000000000000 or v_subtotal >= 1000000000000 then
      estado := 'excedido';
      return next;
      continue;
    end if;

    estado := 'ok';
    precio_unitario := v_precio.neto_unitario;
    escala := v_precio.escala_usada;
    alicuota_id := v_precio.alicuota_id;
    alicuota_porcentaje := v_porcentaje;
    subtotal_sin_iva := v_subtotal;
    iva := round(v_subtotal * v_porcentaje / 100, 2);
    descuento_pct := v_precio.descuento_aplicado;
    precio_referencia := v_precio.precio_referencia;
    promocion_id := v_precio.promocion_id;
    lista_precio_id := v_precio.lista_precio_id;
    lista_ajuste_pct := v_precio.lista_ajuste_pct;
    return next;
  end loop;
end;
$$;

revoke execute on function private.motor_presupuesto_tienda(uuid, jsonb) from public, anon, authenticated, service_role;

comment on function private.motor_presupuesto_tienda(uuid, jsonb) is
  'MSF-176 (B2, FR-051 a FR-056, D-17): arma las líneas de un presupuesto de la tienda para una cuenta ACTIVA: cliente, organización, empresa, tipo y descuento salen de la cuenta; solo productos efectivamente visibles; precio con private.precio_linea_venta_calculo (instante del servidor, descuento de la ficha, sin precio manual); estado por línea (ok, no_disponible, sin_precio, excedido). La usan cotizar y crear (lo que ves es lo que se crea). F-CLI-21: usa la lista de precios del cliente de la cuenta (bandera listas_precios) y devuelve la lista que fijó el precio (lista_precio_id, lista_ajuste_pct) para el snapshot de la línea. Sin execute para la API.';


-- ============================================================================
-- 5. Crear presupuesto desde la tienda: guarda el snapshot de la lista
-- ============================================================================
create or replace function publico.crear_presupuesto_tienda(host text, items jsonb, nota text, clave_envio uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  -- Caracteres que se rechazan en la nota: de control (salvo el salto de línea), separadores de línea Unicode y marcas de dirección del texto.
  -- (M-4: se suman U+061C y los ceros de ancho U+200B a U+200D, U+2060 y U+FEFF; el mismo conjunto que el front, `tiendaPedido.ts`.)
  c_prohibidos_nota constant text := '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  c_prohibidos_linea constant text := '[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]';
  v_cuenta record;
  v_limite jsonb;
  v_nota text;
  v_campos text[] := '{}';
  v_items jsonb;
  v_previo record;
  v_hoy date := (select private.hoy_argentina());
  v_inicio_dia timestamptz;
  v_creados integer;
  v_abiertos integer;
  v_lineas jsonb;
  v_malo record;
  v_total_sin numeric;
  v_total_iva numeric;
  v_registro jsonb;
  v_numero integer;
  v_comprobante dominio.comprobantes_venta;
  v_cliente record;
  v_empresa_nombre text;
begin
  if not private.bandera_activa('tienda_pedidos') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;
  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Cupo de LLAMADAS por cuenta, ANTES de validar ni calcular nada (amenaza 1.1 / S1 de B1): también cuentan las llamadas inválidas.
  v_limite := private.registrar_pedido_publico('presupuesto|' || v_cuenta.cuenta_cliente_id::text, private.limite_presupuestos_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Todo lo que sigue va en un bloque propio con su manejador (M-3 de la revisión): una excepción revierte SOLO este bloque y el cupo de llamadas (arriba) sobrevive.
  begin
  -- Entradas: solo `items`, `nota` y `clave_envio`. Ninguna otra clave del jsonb se lee. La nota se recorta con espacios, tabuladores y saltos de línea (una nota solo de
  -- saltos de línea es «sin nota», no una nota vacía guardada: coherente con el CHECK de la tabla).
  v_nota := nullif(btrim(replace(coalesce(nota, ''), E'\r\n', E'\n'), E' \t\n\r'), '');
  if v_nota is not null and (length(v_nota) > 500 or v_nota ~ c_prohibidos_nota) then
    v_campos := array_append(v_campos, 'nota');
  end if;
  if clave_envio is null then
    v_campos := array_append(v_campos, 'clave_envio');
  end if;
  v_items := private.validar_items_pedido(items);
  if v_items is null then
    v_campos := array_append(v_campos, 'items');
  end if;
  if cardinality(v_campos) > 0 then
    return jsonb_build_object('estado', 'invalido', 'campos', to_jsonb(v_campos));
  end if;

  -- Idempotencia (FR-058): repetir una clave devuelve el MISMO presupuesto, sin crear otro ni gastar cupo ni topes.
  select pt.comprobante_id, c.numero, c.fecha, c.total_con_iva into v_previo
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.clave_envio = clave_envio;
  if found then
    return jsonb_build_object('estado', 'ok', 'numero', v_previo.numero, 'fecha', v_previo.fecha, 'total_con_iva', v_previo.total_con_iva);
  end if;

  -- Lock por cuenta (FR-057): dos llamadas simultáneas de la misma cuenta se serializan; el conteo y el alta no se pisan.
  perform pg_advisory_xact_lock(hashtextextended('presupuesto|' || v_cuenta.cuenta_cliente_id::text, 0));

  -- La otra llamada pudo terminar mientras esperábamos el lock con LA MISMA clave: es una repetición, no un presupuesto nuevo.
  select pt.comprobante_id, c.numero, c.fecha, c.total_con_iva into v_previo
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.clave_envio = clave_envio;
  if found then
    return jsonb_build_object('estado', 'ok', 'numero', v_previo.numero, 'fecha', v_previo.fecha, 'total_con_iva', v_previo.total_con_iva);
  end if;

  -- Topes por cuenta (D-9, D-23): 5 creados por día (día de Buenos Aires) y 10 `pendiente` abiertos desde la tienda.
  v_inicio_dia := v_hoy::timestamp at time zone 'America/Argentina/Buenos_Aires';
  select count(*) into v_creados
    from dominio.presupuestos_tienda pt
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and pt.creado_en >= v_inicio_dia;
  select count(*) into v_abiertos
    from dominio.presupuestos_tienda pt
    join dominio.comprobantes_venta c on c.id = pt.comprobante_id and c.organizacion_id = pt.organizacion_id
   where pt.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and c.estado = 'pendiente';
  if v_creados >= private.limite_presupuestos_por_dia() or v_abiertos >= private.limite_presupuestos_abiertos() then
    return jsonb_build_object('estado', 'limite_cuenta');
  end if;

  -- Motor: las líneas salen del servidor (precio, escala, descuento de la ficha, IVA, promoción, depósito); nada de esto viene del llamador.
  select coalesce(jsonb_agg(to_jsonb(m) order by m.orden), '[]'::jsonb) into v_lineas
    from private.motor_presupuesto_tienda(v_cuenta.cuenta_cliente_id, v_items) m;
  if jsonb_array_length(v_lineas) <> jsonb_array_length(v_items) then
    return jsonb_build_object('estado', 'error');
  end if;
  select l.producto_id, l.estado into v_malo
    from jsonb_to_recordset(v_lineas) as l(orden integer, producto_id uuid, estado text)
   where l.estado <> 'ok'
   order by (l.estado = 'no_disponible') desc, l.orden
   limit 1;
  if found then
    if v_malo.estado = 'no_disponible' then
      return jsonb_build_object('estado', 'no_disponible', 'producto_id', v_malo.producto_id);
    end if;
    return jsonb_build_object('estado', 'sin_precio', 'producto_id', v_malo.producto_id);
  end if;
  if exists (select 1 from jsonb_to_recordset(v_lineas) as l(deposito_id uuid) where l.deposito_id is null) then
    return jsonb_build_object('estado', 'error');
  end if;
  select sum(l.subtotal_sin_iva), sum(l.iva) into v_total_sin, v_total_iva
    from jsonb_to_recordset(v_lineas) as l(subtotal_sin_iva numeric, iva numeric);
  if v_total_sin + v_total_iva >= 1000000000000 then
    return jsonb_build_object('estado', 'invalido', 'campos', jsonb_build_array('items'));
  end if;

  select cl.numero, cl.nombre into v_cliente
    from public.clientes cl where cl.id = v_cuenta.cliente_id and cl.organizacion_id = v_cuenta.organizacion_id;
  select e.nombre into v_empresa_nombre from dominio.empresas e where e.id = v_cuenta.empresa_id and e.organizacion_id = v_cuenta.organizacion_id;

  -- Sub-transacción: si CUALQUIER paso falla se revierte todo (número, comprobante, líneas, vínculo, actividad y cupo de la tienda).
  begin
    v_registro := private.registrar_envio_tienda(v_cuenta.empresa_id, 'presupuesto', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_registro ->> 'espera_segundos')::integer);
    end if;
    if v_registro ->> 'estado' <> 'nuevo' then
      -- Esa clave ya está registrada en la tienda por otro envío: no es una repetición de esta cuenta (eso se resolvió arriba).
      return jsonb_build_object('estado', 'error');
    end if;

    v_numero := private.siguiente_numero_comprobante_org(v_cuenta.organizacion_id, v_cuenta.empresa_id, 'presupuesto');
    insert into dominio.comprobantes_venta (
      organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
      total_sin_iva, total_con_iva, canal, operador_id, valido_hasta
    )
    values (
      v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cliente_id, 'presupuesto', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'pendiente',
      v_total_sin, v_total_sin + v_total_iva, 'tienda_online', null, null
    )
    returning * into v_comprobante;

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
      descuento_pct, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
    )
    select v_cuenta.organizacion_id, v_comprobante.id, l.orden, l.producto_id, l.descripcion, l.codigo, l.cantidad, l.precio_unitario, l.escala,
           false, l.alicuota_id, l.alicuota_porcentaje, l.deposito_id, l.a_pedido, l.subtotal_sin_iva, l.iva,
           l.descuento_pct, l.precio_referencia, l.promocion_id, l.lista_precio_id, l.lista_ajuste_pct
      from jsonb_to_recordset(v_lineas) as l(
        orden integer, producto_id uuid, descripcion text, codigo text, cantidad integer, precio_unitario numeric, escala text,
        alicuota_id uuid, alicuota_porcentaje numeric, deposito_id uuid, a_pedido boolean, subtotal_sin_iva numeric, iva numeric,
        descuento_pct numeric, precio_referencia numeric, promocion_id uuid, lista_precio_id uuid, lista_ajuste_pct numeric)
     order by l.orden;

    insert into dominio.presupuestos_tienda (organizacion_id, empresa_id, cuenta_cliente_id, cliente_id, comprobante_id, clave_envio, nota)
    values (v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cuenta_cliente_id, v_cuenta.cliente_id, v_comprobante.id, clave_envio, v_nota);

    -- Auditoría (FR-060): sin actor de panel; con número del presupuesto, tienda y cliente (Nº y nombre), SIN correo ni teléfono.
    perform private.insertar_actividad(
      v_cuenta.organizacion_id,
      null,
      'presupuesto.creado_desde_tienda',
      left(format('Presupuesto %s pedido desde la tienda %s por el cliente Nº %s · %s',
                  v_comprobante.numero, coalesce(v_empresa_nombre, ''), coalesce(v_cliente.numero::text, ''),
                  btrim(regexp_replace(coalesce(v_cliente.nombre, ''), c_prohibidos_linea, ' ', 'g'))), 300),
      v_cuenta.empresa_id
    );

    return jsonb_build_object('estado', 'ok', 'numero', v_comprobante.numero, 'fecha', v_comprobante.fecha, 'total_con_iva', v_comprobante.total_con_iva);
  exception when others then
    -- Rastro en el servidor solo con sqlstate: sqlerrm puede traer datos de la persona.
    raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  exception when others then
    raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
exception when others then
  -- Solo llegan acá los fallos de la bandera, la cuenta o el cupo (antes del bloque de arriba).
  raise warning 'crear_presupuesto_tienda falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) from public, anon;
grant execute on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) to authenticated;

comment on function publico.crear_presupuesto_tienda(text, jsonb, text, uuid) is
  'MSF-176 (B2, FR-051 a FR-060): crea UN presupuesto pendiente (canal tienda_online, sin operador, sin validez) para la cuenta ACTIVA de la tienda del host, con precio del servidor (motor del panel: descuento de la ficha, escala, promoción, IVA), numeración correlativa, líneas, vínculo y evento de actividad en una sola transacción. Solo authenticated; no recibe cliente, empresa, precios ni descuento. Idempotente por (cuenta, clave_envio); topes de 5 por día y 10 abiertos por cuenta con lock; cupo de llamadas antes de calcular y cupo por hora de la tienda. Sin efectos de stock ni dinero. {estado: ok|invalido|sin_precio|no_disponible|limite|limite_cuenta|sin_acceso|error}, sin datos internos.';
