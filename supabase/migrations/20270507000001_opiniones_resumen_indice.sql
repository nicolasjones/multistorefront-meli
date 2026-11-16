-- MSF-467 · Opiniones de productos · Cierre (T029, revisión de seguridad). Hallazgo menor H-1.
--
-- Esquemas (Principio VII, re-verificado): sin tablas nuevas ni alteradas.
--   * publico.opiniones_producto_por_dominio -> `publico`: superficie de la tienda (misma firma, misma respuesta).
--   * dominio.opiniones_producto -> `dominio`: solo se le AGREGA un índice (no cambia ninguna columna).
--
-- HALLAZGO H-1 (límites / agotamiento de recursos): el resumen de la ficha (promedio y cantidad) se recalcula en CADA llamada
-- (incluido cada «Cargar más») sobre TODAS las opiniones aceptadas del producto, y la agregación unía además
-- `public.cuentas_cliente` y `dominio.clientes` con joins interiores. Esas uniones son redundantes: la FK compuesta
-- (cuenta_cliente_id, organizacion_id, empresa_id) -> public.cuentas_cliente y la FK (cliente_id, organizacion_id) ->
-- dominio.clientes garantizan que la cuenta y el cliente existen, así que el join nunca descarta filas; lo que hace es
-- obligar a traer el heap de cada opinión aceptada (y de su cuenta y su cliente) en cada página y en cada visitante. Con el
-- cupo de 30 llamadas por minuto por visitante, el costo se multiplica y una tienda con muchas opiniones sobre un mismo
-- producto paga un escaneo completo del producto en cada visita a la ficha.
--
-- Arreglo: (1) el resumen se calcula SOLO sobre `dominio.opiniones_producto` (sin uniones redundantes) y (2) se agrega un
-- índice parcial cubriente con `puntuacion`, para que `count(*)` y `avg(puntuacion)` se resuelvan con lectura de índice y no
-- con acceso al heap. El conjunto de filas y el resultado NO cambian: son las mismas aceptadas de ese producto en esa tienda.
--
-- Lo que NO cambia (contrato `contracts/opiniones.md`): firma, respuesta, lista blanca de campos, orden, cursor, topes,
-- `es_mia`, el comportamiento con la bandera apagada y los mensajes de error.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop index if exists dominio.opiniones_producto_resumen_idx;
--   restaurar la función desde 20270419000100_opiniones_lectura_publica.sql;

-- Índice parcial cubriente para el resumen de la ficha: con `include (puntuacion)` el agregado es index-only.
create index if not exists opiniones_producto_resumen_idx
  on dominio.opiniones_producto (empresa_id, organizacion_id, producto_id)
  include (puntuacion)
  where estado = 'aceptada';

comment on index dominio.opiniones_producto_resumen_idx is
  'MSF-467 (T029, H-1): índice parcial cubriente del resumen de la ficha (promedio y cantidad) por tienda, organización y producto, con `puntuacion` incluido para que la agregación no acceda al heap.';

create or replace function publico.opiniones_producto_por_dominio(
  host text,
  producto_id uuid,
  desde_creada timestamptz default null,
  desde_id uuid default null,
  limite integer default 10
)
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
  v_cuenta uuid;
  v_limite_llamadas jsonb;
  v_limite integer := least(greatest(coalesce(limite, 10), 1), 50);
  v_visible boolean;
  v_promedio numeric;
  v_cantidad bigint;
  v_filas jsonb;
  v_siguiente jsonb;
