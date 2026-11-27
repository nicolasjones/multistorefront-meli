-- MSF-1001 (seguimiento de MSF-176 H-3, decisión de diseño): CUPO POR CUENTA en `publico.acceso_cliente_por_dominio`,
-- `publico.precios_cliente_por_dominio` y `publico.mis_opiniones_por_dominio`.
--
-- El PR de cierre de seguridad de MSF-176 (20270507300200) puso 120 llamadas por minuto y cuenta a las cinco RPC de «Mi cuenta» y dejó
-- estas tres afuera a la espera de una decisión: ¿cupo o caché, y con qué costo de rendimiento? DECISIÓN: cupo persistente, con el mismo
-- mecanismo que ya usan las otras (`private.registrar_pedido_publico`, contador por minuto en `public.limite_pedidos_publicos`, que sobrevive
-- a reinicios y vale entre instancias), con tope MÁS ALTO que las de «Mi cuenta» porque se piden en cada carga de la tienda. Sin caché (FR-035:
-- el estado y el tipo de la cuenta rigen al instante).
--   * `acceso_cliente_por_dominio`: 240 por minuto y cuenta de Auth (clave `acceso|<uid>`). Sin sesión no hay cuenta ni cupo (respuesta barata e igual).
--   * `precios_cliente_por_dominio`: 240 por minuto y cuenta de Auth (clave `precios|<uid>`), tomado ANTES de resolver el acceso y calcular precios
--     (hasta 50 productos por llamada). Ya no llama a la pública de acceso (que tomaría otro cupo): llama a `private.acceso_cliente_resuelto`,
--     el cuerpo de siempre sin cupo.
--   * `mis_opiniones_por_dominio`: además del cupo por visitante (`opinion|lectura|…`, que se conserva), 120 por minuto y cuenta
--     (clave `opiniones_cuenta|<cuenta>`, la misma constante que «Mi cuenta» pero un contador propio).
-- Superado el cupo: `{estado: limite, espera_segundos}`, como las demás. Es la única diferencia de contrato y solo aparece ante un abuso: la forma de
-- las respuestas normales (activa|suspendida|sin_cuenta|no_habilitado|null; {tipo, precios}; {estado: ok|…}) no cambia. La web lo trata como error
-- reintentable (`consultarAcceso`) o cae al precio público (`leerPreciosCliente`). El cupo se toma antes de cualquier lectura y NO antes de un `raise`:
-- un error revertiría el contador, por eso estas funciones no lanzan después de tomarlo salvo el tope de 50 productos, que se valida antes.
-- Cuerpos de partida: los vigentes (20261211100200, 20270507000200 y 20270419000000). `acceso` y `precios` pasan de `stable` a `volatile` (escriben el contador).
-- Mismas firmas y grants (`create or replace`: solo `authenticated`).
--
-- Esquemas (Principio VII): sin tablas nuevas. Migración aditiva. Reversión (migración posterior): restaurar las tres funciones a los cuerpos de
-- 20261211100200 (acceso), 20270507000200 (precios) y 20270419000000 (opiniones); después
-- `drop function private.acceso_cliente_resuelto(text); drop function private.limite_acceso_cliente_por_minuto(); drop function private.limite_precios_cliente_por_minuto();`.

create or replace function private.limite_acceso_cliente_por_minuto()
returns integer language sql immutable set search_path = '' as $$ select 240; $$;

create or replace function private.limite_precios_cliente_por_minuto()
returns integer language sql immutable set search_path = '' as $$ select 240; $$;

revoke execute on function private.limite_acceso_cliente_por_minuto() from public, anon, authenticated;
revoke execute on function private.limite_precios_cliente_por_minuto() from public, anon, authenticated;

comment on function private.limite_acceso_cliente_por_minuto() is
  'MSF-1001: cupo de llamadas por minuto y cuenta de publico.acceso_cliente_por_dominio (240; se pide en cada carga de la tienda). Interna, sin acceso de API.';
comment on function private.limite_precios_cliente_por_minuto() is
  'MSF-1001: cupo de llamadas por minuto y cuenta de publico.precios_cliente_por_dominio (240; se pide en cada carga de la tienda). Interna, sin acceso de API.';

