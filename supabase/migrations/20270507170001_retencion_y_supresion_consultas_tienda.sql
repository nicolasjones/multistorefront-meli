-- MSF-944 · Seguimiento de MSF-176 (T063 y T072; decisión D-20): retención y supresión de
-- consultas, ítems de pedido y presupuestos de la tienda.
--
-- Qué cambia (todo aditivo):
--   1. `public.avisos_pendientes.consulta_id`: la cola de avisos pasa a saber DE QUÉ consulta es
--      cada aviso (FK a `dominio.consultas (id) on delete cascade`). Hoy la cola guardaba el nombre,
--      el contacto y el mensaje del visitante sin relación con la consulta y sin purga: borrar la
--      consulta no borraba la copia (el punto más frágil del assessment).
--   2. `dominio.consultas.suprimido_en` y `dominio.presupuestos_tienda.suprimido_en`: marcas de
--      «los datos personales de esta fila ya no están».
--   3. `private.purgar_consultas_tienda(p_retencion_dias)`: la purga por retención (la dispara el
--      flow `purgar-consultas-tienda`; en el repo no hay `pg_cron`).
--   4. `private.suprimir_titular_tienda(p_organizacion, p_contacto)`: la supresión a pedido del
--      titular (procedimiento del equipo técnico; sin RPC de API).
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * `dominio.consultas` / `dominio.consulta_items` / `dominio.presupuestos_tienda`: `dominio`
--     (ya lo eran; aquí solo se suma una marca y se leen). Son registros de negocio del producto.
--   * `public.avisos_pendientes`: `public` (cola/outbox de plataforma; ya lo era). La columna nueva
--     es una referencia a la consulta de la que el aviso es copia.
--   * `public.cuentas_cliente` / `public.clientes` / `auth.users`: `public` (plataforma); SOLO se
--     leen, para identificar al titular (su `cliente_id` y el correo de su cuenta web).
--   * `private.*`: lógica interna, sin acceso de la API.
--
-- Política de retención (D-21 y D-22 de la spec):
--   * Plazo por defecto: 180 días, por variable de entorno (`TIENDA_CONSULTAS_RETENCION_DIAS`).
--   * Se borra la consulta cuando superó el plazo y NO está `en_curso` (un compromiso comercial
--     vivo no se borra solo). Sus ítems se van en cascada (FK) y sus avisos también (FK nueva).
--   * La `nota` de los presupuestos de la tienda se vacía al superar el plazo. El comprobante de
--     venta (registro fiscal: importes, estados, líneas, fechas) NO se toca, igual que en
--     `public.anonimizar_contacto`.
--   * Idempotente: una segunda pasada no borra nada ni suma eventos.
--
-- Política de supresión (D-23):
--   * Se ANONIMIZA (no se borra la fila): `nombre` y `contacto` quedan en «Anonimizado», `mensaje`
--     en un texto neutro y `nota_interna` en null. Los ítems de esas consultas sí se borran (son la
--     copia de lo que pidió la persona). La nota de los presupuestos se vacía. El comprobante
--     fiscal no se toca.
--   * La cola de avisos: los avisos de esas consultas que aún no se enviaron se borran y los ya
--     enviados pierden las claves con datos personales.
--   * La actividad registra las cantidades, nunca los datos del titular.
--
-- Permisos y superficie:
--   * `private.purgar_consultas_tienda` y `private.suprimir_titular_tienda`: `security definer`,
--     `search_path = ''`, sin `execute` para `public`, `anon` ni `authenticated`. El rol de
--     orquestación (Kestra) y el rol de la API los ejecutan; el resto recibe `42501` y no se toca
--     nada. `private` no está en los esquemas expuestos por la Data API: no hay RPC nueva.
--   * `private.emitir_aviso` y `private.emitir_aviso_consulta`: mismo cuerpo y misma firma, con
--     un cambio: la clave interna `ConsultaId` del payload va a la columna `consulta_id` de la cola
--     y SALE del payload, así que el correo que manda el flow `enviar-avisos` no cambia.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   alter table public.avisos_pendientes drop constraint if exists avisos_pendientes_consulta_id_fk;
--   alter table public.avisos_pendientes drop column if exists consulta_id;
--   alter table dominio.consultas drop column if exists suprimido_en;
--   alter table dominio.presupuestos_tienda drop column if exists suprimido_en;
--   drop function if exists private.purgar_consultas_tienda(integer);
--   drop function if exists private.suprimir_titular_tienda(uuid, text);
--   (recrear `private.emitir_aviso(text, uuid, jsonb, uuid)` y `private.emitir_aviso_consulta(uuid)`
--    con el cuerpo de 20261210130300 y 20270321100300, y borrar el flow `purgar-consultas-tienda`).
-- Lo ya purgado o suprimido no se recupera (salvo desde un backup).

