-- MSF-467 · Opiniones de productos, Fase 3 «Opinar desde la tienda» (T013, T019, T020). RF-OPI-2 a RF-OPI-8, RF-OPI-16, RF-OPI-17; D2, D6, D12.
--
-- Esquemas (Principio VII, re-verificado): no se crea ni altera ninguna tabla.
--   * publico.guardar_opinion_por_dominio / borrar_opinion_por_dominio / mis_opiniones_por_dominio -> `publico`: superficie de la
--     tienda (`publico` sigue SIN tablas). Leen y escriben `dominio.opiniones_producto`, que no tiene privilegios de API.
--
-- Reglas comunes (contrato `contracts/opiniones.md`):
--   * `security definer`, `search_path = ''`, nombres calificados, SIN SQL dinámico.
--   * Orden de verificaciones: bandera `tienda_opiniones` -> `private.cuenta_de_tienda(host)` -> límite por visitante -> validar
--     entradas -> trabajar. `sin_acceso` es idéntico para sin sesión, sin cuenta, cuenta suspendida, cliente no habilitado, usuario
--     del panel, otra tienda, host desconocido, empresa desactivada o pausada y bandera apagada (sin tocar datos).
--   * Ninguna recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`: todo sale de la cuenta de la sesión. Un cliente
--     NUNCA envía `estado`: toda alta o edición con contenido nuevo queda `pendiente` (RF-OPI-2, RF-OPI-3).
--   * Límite por visitante (HMAC, `private.registrar_pedido_publico`) con clave propia `opinion|escritura|<visitante>`: 10 por
--     minuto; cuentan también las llamadas inválidas, porque el cupo se consume ANTES de validar (RF-OPI-17, CA-OPI-10).
--   * Topes (D12): 50 opiniones por cuenta y 10 pendientes a la vez, contando solo productos visibles hoy (como los favoritos: un
--     producto oculto no ocupa cupo ni se lista, y la persona no queda trabada por algo que no puede ver).
--   * Respuestas siempre `jsonb` con `estado`; el `exception when others` registra solo `sqlstate`, nunca `sqlerrm`.
--   * Solo `authenticated`: `revoke … from public, anon` y `grant … to authenticated` explícitos.
--
-- Cuenta suspendida o dada de baja de «Habilitado en» (caso borde): `cuenta_de_tienda` no la devuelve, así que no crea, edita ni
-- borra; lo ya aceptado sigue visible porque la lectura pública (fase 4) no depende de la cuenta.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.guardar_opinion_por_dominio(text, uuid, integer, text);
--   drop function if exists publico.borrar_opinion_por_dominio(text, uuid);
--   drop function if exists publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer);
--   drop function if exists private.limite_opiniones_escritura_por_minuto();
--   drop function if exists private.limite_opiniones_lectura_por_minuto();

-- Topes por minuto y por visitante (funciones para ajustarlos sin tocar las RPC).
create or replace function private.limite_opiniones_escritura_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10; $$;

create or replace function private.limite_opiniones_lectura_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30; $$;

revoke execute on function private.limite_opiniones_escritura_por_minuto() from public, anon, authenticated;
revoke execute on function private.limite_opiniones_lectura_por_minuto() from public, anon, authenticated;

-- ============================================================================
-- Guardar (crear o editar): upsert por (cuenta, producto), siempre pendiente
-- ============================================================================
create or replace function publico.guardar_opinion_por_dominio(host text, producto_id uuid, puntuacion integer, comentario text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope_opiniones constant integer := 50;
  c_tope_pendientes constant integer := 10;
  v_cuenta record;
  v_limite jsonb;
  v_validacion jsonb;
  v_texto text;
  v_visible boolean;
  v_total integer;
  v_pendientes integer;
  v_actual dominio.opiniones_producto%rowtype;
  v_id uuid;
  v_estado text;
begin
  if not private.bandera_activa('tienda_opiniones') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Cupo de LLAMADAS: se consume ANTES de validar ni de evaluar el catálogo, así también cuentan las llamadas inválidas.
  v_limite := private.registrar_pedido_publico(
    'opinion|escritura|' || private.visitante_publico(host), private.limite_opiniones_escritura_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  v_validacion := private.validar_texto_opinion(puntuacion, comentario);
  if not (v_validacion ->> 'ok')::boolean then
    return jsonb_build_object('estado', 'invalido', 'campos', v_validacion -> 'campos');
  end if;
  v_texto := v_validacion ->> 'comentario';

  if producto_id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  -- Un lock por cuenta: dos altas simultáneas no superan los topes ni duplican la fila.
  perform pg_advisory_xact_lock(hashtextextended('opiniones|' || v_cuenta.cuenta_cliente_id::text, 0));

  -- El producto debe ser efectivamente visible en ESTA tienda (inexistente, oculto, inactivo, de otra tienda u organización
  -- responden igual: no_encontrado). Una sola evaluación del catálogo efectivo sirve para la visibilidad y para los topes.
  with visibles as materialized (
    select x.producto_id
      from private.catalogo_tienda_efectivo(v_cuenta.empresa_id) x
     where x.efectivo
  )
  select exists (select 1 from visibles v where v.producto_id = producto_id),
         (select count(*)::integer
            from dominio.opiniones_producto o
            join visibles v on v.producto_id = o.producto_id
           where o.cuenta_cliente_id = v_cuenta.cuenta_cliente_id),
         (select count(*)::integer
            from dominio.opiniones_producto o
            join visibles v on v.producto_id = o.producto_id
           where o.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and o.estado = 'pendiente')
    into v_visible, v_total, v_pendientes;

  if not v_visible then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  select * into v_actual
    from dominio.opiniones_producto o
   where o.cuenta_cliente_id = v_cuenta.cuenta_cliente_id and o.producto_id = producto_id
     for update;

  if found then
    -- Idempotencia (D12.d): el mismo contenido responde ok sin cambiar estado, fecha ni cupo (un reintento por red caída).
    if v_actual.puntuacion = puntuacion and v_actual.comentario = v_texto then
      return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object(
        'id', v_actual.id, 'estado', v_actual.estado, 'puntuacion', v_actual.puntuacion, 'comentario', v_actual.comentario));
    end if;
    -- Editar una aceptada o rechazada la devuelve a pendiente: ocupa un cupo de pendientes que antes no ocupaba.
    if v_actual.estado <> 'pendiente' and v_pendientes >= c_tope_pendientes then
      return jsonb_build_object('estado', 'limite_pendientes');
    end if;
    update dominio.opiniones_producto o
       set puntuacion = puntuacion,
           comentario = v_texto,
           estado = 'pendiente',
           motivo_rechazo = null,
           moderada_por = null,
           moderada_en = null,
           actualizada_en = now()
     where o.id = v_actual.id
    returning o.id into v_id;
    v_estado := 'pendiente';
  else
    if v_total >= c_tope_opiniones then
      return jsonb_build_object('estado', 'limite_opiniones');
    end if;
    if v_pendientes >= c_tope_pendientes then
      return jsonb_build_object('estado', 'limite_pendientes');
    end if;
    insert into dominio.opiniones_producto (organizacion_id, empresa_id, cuenta_cliente_id, producto_id, puntuacion, comentario)
    values (v_cuenta.organizacion_id, v_cuenta.empresa_id, v_cuenta.cuenta_cliente_id, producto_id, puntuacion, v_texto)
    returning id into v_id;
    v_estado := 'pendiente';
  end if;

  return jsonb_build_object('estado', 'ok', 'opinion', jsonb_build_object(
    'id', v_id, 'estado', v_estado, 'puntuacion', puntuacion, 'comentario', v_texto));
exception when others then
  -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
  raise warning 'guardar_opinion_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.guardar_opinion_por_dominio(text, uuid, integer, text) from public, anon;
grant execute on function publico.guardar_opinion_por_dominio(text, uuid, integer, text) to authenticated;

comment on function publico.guardar_opinion_por_dominio(text, uuid, integer, text) is
  'MSF-467 (RF-OPI-2 a 7, D2, D6, D12): crea o edita la opinión de la cuenta activa sobre un producto visible de la tienda del host. Siempre queda pendiente (el cliente nunca envía estado); mismo contenido = ok sin cambios; topes 50 por cuenta y 10 pendientes; 10 llamadas por minuto por visitante. {estado: ok|invalido|limite_opiniones|limite_pendientes|no_encontrado|limite|sin_acceso|error}.';

-- ============================================================================
-- Borrar la propia opinión (idempotente)
-- ============================================================================
create or replace function publico.borrar_opinion_por_dominio(host text, producto_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_limite jsonb;
begin
  if not private.bandera_activa('tienda_opiniones') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  v_limite := private.registrar_pedido_publico(
    'opinion|escritura|' || private.visitante_publico(host), private.limite_opiniones_escritura_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite ->> 'espera_segundos')::integer);
  end if;

  -- Solo la fila de la propia cuenta: no hace falta que el producto siga visible (la persona puede liberar cupo siempre).
  -- Borrar una inexistente es ok (idempotente) y no distingue «no hay» de «no es tuya».
  delete from dominio.opiniones_producto o
   where o.cuenta_cliente_id = v_cuenta.cuenta_cliente_id
     and o.organizacion_id = v_cuenta.organizacion_id
     and o.empresa_id = v_cuenta.empresa_id
     and o.producto_id = producto_id;

  return jsonb_build_object('estado', 'ok');
exception when others then
  raise warning 'borrar_opinion_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.borrar_opinion_por_dominio(text, uuid) from public, anon;
grant execute on function publico.borrar_opinion_por_dominio(text, uuid) to authenticated;

comment on function publico.borrar_opinion_por_dominio(text, uuid) is
  'MSF-467 (RF-OPI-3, D6): borra la opinión de la cuenta activa sobre un producto. Idempotente (inexistente = ok); solo toca filas de la propia cuenta; 10 llamadas por minuto por visitante. {estado: ok|limite|sin_acceso|error}.';

-- ============================================================================
-- «Mis opiniones»: lista de la cuenta con su estado y el motivo de rechazo
-- ============================================================================
create or replace function publico.mis_opiniones_por_dominio(
  host text,
  desde_creada timestamptz default null,
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
  v_total bigint;
  v_filas jsonb;
  v_siguiente jsonb;
begin
  if not private.bandera_activa('tienda_opiniones') then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  select * into v_cuenta from private.cuenta_de_tienda(host);
  if not found then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;

  -- Solo productos visibles hoy (como los favoritos). El cursor (creada_en, id) solo ordena: la consulta siempre filtra por la cuenta.
  with base as (
    select o.id, o.creada_en, o.producto_id, o.puntuacion, o.comentario, o.estado, o.motivo_rechazo, o.actualizada_en
      from dominio.opiniones_producto o
      join private.catalogo_tienda_efectivo(v_cuenta.empresa_id) x on x.producto_id = o.producto_id and x.efectivo
     where o.cuenta_cliente_id = v_cuenta.cuenta_cliente_id
       and o.empresa_id = v_cuenta.empresa_id
       and o.organizacion_id = v_cuenta.organizacion_id
  ),
  pagina as (
    select b.*
      from base b
     where desde_creada is null or desde_id is null or (b.creada_en, b.id) < (desde_creada, desde_id)
     order by b.creada_en desc, b.id desc
     limit v_limite + 1
  ),
  numerada as (
    select p.*, row_number() over (order by p.creada_en desc, p.id desc) as n
      from pagina p
  )
  select (select count(*) from base),
         coalesce(jsonb_agg(
           jsonb_build_object(
             'id', nu.id,
             'producto_id', nu.producto_id,
             'producto_nombre', pr.nombre,
             'puntuacion', nu.puntuacion,
             'comentario', nu.comentario,
             'estado', nu.estado,
             'motivo_rechazo', nu.motivo_rechazo,
             'creada_en', nu.creada_en,
             'actualizada_en', nu.actualizada_en
           ) order by nu.n) filter (where nu.n <= v_limite), '[]'::jsonb),
         (select jsonb_build_object('creada', u.creada_en, 'id', u.id)
            from numerada u
           where u.n = v_limite and exists (select 1 from numerada s where s.n = v_limite + 1))
    into v_total, v_filas, v_siguiente
    from numerada nu
    join dominio.productos pr on pr.id = nu.producto_id and pr.organizacion_id = v_cuenta.organizacion_id;

  return jsonb_build_object('estado', 'ok', 'total', v_total, 'filas', v_filas, 'siguiente', v_siguiente);
exception when others then
  raise warning 'mis_opiniones_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer) from public, anon;
grant execute on function publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer) to authenticated;

comment on function publico.mis_opiniones_por_dominio(text, timestamptz, uuid, integer) is
  'MSF-467 (RF-OPI-8): opiniones de la cuenta activa en la tienda del host (solo de productos visibles hoy), nuevas primero, cursor (desde_creada, desde_id) que solo ordena, límite 1–50 (20). Incluye estado y motivo de rechazo: solo las ve la cuenta autora. siguiente = {creada, id} o null.';
