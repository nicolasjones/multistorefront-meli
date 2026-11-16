-- MSF-467 · Opiniones de productos, Fase 4 «Leer en la ficha» (T021). RF-OPI-9, RF-OPI-10, RF-OPI-12, RF-OPI-16, RF-OPI-17; D7, D8, D9.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.opiniones_producto_por_dominio / capacidades_opiniones_por_dominio -> `publico`: superficie de la tienda
--     (`publico` sigue SIN tablas). Leen `dominio.opiniones_producto`, que no tiene privilegios de API.
--
-- Reglas (contrato `contracts/opiniones.md`):
--   * Ejecutables por `anon` y `authenticated` (son lectura de contenido ya moderado); `security definer`, `search_path = ''`,
--     sin SQL dinámico; el `exception when others` registra solo `sqlstate`.
--   * Solo opiniones ACEPTADAS de ESA tienda y ESE producto (D7, D8); pendientes y rechazadas no se ven ni cuentan por ninguna
--     vía. Promedio (un decimal) y cantidad salen de las mismas filas aceptadas.
--   * LISTA BLANCA de campos: id, nombre_pila (D9), puntuacion, comentario, fecha (día, zona de Buenos Aires) y es_mia.
--     Nunca estado, motivo, ids de cliente, cuenta, organización ni empresa, correo, apellido ni teléfono.
--   * El producto debe ser efectivamente visible en la tienda: oculto, inactivo, de otra tienda u organización o inexistente
--     responden todos `no_encontrado`. Las aceptadas de una cuenta suspendida siguen visibles (no dependen de la cuenta).
--   * Bandera apagada: lista vacía sin tocar datos (RF-OPI-12); `capacidades` responde `opiniones:false`.
--   * Límite por visitante (HMAC): `opinion|lectura|<visitante>`, 30 por minuto, se consume antes de validar el producto.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer);
--   drop function if exists publico.capacidades_opiniones_por_dominio(text);

-- ============================================================================
-- Capacidades: ¿se dibuja el bloque de opiniones?
-- ============================================================================
create or replace function publico.capacidades_opiniones_por_dominio(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not exists (
    select 1
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ) then
    return jsonb_build_object('estado', 'error');
  end if;

  return jsonb_build_object('estado', 'ok', 'opiniones', private.bandera_activa('tienda_opiniones'));
exception when others then
  raise warning 'capacidades_opiniones_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.capacidades_opiniones_por_dominio(text) from public, anon;
grant execute on function publico.capacidades_opiniones_por_dominio(text) to anon, authenticated;

comment on function publico.capacidades_opiniones_por_dominio(text) is
  'MSF-467 (RF-OPI-10): {estado, opiniones} con el valor de la bandera tienda_opiniones para la tienda del host. Host desconocido, empresa desactivada y tienda pausada → {estado: error} idéntico. No devuelve ningún otro dato.';

-- ============================================================================
-- Ficha: resumen y opiniones aceptadas
-- ============================================================================
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

  -- El resumen y la lista salen del MISMO conjunto (aceptadas con su cuenta y su cliente): promedio y cantidad siempre coinciden con
  -- lo que se puede paginar. Las FK garantizan que cuenta y cliente existen; el join solo hace explícito el conjunto compartido.
  select round(avg(o.puntuacion)::numeric, 1), count(*)
    into v_promedio, v_cantidad
    from dominio.opiniones_producto o
    join public.cuentas_cliente cc on cc.id = o.cuenta_cliente_id
    join dominio.clientes cl on cl.id = cc.cliente_id and cl.organizacion_id = cc.organizacion_id
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

revoke execute on function publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer) to anon, authenticated;

comment on function publico.opiniones_producto_por_dominio(text, uuid, timestamptz, uuid, integer) is
  'MSF-467 (RF-OPI-9, D7, D9): resumen {promedio (un decimal o null), cantidad} y opiniones ACEPTADAS del producto en la tienda del host, nuevas primero, cursor (creada_en, id) que solo ordena, límite 1–50 (10). Lista blanca: id, nombre_pila, puntuacion, comentario, fecha, es_mia. Producto no visible = no_encontrado; 30 llamadas por minuto por visitante; bandera apagada = lista vacía.';