-- ============================================================================
-- 1. La cola de avisos sabe de qué consulta es cada aviso
-- ============================================================================
alter table public.avisos_pendientes add column if not exists consulta_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'avisos_pendientes'
       and c.conname = 'avisos_pendientes_consulta_id_fk'
  ) then
    alter table public.avisos_pendientes
      add constraint avisos_pendientes_consulta_id_fk
      foreign key (consulta_id) references dominio.consultas (id) on delete cascade;
  end if;
end;
$$;

comment on column public.avisos_pendientes.consulta_id is
  'MSF-944: consulta de la que este aviso es copia (FK con borrado en cascada). Con esta relación la purga se lleva la copia de los datos personales del aviso y la supresión sabe a qué consulta pertenece cada fila. Null en los avisos que no son de una consulta.';

create index if not exists avisos_pendientes_consulta_id_idx
  on public.avisos_pendientes (consulta_id)
  where consulta_id is not null;

-- ============================================================================
-- 2. Marcas de supresión
-- ============================================================================
alter table dominio.consultas add column if not exists suprimido_en timestamptz;
alter table dominio.presupuestos_tienda add column if not exists suprimido_en timestamptz;

comment on column dominio.consultas.suprimido_en is
  'MSF-944: momento en que se reemplazaron por valores neutros los datos personales de la consulta (nombre, contacto, mensaje y nota interna). La fila y su estado comercial se conservan; la purga por retención la borra igual que a las demás.';

comment on column dominio.presupuestos_tienda.suprimido_en is
  'MSF-944: momento en que se vació la nota del presupuesto (dato personal del cliente). El comprobante de venta no se toca: es registro fiscal.';

-- La purga busca por fecha y estado; la supresión, por contacto.
create index if not exists consultas_retencion_idx
  on dominio.consultas (updated_at)
  where estado <> 'en_curso';

create index if not exists consultas_contacto_idx
  on dominio.consultas (organizacion_id, lower(btrim(contacto)));

create index if not exists presupuestos_tienda_retencion_idx
  on dominio.presupuestos_tienda (creado_en);