-- El acceso de siempre, sin cupo: lo usan la pública de acceso y la de precios.
create or replace function private.acceso_cliente_resuelto(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_empresa uuid;
  v_uid uuid := (select auth.uid());
  v_cliente uuid;
  v_estado text;
  v_habilitado boolean;
  v_tipo text;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  if v_uid is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  -- Un usuario de Auth pertenece a un solo cliente (D1, forzado por vincular_cuenta_cliente).
  select cc.cliente_id into v_cliente
    from public.cuentas_cliente cc
    join public.clientes c on c.id = cc.cliente_id and c.archivado_en is null
   where cc.auth_user_id = v_uid
   limit 1;
  if v_cliente is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  select exists (
    select 1 from public.clientes_empresas ce
     where ce.cliente_id = v_cliente and ce.empresa_id = v_empresa
  ) into v_habilitado;

  if not v_habilitado then
    return jsonb_build_object('estado', 'no_habilitado', 'tipo', null);
  end if;

  select cc.estado into v_estado
    from public.cuentas_cliente cc
   where cc.cliente_id = v_cliente and cc.empresa_id = v_empresa and cc.auth_user_id = v_uid;
  if v_estado is null then
    return jsonb_build_object('estado', 'sin_cuenta', 'tipo', null);
  end if;

  if v_estado = 'activa' then
    select c.tipo into v_tipo from public.clientes c where c.id = v_cliente;
    return jsonb_build_object('estado', 'activa', 'tipo', v_tipo);
  end if;

  return jsonb_build_object('estado', v_estado, 'tipo', null);
end;
$$;

revoke execute on function private.acceso_cliente_resuelto(text) from public, anon, authenticated;

comment on function private.acceso_cliente_resuelto(text) is
  'F-CLI-05: estado efectivo de la cuenta del llamador en la tienda del host (cuerpo de publico.acceso_cliente_por_dominio antes del cupo de MSF-1001). Interna, sin acceso de API.';

create or replace function publico.acceso_cliente_por_dominio(host text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_uid uuid := (select auth.uid());
  v_cupo jsonb;
begin
  -- MSF-1001: cupo por cuenta, antes de cualquier lectura. Sin sesión no hay cuenta a la que contar.
  if v_uid is not null then
    v_cupo := private.registrar_pedido_publico('acceso|' || v_uid::text, private.limite_acceso_cliente_por_minuto());
    if (v_cupo ->> 'limitado')::boolean then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
    end if;
  end if;
  return private.acceso_cliente_resuelto(host);
end;
$$;

revoke execute on function publico.acceso_cliente_por_dominio(text) from public, anon;
grant execute on function publico.acceso_cliente_por_dominio(text) to authenticated;

comment on function publico.acceso_cliente_por_dominio(text) is
  'F-CLI-05: estado efectivo (activa | suspendida | sin_cuenta | no_habilitado) de la cuenta web del llamador en la tienda del host y, solo si está activa, el tipo del cliente. «No habilitado» prevalece; host desconocido y empresa desactivada → null. El estado se consulta en cada llamada (la suspensión rige al instante). MSF-1001: 240 llamadas por minuto y cuenta; superado responde {estado: limite, espera_segundos}.';

create or replace function publico.precios_cliente_por_dominio(host text, productos uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_max constant int := 50;
  v_acceso jsonb;
  v_uid uuid := (select auth.uid());
  v_cupo jsonb;
  v_tipo text;
  v_empresa uuid;
  v_cliente uuid;
  v_resultado jsonb;
  v_ahora timestamptz := now();
begin
  if productos is not null and cardinality(productos) > v_max then
    raise exception 'Se pueden pedir hasta % productos por llamada', v_max using errcode = '22023';
  end if;

  -- MSF-1001: cupo por cuenta, ANTES de resolver el acceso y calcular precios. Se pide en cada carga de la tienda, por eso es más
  -- holgado que el de «Mi cuenta». Superado: `{estado: limite, espera_segundos}` (la tienda cae al precio público).
  if v_uid is not null then
    v_cupo := private.registrar_pedido_publico('precios|' || v_uid::text, private.limite_precios_cliente_por_minuto());
    if (v_cupo ->> 'limitado')::boolean then
      return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
    end if;
  end if;

  v_acceso := private.acceso_cliente_resuelto(host);
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
                            'final', case when p.gana then p.promocion else p.normal end
                          ) || case when p.gana then jsonb_build_object('precio_anterior', p.normal) else '{}'::jsonb end
                          order by t.desde)
                   from (values ('x1', 1, 4), ('x5', 5, 9), ('x10', 10, 49), ('x50', 50, null::int))
                        as t (escala, desde, hasta)
                  -- Gana el más bajo, sin acumular (igual que el local y que `private.precio_referencia_pedido`): la
                  -- promoción reemplaza al precio de la escala (o de la lista del cliente) SOLO si, visto como lo ve el
                  -- cliente (alícuota e interruptor de IVA), es estrictamente menor.
                  cross join lateral (
                    select n.v as normal,
                           case when pr.precio is null then null
                                else private.precio_con_iva_visible(x.producto_id, v_empresa, pr.precio) end as promocion,
                           coalesce(private.precio_con_iva_visible(x.producto_id, v_empresa, pr.precio) < n.v, false) as gana
                      from (select private.precio_final_publico_escala(x.producto_id, v_empresa, t.escala, v_cliente) as v) n
                  ) p
                  where t.escala = 'x1' or v_tipo = 'mayorista'
               )
             ) order by x.producto_id), '[]'::jsonb)
         )
    into v_resultado
    from private.catalogo_tienda_efectivo(v_empresa) x
    -- MSF-932 (S1): la promoción vigente de la tienda (ya null con la bandera `promociones_precio` apagada).
    cross join lateral (select private.promocion_vigente(x.producto_id, v_empresa, v_ahora) as precio) pr
   where x.efectivo and x.producto_id = any (coalesce(productos, '{}'::uuid[]));

  return v_resultado;