begin
  -- Bandera apagada: ficha idéntica a la de hoy, sin tocar datos ni gastar cupo.
  if not private.bandera_activa('tienda_opiniones') then
    return jsonb_build_object('estado', 'ok',
      'resumen', jsonb_build_object('promedio', null, 'cantidad', 0), 'filas', '[]'::jsonb, 'siguiente', null);
  end if;

  select e.id, e.organizacion_id into v_empresa, v_org
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id and e.activa
   where ti.dominio = private.normalizar_host(host);
  if v_empresa is null then
    return jsonb_build_object('estado', 'error');
  end if;

  v_limite_llamadas := private.registrar_pedido_publico(
    'opinion|lectura|' || private.visitante_publico(host), private.limite_opiniones_lectura_por_minuto());
  if (v_limite_llamadas ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite_llamadas ->> 'espera_segundos')::integer);
  end if;

  if producto_id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  select exists (
    select 1 from private.catalogo_tienda_efectivo(v_empresa) x
     where x.producto_id = producto_id and x.efectivo)
    into v_visible;
  if not v_visible then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  -- Con sesión, marca la propia (si no hay sesión o cuenta válida, nadie es «mía»).
  select c.cuenta_cliente_id into v_cuenta from private.cuenta_de_tienda(host) c;

  -- El resumen y la lista salen del MISMO conjunto (aceptadas): promedio y cantidad siempre coinciden con lo que se puede
  -- paginar. T029 (H-1): el resumen se calcula SOLO sobre la tabla de opiniones (las FK garantizan que la cuenta y el cliente
  -- existen: las uniones interiores no descartaban ninguna fila y obligaban a leer el heap de cada opinión aceptada). Con el
  -- índice parcial cubriente `opiniones_producto_resumen_idx` la agregación es index-only.
  select round(avg(o.puntuacion)::numeric, 1), count(*)
    into v_promedio, v_cantidad
    from dominio.opiniones_producto o
   where o.empresa_id = v_empresa and o.organizacion_id = v_org
     and o.producto_id = producto_id and o.estado = 'aceptada';

  -- Un cursor a medias se ignora; el cursor (creada_en, id) solo ordena.
  with pagina as (
    select o.id, o.creada_en, o.puntuacion, o.comentario, o.cuenta_cliente_id
      from dominio.opiniones_producto o
     where o.empresa_id = v_empresa and o.organizacion_id = v_org
       and o.producto_id = producto_id and o.estado = 'aceptada'
       and (desde_creada is null or desde_id is null or (o.creada_en, o.id) < (desde_creada, desde_id))
     order by o.creada_en desc, o.id desc
     limit v_limite + 1
  ),
  numerada as (
    select p.*, row_number() over (order by p.creada_en desc, p.id desc) as n
      from pagina p
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', nu.id,
             'nombre_pila', private.nombre_publico_cliente(cl.nombre),
             'puntuacion', nu.puntuacion,
             'comentario', nu.comentario,
             'fecha', to_char(nu.creada_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
             'es_mia', v_cuenta is not null and nu.cuenta_cliente_id = v_cuenta
           ) order by nu.n) filter (where nu.n <= v_limite), '[]'::jsonb),
         (select jsonb_build_object('creada', u.creada_en, 'id', u.id)
            from numerada u
           where u.n = v_limite and exists (select 1 from numerada s where s.n = v_limite + 1))
    into v_filas, v_siguiente
    from numerada nu
    join public.cuentas_cliente cc on cc.id = nu.cuenta_cliente_id
    join dominio.clientes cl on cl.id = cc.cliente_id and cl.organizacion_id = cc.organizacion_id;

  return jsonb_build_object('estado', 'ok',
    'resumen', jsonb_build_object('promedio', v_promedio, 'cantidad', v_cantidad),
    'filas', v_filas, 'siguiente', v_siguiente);
exception when others then
  raise warning 'opiniones_producto_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

comment on function publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer) is
  'MSF-467 (RF-OPI-9, D7, D9): resumen {promedio (un decimal o null), cantidad} y opiniones ACEPTADAS del producto en la tienda del host, nuevas primero, cursor (creada_en, id) que solo ordena, límite 1-50 (10). Lista blanca: id, nombre_pila, puntuacion, comentario, fecha, es_mia. Producto no visible = no_encontrado; 30 llamadas por minuto por visitante; bandera apagada = lista vacía. T029 (H-1): el resumen se calcula solo sobre la tabla de opiniones (índice parcial cubriente).';