-- ============================================================================
-- 3. Los avisos de consulta guardan su consulta (y no en el correo)
-- ============================================================================
create or replace function private.emitir_aviso(
  p_tipo text,
  p_organizacion uuid,
  p_datos jsonb,
  p_empresa uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seccion text;
  v_destinatario uuid;
  v_encolados integer := 0;
  v_grupo uuid;
  v_vence timestamptz;
  v_consulta_id uuid;
begin
  select t.seccion into v_seccion from public.tipos_aviso t where t.clave = p_tipo;
  if not found then
    raise exception 'Tipo de aviso desconocido' using errcode = '22023';
  end if;

  -- Nunca se amplía el alcance por error: una empresa de otra organización no emite.
  if p_empresa is not null and not exists (
    select 1 from dominio.empresas e
    where e.id = p_empresa and e.organizacion_id = p_organizacion
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '22023';
  end if;

  -- MSF-944: la clave interna `ConsultaId` del payload va a la columna de la cola y SALE del
  -- payload (el correo no cambia). Se valida con una regex para no poder fallar con un cast.
  v_consulta_id := case
    when p_datos ->> 'ConsultaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (p_datos ->> 'ConsultaId')::uuid
    else null
  end;

  for v_destinatario in
    select u.user_id
    from public.usuarios_organizacion u
    join auth.users a on a.id = u.user_id
    where u.organizacion_id = p_organizacion
      and u.estado = 'activo'
      and btrim(coalesce(a.email, '')) <> ''
      and private.nivel_seccion_de_usuario(u.user_id, v_seccion) <> 'ninguno'
      and (
        p_empresa is null
        or exists (
          select 1 from private.empresas_accesibles_de_usuario(u.user_id) ea(id)
          where ea.id = p_empresa
        )
      )
      and coalesce(
        (select p.activo from public.preferencias_aviso p
          where p.user_id = u.user_id and p.tipo_aviso = p_tipo),
        true
      )
  loop
    -- Evita que dos emisiones simultáneas abran dos grupos para lo mismo.
    perform pg_advisory_xact_lock(hashtextextended(v_destinatario::text || ':' || p_tipo, 0));

    v_grupo := null;
    select a.grupo_id, a.ventana_vence_en into v_grupo, v_vence
    from public.avisos_pendientes a
    where a.user_id = v_destinatario
      and a.tipo_aviso = p_tipo
      and a.organizacion_id = p_organizacion
      and a.estado = 'pendiente'
      and a.ventana_vence_en > now()
    order by a.ventana_vence_en desc
    limit 1;

    if v_grupo is null then
      v_grupo := gen_random_uuid();
      v_vence := now() + (select private.ventana_agrupacion_aviso());
    end if;

    insert into public.avisos_pendientes
      (organizacion_id, user_id, tipo_aviso, grupo_id, datos, ventana_vence_en, creado_en, consulta_id)
    values
      -- clock_timestamp(): el orden de llegada del detalle no se pierde entre avisos de una misma transacción.
      (p_organizacion, v_destinatario, p_tipo, v_grupo, coalesce(p_datos, '{}'::jsonb) - 'ConsultaId', v_vence, clock_timestamp(), v_consulta_id);
    v_encolados := v_encolados + 1;
  end loop;

  return v_encolados;
end;
$$;

comment on function private.emitir_aviso(text, uuid, jsonb, uuid) is
  'Encola un aviso para cada destinatario con acceso a la sección del tipo y preferencia encendida, agrupando por destinatario + tipo en la ventana de private.ventana_agrupacion_aviso(). Con p_empresa, solo destinatarios con acceso a esa empresa. La clave interna ConsultaId del payload va a la columna consulta_id de la cola (MSF-944) y sale del payload. Devuelve la cantidad de destinatarios. Solo para funciones security definer de otros componentes.';

revoke execute on function private.emitir_aviso(text, uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function private.emitir_aviso_consulta(p_consulta_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_lineas constant integer := 10;
  v_c dominio.consultas%rowtype;
  v_empresa text;
  v_producto text;
  v_resumen text;
  v_total integer;
  v_cliente text;
begin
  select * into v_c from dominio.consultas c where c.id = p_consulta_id;
  if not found then
    return;
  end if;

  select e.nombre into v_empresa
  from dominio.empresas e
  where e.id = v_c.empresa_id and e.organizacion_id = v_c.organizacion_id;

  if v_c.producto_id is not null then
    select p.nombre into v_producto
    from dominio.productos p
    where p.id = v_c.producto_id and p.organizacion_id = v_c.organizacion_id;
  end if;

  if v_c.origen = 'pedido' then
    select count(*)::integer into v_total from dominio.consulta_items i where i.consulta_id = v_c.id;
    select string_agg(l.cantidad::text || ' × ' || l.descripcion || coalesce(' (' || l.sku || ')', ''), ' · ' order by l.orden)
      into v_resumen
    from (select i.orden, i.cantidad, i.descripcion, i.sku
            from dominio.consulta_items i
           where i.consulta_id = v_c.id
           order by i.orden
           limit c_max_lineas) l;
    if v_total > c_max_lineas then
      v_resumen := v_resumen || ' · y ' || (v_total - c_max_lineas)::text || ' más';
    end if;
    if v_c.cliente_id is not null then
      select 'Nº ' || cl.numero::text || ' · ' || cl.nombre into v_cliente
        from public.clientes cl
       where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
    end if;
  end if;

  begin
    perform private.emitir_aviso(
      'consulta_nueva',
      v_c.organizacion_id,
      jsonb_strip_nulls(jsonb_build_object(
        'Empresa', v_empresa,
        'Origen', case v_c.origen when 'whatsapp' then 'WhatsApp' when 'pedido' then 'Pedido de la tienda' else 'Formulario de contacto' end,
        'Nombre', v_c.nombre,
        'Contacto', v_c.contacto,
        'Producto', v_producto,
        'Pedido', v_resumen,
        'Cliente', v_cliente,
        'Mensaje', left(nullif(btrim(coalesce(v_c.mensaje, '')), ''), 300),
        -- MSF-944: clave interna para atar el aviso a la consulta (no viaja al correo).
        'ConsultaId', v_c.id
      )),
      v_c.empresa_id
    );
  exception when others then
    -- Solo sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'No se pudo emitir el aviso de la consulta %: %', v_c.id, sqlstate;
  end;
end;
$$;

comment on function private.emitir_aviso_consulta(uuid) is
  'MSF-176 (B1, FR-030) + MSF-944: emite el aviso consulta_nueva de una consulta con private.emitir_aviso. Para un pedido suma el resumen de ítems (hasta 10 y «y N más») y el cliente de la cuenta activa. El asunto del correo no lleva datos del visitante. La clave interna ConsultaId ata el aviso a la consulta en la cola. Un fallo se registra (sqlstate) y no frena el alta. Sin acceso de API.';

revoke execute on function private.emitir_aviso_consulta(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. Purga por retención
-- ============================================================================
insert into public.tipos_evento_actividad (tipo, sensible, descripcion)
values ('tienda.datos_purgados', false, 'Purga por retención de consultas y notas de presupuestos de la tienda')
on conflict (tipo) do nothing;

create or replace function private.purgar_consultas_tienda(p_retencion_dias integer default 180)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_corte timestamptz;
  v_borradas integer := 0;
  r record;
begin
  if p_retencion_dias is null or p_retencion_dias < 1 or p_retencion_dias > 3650 then
    raise exception 'RETENCION_INVALIDA' using errcode = '22023';
  end if;

  -- Solo el rol de Sistema (el de Kestra), igual que private.depurar_registro_actividad.
  if not exists (
    select 1 from pg_catalog.pg_roles ro
    where ro.rolname in ('workers_orquestacion', 'kestra_orquestacion')
      and pg_catalog.pg_has_role(session_user, ro.oid, 'member')
  ) then
    raise exception 'Runtime no autorizado para purgar las consultas de la tienda' using errcode = '42501';
  end if;

  v_corte := now() - make_interval(days => p_retencion_dias);

  for r in
    with borradas as (
      delete from dominio.consultas c
       where c.estado <> 'en_curso'
         and c.updated_at < v_corte
      returning c.organizacion_id
    ), notas as (
      update dominio.presupuestos_tienda p
         set nota = null,
             suprimido_en = now()
       where p.nota is not null
         and p.creado_en < v_corte
      returning p.organizacion_id
    )
    select x.organizacion_id,
           sum(x.consultas)::integer as consultas,
           sum(x.notas)::integer as notas
      from (
        select b.organizacion_id, 1 as consultas, 0 as notas from borradas b
        union all
        select n.organizacion_id, 0 as consultas, 1 as notas from notas n
      ) x
     group by x.organizacion_id
  loop
    v_borradas := v_borradas + r.consultas;
    perform private.insertar_actividad(
      r.organizacion_id,
      null,
      'tienda.datos_purgados',
      format('Depuró %s %s y %s %s de la tienda con más de %s días',
             r.consultas,
             case when r.consultas = 1 then 'consulta' else 'consultas' end,
             r.notas,
             case when r.notas = 1 then 'nota de presupuesto' else 'notas de presupuestos' end,
             p_retencion_dias)
    );
  end loop;

  return v_borradas;
end;
$$;

comment on function private.purgar_consultas_tienda(integer) is
  'MSF-944: purga por retención (180 días por defecto) las consultas de la tienda que no están «en_curso»: sus ítems y sus avisos se van en cascada. Vacía la nota de los presupuestos de la tienda que superaron el plazo (el comprobante de venta no se toca). Deja un evento tienda.datos_purgados por organización. Solo el rol de orquestación; idempotente. Devuelve la cantidad de consultas borradas.';

revoke execute on function private.purgar_consultas_tienda(integer) from public, anon, authenticated;

-- ============================================================================
-- 5. Supresión a pedido del titular
-- ============================================================================
insert into public.tipos_evento_actividad (tipo, sensible, descripcion)
values ('tienda.titular_suprimido', false, 'Supresión a pedido del titular de los datos personales de consultas y presupuestos de la tienda')
on conflict (tipo) do nothing;

create or replace function private.suprimir_titular_tienda(p_organizacion uuid, p_contacto text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_contacto text := lower(btrim(coalesce(p_contacto, '')));
  v_clientes uuid[] := '{}'::uuid[];
  v_consultas uuid[] := '{}'::uuid[];
  v_presupuestos integer := 0;
  v_total integer := 0;
begin
  if p_organizacion is null then
    raise exception 'Falta la organización' using errcode = '22023';
  end if;
  if v_contacto = '' then
    raise exception 'Falta el contacto del titular' using errcode = '22023';
  end if;

  -- Procedimiento del equipo técnico: no es una RPC de la API (private no está expuesto).
  if not exists (
    select 1 from pg_catalog.pg_roles ro
    where ro.rolname in ('service_role', 'workers_orquestacion', 'kestra_orquestacion')
      and pg_catalog.pg_has_role(session_user, ro.oid, 'member')
  ) then
    raise exception 'Runtime no autorizado para suprimir datos de titulares' using errcode = '42501';
  end if;

  -- El titular puede tener cuenta web: de ahí salen su cliente, sus consultas y sus presupuestos.
  select coalesce(array_agg(distinct cc.cliente_id), '{}'::uuid[])
    into v_clientes
    from public.cuentas_cliente cc
    join auth.users au on au.id = cc.auth_user_id
   where cc.organizacion_id = p_organizacion
     and lower(btrim(coalesce(au.email, ''))) = v_contacto;

  select coalesce(array_agg(c.id), '{}'::uuid[])
    into v_consultas
    from dominio.consultas c
   where c.organizacion_id = p_organizacion
     and c.suprimido_en is null
     and (
       lower(btrim(c.contacto)) = v_contacto
       or (c.cliente_id is not null and c.cliente_id = any(v_clientes))
     );

  update dominio.consultas c
     set nombre = 'Anonimizado',
         contacto = 'Anonimizado',
         mensaje = case when c.origen = 'whatsapp' and c.mensaje is null then null
                        else 'Mensaje eliminado por supresión' end,
         nota_interna = null,
         suprimido_en = now()
   where c.id = any(v_consultas);

  get diagnostics v_total = row_count;

  -- Los ítems son la copia de lo que pidió la persona: se van con la supresión.
  delete from dominio.consulta_items i
   where i.consulta_id = any(v_consultas);

  -- La cola de avisos: los que todavía no se enviaron se borran; los ya enviados pierden los datos.
  delete from public.avisos_pendientes a
   where a.consulta_id = any(v_consultas)
     and a.estado in ('pendiente', 'fallido');

  update public.avisos_pendientes a
     set datos = a.datos - 'Nombre' - 'Contacto' - 'Mensaje' - 'Pedido' - 'Cliente'
   where a.consulta_id = any(v_consultas);

  -- La nota del presupuesto es dato personal del cliente; el comprobante fiscal no se toca.
  update dominio.presupuestos_tienda p
     set nota = null,
         suprimido_en = now()
   where p.organizacion_id = p_organizacion
     and p.nota is not null
     and p.suprimido_en is null
     and p.cliente_id = any(v_clientes);

  get diagnostics v_presupuestos = row_count;

  -- La actividad lleva cantidades, nunca datos del titular.
  perform private.insertar_actividad(
    p_organizacion,
    null,
    'tienda.titular_suprimido',
    format('Suprimió los datos personales de %s consulta(s) y %s presupuesto(s) de la tienda a pedido del titular',
           v_total, v_presupuestos)
  );

  return v_total;
end;
$$;

comment on function private.suprimir_titular_tienda(uuid, text) is
  'MSF-944: suprime a pedido del titular los datos personales de una organización (consultas, ítems, notas de presupuestos de la tienda y copias de avisos): anonimiza las consultas, borra sus ítems, vacía las notas y deja un evento tienda.titular_suprimido con las cantidades. El comprobante de venta no se toca. Solo el rol técnico; devuelve la cantidad de consultas suprimidas.';

revoke execute on function private.suprimir_titular_tienda(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- 6. Grants
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function private.purgar_consultas_tienda(integer) to kestra_orquestacion;
    grant execute on function private.suprimir_titular_tienda(uuid, text) to kestra_orquestacion;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'workers_orquestacion') then
    grant usage on schema private to workers_orquestacion;
    grant execute on function private.purgar_consultas_tienda(integer) to workers_orquestacion;
    grant execute on function private.suprimir_titular_tienda(uuid, text) to workers_orquestacion;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    grant execute on function private.suprimir_titular_tienda(uuid, text) to service_role;
  end if;
end;
$$;