end;
$$;

revoke execute on function publico.precios_cliente_por_dominio(text, uuid[]) from public, anon;
grant execute on function publico.precios_cliente_por_dominio(text, uuid[]) to authenticated;

comment on function publico.precios_cliente_por_dominio(text, uuid[]) is
  'F-CLI-07: precio final por escala de los productos visibles pedidos, según el tipo del cliente con cuenta activa y habilitada en la tienda del host (minorista: x1; mayorista: x1/x5/x10/x50 con rango). Lista blanca; null idéntico si no hay cuenta activa habilitada, host desconocido o empresa desactivada. Máx. 50 productos por llamada (22023). F-CLI-21: con la bandera listas_precios encendida y una lista asignada al cliente, el precio es el de su lista (D5: no pisa escala cargada ni precio propio). MSF-932: con una promoción vigente de la tienda menor al precio de la escala (gana el más bajo, sin acumular), la escala trae el precio promocional en final y el de la escala en precio_anterior. MSF-1001: 240 llamadas por minuto y cuenta; superado responde {estado: limite, espera_segundos}.';

create or replace function publico.mis_opiniones_por_dominio(
  host text,
  desde_creada timestamptz default null,
  desde_id uuid default null,
  limite integer default 20
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_cuenta record;
  v_limite_llamadas jsonb;
  v_cupo_cuenta jsonb;
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

  -- MSF-1001: cupo por CUENTA (además del de visitante de abajo, que una cuenta con varios dispositivos o visitantes evita).
  v_cupo_cuenta := private.registrar_pedido_publico('opiniones_cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
  if (v_cupo_cuenta ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo_cuenta ->> 'espera_segundos')::integer);
  end if;

  -- Cupo de llamadas de LECTURA (el mismo `opinion|lectura|…` de la ficha: 30 por minuto por visitante). Acota el costo de evaluar el
  -- catálogo efectivo de la tienda en cada llamada. Con el límite superado responde `limite`.
  v_limite_llamadas := private.registrar_pedido_publico(
    'opinion|lectura|' || private.visitante_publico(host), private.limite_opiniones_lectura_por_minuto());
  if (v_limite_llamadas ->> 'limitado')::boolean then
    return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_limite_llamadas ->> 'espera_segundos')::integer);
  end if;

  -- Solo productos visibles hoy (como los favoritos). El cursor (creada_en, id) solo ordena: la consulta siempre filtra por la cuenta.
  -- `base` se materializa: el catálogo efectivo se evalúa UNA vez aunque `base` se use dos veces (la tanda y el total).
  with base as materialized (
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
  'MSF-467 (RF-OPI-8): opiniones de la cuenta activa en la tienda del host (solo de productos visibles hoy), nuevas primero, cursor (desde_creada, desde_id) que solo ordena, límite 1–50 (20). Incluye estado y motivo de rechazo: solo las ve la cuenta autora. 30 llamadas por minuto por visitante y 120 por cuenta (`limite`). siguiente = {creada, id} o null.';
