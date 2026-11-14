-- F-REP-08 (MSF-265, spec 20261114-100000-analitica-avanzada-y-resumen-por-correo, RF-REP-08-1…RF-REP-08-9):
-- resumen semanal por correo para los administradores de cada organización. Lunes 08:00 (America/Argentina/
-- Buenos_Aires) con ventas de la semana, margen, stock en alerta y faltantes pendientes; las secciones cuya fuente no
-- existe se omiten; cada organización puede pausarlo.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   public.resumen_semanal_config  public (NUEVA)  una fila por organización: ¿el resumen está activo? Es
--                                                  configuración de plataforma por organización (como
--                                                  `organizaciones_features`), no una entidad del negocio → `public`.
--   public.resumen_semanal_envios  public (NUEVA)  registro de cada resumen (una fila por organización y semana):
--                                                  estado, intentos, error útil. Es el outbox de un aviso de
--                                                  plataforma (como `avisos_pendientes`), no del negocio → `public`.
--   public.tipos_aviso             public (existente, solo una FILA nueva: `resumen_semanal`).
--   public.preferencias_aviso      public (existente, solo se lee): la baja personal.
--   dominio.faltantes_venta, public.stock_estados, analitica.ventas_periodo_canal,
--   analitica.rentabilidad_ventas_real, analitica.margen_producto_canal: existentes, solo se leen.
--
-- Seguridad:
--   * RLS activada en las dos tablas SIN políticas y sin ningún privilegio para `anon`, `authenticated` ni `public`:
--     las toca únicamente código `security definer` (las RPC de abajo). La app lee y cambia la configuración con
--     `estado_resumen_semanal()` y `configurar_resumen_semanal()`, que exigen ser administrador de la organización.
--   * Las RPC del barrido (`generar`, `cerrar`, `organizaciones_con_…`) son SOLO de service_role (las llama la Edge
--     Function `enviar-resumen-semanal`, que dispara el flow de Kestra `resumen-semanal`). La organización llega por
--     argumento porque quien llama es service_role (no hay sesión). Nada se concede a `anon`.
--   * Todas las funciones son security definer con `search_path = ''` y referencias calificadas.
--   * El contenido son AGREGADOS de la organización (totales, conteos, nombres de producto en alerta); nunca datos de
--     clientes ni de comprobantes individuales.
--
-- Diseño (patrón de `20261212140100_stock_resumen_reposicion_rpc.sql`):
--   * Idempotente por organización y semana: `unique (organizacion_id, semana_desde)`. Reintentar el barrido no crea
--     otro resumen ni reenvía uno `enviado`.
--   * Ventana de generación: el lunes desde las 08:00 (hora de Buenos Aires) hasta el martes inclusive (un día de
--     margen por si Kestra estuvo caído). Fuera de la ventana no nace ningún resumen; sí se reintentan los pendientes.
--   * El resumen cubre la semana que terminó (lunes a domingo anteriores). El contenido se congela al generarlo: un
--     reintento envía lo mismo.
--   * Reserva de 2 minutos del resumen pendiente: dos barridos simultáneos no mandan el mismo correo. Un resumen
--     fallido o con la reserva vencida se reutiliza (suma un intento) hasta el tope.
--   * Garantía de entrega: al menos una vez. Si el correo sale y la base no puede cerrar el resumen, el reintento lo
--     reenvía (se prefiere un duplicado a perder el resumen); queda registrado.
--   * Destinatarios: miembros ACTIVOS con rol `administrador`, con correo y con la preferencia `resumen_semanal`
--     encendida (sin fila = encendida: es la baja personal de /cuenta/avisos).
--   * Pausa por organización: sin fila = activo. Pausar cancela los resúmenes pendientes (`pausado`).
--
-- Migración aditiva e idempotente. Reversión (migración posterior; antes desactivar el flow `resumen-semanal`):
--   drop function if exists public.estado_resumen_semanal();
--   drop function if exists public.configurar_resumen_semanal(boolean);
--   drop function if exists public.cerrar_resumen_semanal(uuid, boolean, text);
--   drop function if exists public.generar_resumen_semanal(uuid, integer);
--   drop function if exists public.organizaciones_con_resumen_semanal_pendiente();
--   drop function if exists private.organizaciones_con_resumen_semanal_pendiente_en(timestamptz, integer);
--   drop function if exists private.generar_resumen_semanal_en(uuid, integer, timestamptz);
--   drop function if exists private.armar_resumen_semanal(uuid, date, date);
--   drop function if exists private.destinatarios_resumen_semanal(uuid);
--   drop table if exists public.resumen_semanal_envios;
--   drop table if exists public.resumen_semanal_config;
--   delete from public.preferencias_aviso where tipo_aviso = 'resumen_semanal';
--   delete from public.tipos_aviso where clave = 'resumen_semanal';
--   y redefinir `private.exclusiones_exportacion_total()` sin las dos filas nuevas.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.resumen_semanal_config (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  activo boolean not null default true,
  actualizado_por uuid references auth.users (id) on delete set null,
  actualizado_en timestamptz not null default now()
);

comment on table public.resumen_semanal_config is
  'F-REP-08: configuración por organización del resumen semanal por correo. Sin fila = activo. Solo la escribe configurar_resumen_semanal() (administradores).';

create table if not exists public.resumen_semanal_envios (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  semana_desde date not null,
  semana_hasta date not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido', 'sin_destinatario', 'pausado')),
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  -- Foto del resumen (agregados de la organización) tal como se envió.
  contenido jsonb not null default '{}'::jsonb check (jsonb_typeof(contenido) = 'object'),
  destinatarios_cantidad integer not null default 0 check (destinatarios_cantidad >= 0),
  generado_en timestamptz not null default now(),
  enviado_en timestamptz,
  updated_at timestamptz not null default now(),
  check (semana_hasta = semana_desde + 6),
  unique (organizacion_id, semana_desde)
);

comment on table public.resumen_semanal_envios is
  'F-REP-08: registro de cada resumen semanal (una fila por organización y semana: estado, intentos, error útil). Solo lo escriben las RPC de service_role de la función enviar-resumen-semanal.';
comment on column public.resumen_semanal_envios.updated_at is
  'Reserva del resumen: un resumen pendiente tomado hace menos de 2 minutos está en proceso.';

alter table public.resumen_semanal_config enable row level security;
alter table public.resumen_semanal_envios enable row level security;

-- Sin políticas: ni siquiera el administrador lee las tablas directo; pasa por las RPC de abajo.
revoke all on public.resumen_semanal_config from public, anon, authenticated;
revoke all on public.resumen_semanal_envios from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tipo de aviso: la baja personal desde /cuenta/avisos. Lo ve quien tiene `usuarios_permisos` (el administrador).
-- ---------------------------------------------------------------------------

insert into public.tipos_aviso (clave, nombre, seccion) values
  ('resumen_semanal', 'Resumen semanal de la organización', 'usuarios_permisos')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Destinatarios
-- ---------------------------------------------------------------------------

create or replace function private.destinatarios_resumen_semanal(p_organizacion uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(btrim(u.email)) order by lower(btrim(u.email))), '{}'::text[])
  from public.usuarios_organizacion uo
  join auth.users u on u.id = uo.user_id
  where uo.organizacion_id = p_organizacion
    and uo.estado = 'activo'
    and uo.rol_id = 'administrador'
    and u.email is not null
    and btrim(u.email) <> ''
    and coalesce(
      (select p.activo from public.preferencias_aviso p
        where p.user_id = uo.user_id and p.tipo_aviso = 'resumen_semanal'),
      true
    );
$$;

comment on function private.destinatarios_resumen_semanal(uuid) is
  'F-REP-08: correos de los administradores activos de la organización con la preferencia resumen_semanal encendida (sin fila = encendida).';

-- ---------------------------------------------------------------------------
-- Contenido del resumen (agregados). Las secciones cuya fuente no existe se omiten (`fuentes` lista las que sí).
-- ---------------------------------------------------------------------------

create or replace function private.armar_resumen_semanal(p_organizacion uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_resumen jsonb := jsonb_build_object('desde', p_desde, 'hasta', p_hasta);
  v_fuentes text[] := '{}';
  v_parte jsonb;
  v_sin integer;
  v_bajo integer;
begin
  -- Ventas de la semana (MSF-192): facturado neto con IVA, comprobantes y unidades, contra la semana anterior y por tienda.
  if to_regclass('analitica.ventas_periodo_canal') is not null then
    v_fuentes := array_append(v_fuentes, 'ventas');
    select jsonb_build_object(
      'facturado', coalesce(sum(v.facturado) filter (where v.fecha between p_desde and p_hasta), 0),
      'facturado_anterior', coalesce(sum(v.facturado) filter (where v.fecha between p_desde - 7 and p_hasta - 7), 0),
      'comprobantes', coalesce(sum(v.comprobantes) filter (where v.fecha between p_desde and p_hasta), 0),
      'unidades', coalesce(sum(v.unidades) filter (where v.fecha between p_desde and p_hasta), 0)
    )
    into v_parte
    from analitica.ventas_periodo_canal v
    where v.organizacion_id = p_organizacion and v.fecha between p_desde - 7 and p_hasta;

    v_parte := v_parte || jsonb_build_object('tiendas', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', t.nombre, 'facturado', t.facturado) order by t.facturado desc, t.nombre)
      from (
        select v.empresa_nombre as nombre, sum(v.facturado) as facturado
        from analitica.ventas_periodo_canal v
        where v.organizacion_id = p_organizacion and v.fecha between p_desde and p_hasta
        group by v.empresa_nombre
        order by sum(v.facturado) desc, v.empresa_nombre
        limit 5
      ) t
    ), '[]'::jsonb));
    v_resumen := v_resumen || jsonb_build_object('ventas', v_parte);
  end if;

  -- Margen real de lo vendido en la semana (MSF-120) y productos con margen bajo o negativo hoy.
  if to_regclass('analitica.rentabilidad_ventas_real') is not null then
    v_fuentes := array_append(v_fuentes, 'rentabilidad');
    select jsonb_build_object(
      'vendido', coalesce(sum(r.vendido), 0),
      'margen', coalesce(sum(r.margen), 0),
      'margen_pct', case when coalesce(sum(r.vendido), 0) > 0 then round(sum(r.margen) / sum(r.vendido) * 100, 1) end
    )
    into v_parte
    from analitica.rentabilidad_ventas_real r
    where r.organizacion_id = p_organizacion and r.fecha between p_desde and p_hasta;

    if to_regclass('analitica.margen_producto_canal') is not null then
      v_parte := v_parte || jsonb_build_object('productos_en_riesgo', (
        select count(distinct m.producto_id)
        from analitica.margen_producto_canal m
        where m.organizacion_id = p_organizacion and m.estado in ('bajo', 'negativo')
      ));
    end if;
    v_resumen := v_resumen || jsonb_build_object('rentabilidad', v_parte);
  end if;

  -- Stock en alerta (MSF-231 / MSF-140): solo productos activos; se omite si no hay ninguno.
  if to_regclass('public.stock_estados') is not null then
    v_fuentes := array_append(v_fuentes, 'stock');
    select (count(*) filter (where e.estado = 'sin_stock'))::integer,
           (count(*) filter (where e.estado = 'stock_bajo'))::integer
      into v_sin, v_bajo
      from public.stock_estados e
     where e.organizacion_id = p_organizacion and e.activo and e.estado in ('sin_stock', 'stock_bajo');
    if v_sin + v_bajo > 0 then
      v_resumen := v_resumen || jsonb_build_object('stock', jsonb_build_object(
        'sin_stock', v_sin,
        'stock_bajo', v_bajo,
        'productos', (
          select coalesce(jsonb_agg(jsonb_build_object('nombre', t.nombre, 'sku', t.sku, 'estado', t.estado)
                                    order by (t.estado = 'sin_stock') desc, t.nombre, t.sku), '[]'::jsonb)
          from (
            select e.nombre, e.sku, e.estado
            from public.stock_estados e
            where e.organizacion_id = p_organizacion and e.activo and e.estado in ('sin_stock', 'stock_bajo')
            order by (e.estado = 'sin_stock') desc, e.nombre, e.sku
            limit 5
          ) t
        )
      ));
    end if;
  end if;

  -- Faltantes de venta pendientes (MSF-161): se omite si no hay ninguno abierto.
  if to_regclass('dominio.faltantes_venta') is not null then
    v_fuentes := array_append(v_fuentes, 'faltantes');
    select jsonb_build_object(
             'pendientes', count(*),
             'unidades', coalesce(sum(f.cantidad_faltante), 0),
             'dias_mas_antiguo', (current_date - min(f.creado_en)::date)
           )
      into v_parte
      from dominio.faltantes_venta f
     where f.organizacion_id = p_organizacion and f.estado = 'abierto';
    if (v_parte ->> 'pendientes')::integer > 0 then
      v_resumen := v_resumen || jsonb_build_object('faltantes', v_parte);
    end if;
  end if;

  return v_resumen || jsonb_build_object('fuentes', to_jsonb(v_fuentes));
end;
$$;

comment on function private.armar_resumen_semanal(uuid, date, date) is
  'F-REP-08: arma el resumen (solo agregados de la organización) de la semana p_desde..p_hasta. Omite las secciones cuya fuente no existe; stock y faltantes solo si hay algo.';

-- ---------------------------------------------------------------------------
-- Generación y reserva
-- ---------------------------------------------------------------------------

create or replace function private.generar_resumen_semanal_en(p_organizacion uuid, p_tope integer, p_ahora timestamptz)
returns table (
  resumen_id uuid,
  organizacion_nombre text,
  semana_desde date,
  semana_hasta date,
  contenido jsonb,
  destinatarios text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_local timestamp := p_ahora at time zone 'America/Argentina/Buenos_Aires';
  v_lunes date := date_trunc('week', v_local)::date;
  v_desde date := date_trunc('week', v_local)::date - 7;
  v_hasta date := date_trunc('week', v_local)::date - 1;
  v_en_ventana boolean := (extract(isodow from v_local) = 1 and v_local::time >= time '08:00')
                          or extract(isodow from v_local) = 2;
  v_activo boolean;
  v_nombre text;
  v_envio public.resumen_semanal_envios%rowtype;
  v_contenido jsonb;
  v_destinos text[];
begin
  select o.nombre into v_nombre from public.organizaciones o where o.id = p_organizacion;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('resumen_semanal:' || p_organizacion::text, 0));

  v_activo := coalesce((select c.activo from public.resumen_semanal_config c where c.organizacion_id = p_organizacion), true);

  -- Un pendiente con la reserva vencida que ya agotó los intentos no se retoma: se cierra como fallido.
  update public.resumen_semanal_envios e
     set estado = 'fallido',
         ultimo_error = coalesce(e.ultimo_error, 'Se agotaron los intentos del resumen'),
         updated_at = now()
   where e.organizacion_id = p_organizacion and e.estado = 'pendiente'
     and e.intentos >= v_tope and e.updated_at <= now() - interval '2 minutes';

  -- Pausado: lo que estaba por salir no sale (los enviados no se tocan).
  if not v_activo then
    update public.resumen_semanal_envios e
       set estado = 'pausado', updated_at = now()
     where e.organizacion_id = p_organizacion
       and (e.estado in ('pendiente', 'sin_destinatario') or (e.estado = 'fallido' and e.intentos < v_tope));
    return;
  end if;

  select * into v_envio
    from public.resumen_semanal_envios e
   where e.organizacion_id = p_organizacion and e.semana_desde = v_desde
   for update;

  if found then
    if v_envio.estado in ('enviado', 'pausado') then
      return;
    end if;
    if v_envio.estado = 'fallido' and v_envio.intentos >= v_tope then
      return;
    end if;
    -- Reservado por otra invocación que todavía puede estar enviando.
    if v_envio.estado = 'pendiente' and v_envio.intentos > 0 and v_envio.updated_at > now() - interval '2 minutes' then
      return;
    end if;
    -- Sin destinatarios en su momento: solo se reevalúa dentro de la ventana.
    if v_envio.estado = 'sin_destinatario' and not v_en_ventana then
      return;
    end if;
  else
    if not v_en_ventana then
      return;
    end if;
    v_contenido := private.armar_resumen_semanal(p_organizacion, v_desde, v_hasta);
    insert into public.resumen_semanal_envios (organizacion_id, semana_desde, semana_hasta, contenido)
    values (p_organizacion, v_desde, v_hasta, v_contenido)
    returning * into v_envio;
  end if;

  v_destinos := private.destinatarios_resumen_semanal(p_organizacion);

  -- Sin destinatarios queda registrado y se reevalúa en el próximo barrido de la ventana.
  if coalesce(array_length(v_destinos, 1), 0) = 0 then
    update public.resumen_semanal_envios e
       set estado = 'sin_destinatario', destinatarios_cantidad = 0, ultimo_error = null, updated_at = now()
     where e.id = v_envio.id;
    return query select v_envio.id, v_nombre, v_envio.semana_desde, v_envio.semana_hasta, v_envio.contenido, '{}'::text[];
    return;
  end if;

  update public.resumen_semanal_envios e
     set estado = 'pendiente', intentos = e.intentos + 1,
         destinatarios_cantidad = array_length(v_destinos, 1), updated_at = now()
   where e.id = v_envio.id;

  return query select v_envio.id, v_nombre, v_envio.semana_desde, v_envio.semana_hasta, v_envio.contenido, v_destinos;
end;
$$;

comment on function private.generar_resumen_semanal_en(uuid, integer, timestamptz) is
  'F-REP-08: genera o reintenta el resumen de la semana que terminó para una organización y lo reserva 2 minutos. p_ahora permite probar la ventana (lunes 08:00 a martes, hora de Buenos Aires).';

create or replace function private.organizaciones_con_resumen_semanal_pendiente_en(p_ahora timestamptz, p_tope integer)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_ahora at time zone 'America/Argentina/Buenos_Aires';
  v_desde date := date_trunc('week', v_local)::date - 7;
  v_en_ventana boolean := (extract(isodow from v_local) = 1 and v_local::time >= time '08:00')
                          or extract(isodow from v_local) = 2;
  v_ids uuid[];
begin
  select coalesce(array_agg(o.id order by o.id), '{}'::uuid[])
    into v_ids
    from public.organizaciones o
   where
     -- Hay que generar el resumen de la semana: dentro de la ventana, activo y todavía sin registro.
     (
       v_en_ventana
       and coalesce((select c.activo from public.resumen_semanal_config c where c.organizacion_id = o.id), true)
       and not exists (
         select 1 from public.resumen_semanal_envios e
          where e.organizacion_id = o.id and e.semana_desde = v_desde
       )
     )
     -- Hay un resumen para reintentar (pendiente con la reserva vencida, fallido bajo el tope) o para reevaluar.
     or exists (
       select 1 from public.resumen_semanal_envios e
        where e.organizacion_id = o.id and e.semana_desde = v_desde
          and (
            (e.estado = 'pendiente' and e.updated_at <= now() - interval '2 minutes')
            or (e.estado = 'fallido' and e.intentos < greatest(coalesce(p_tope, 5), 1))
            or (e.estado = 'sin_destinatario' and v_en_ventana)
          )
     );
  return v_ids;
end;
$$;

comment on function private.organizaciones_con_resumen_semanal_pendiente_en(timestamptz, integer) is
  'F-REP-08: organizaciones que el barrido semanal debe procesar (resumen por generar o por reintentar).';

-- Envolturas públicas (service_role): sin parámetro de fecha, siempre «ahora».
create or replace function public.organizaciones_con_resumen_semanal_pendiente()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.organizaciones_con_resumen_semanal_pendiente_en(now(), 5);
$$;

create or replace function public.generar_resumen_semanal(p_organizacion uuid, p_tope integer default 5)
returns table (
  resumen_id uuid,
  organizacion_nombre text,
  semana_desde date,
  semana_hasta date,
  contenido jsonb,
  destinatarios text[]
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.generar_resumen_semanal_en(p_organizacion, p_tope, now());
$$;

-- Cierra un resumen tomado. Solo actúa sobre uno `pendiente`: un cierre repetido no pisa un `enviado`.
create or replace function public.cerrar_resumen_semanal(p_resumen uuid, p_enviado boolean, p_error text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_enviado then
    update public.resumen_semanal_envios e
       set estado = 'enviado', enviado_en = now(), ultimo_error = null, updated_at = now()
     where e.id = p_resumen and e.estado = 'pendiente';
    if found then
      return 'enviado';
    end if;
    return null;
  end if;

  update public.resumen_semanal_envios e
     set estado = 'fallido',
         ultimo_error = left(nullif(btrim(regexp_replace(coalesce(p_error, ''), '\s+', ' ', 'g')), ''), 500),
         updated_at = now()
   where e.id = p_resumen and e.estado = 'pendiente';
  if found then
    return 'fallido';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Configuración por organización (la app): solo administradores, con evento en Actividad.
-- ---------------------------------------------------------------------------

create or replace function public.configurar_resumen_semanal(p_activo boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_antes boolean;
begin
  if p_activo is null then
    raise exception 'Indicá si el resumen semanal queda activo o pausado' using errcode = '22023';
  end if;
  if v_organizacion is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede cambiar el resumen semanal' using errcode = '42501';
  end if;

  v_antes := coalesce((select c.activo from public.resumen_semanal_config c where c.organizacion_id = v_organizacion), true);

  insert into public.resumen_semanal_config (organizacion_id, activo, actualizado_por, actualizado_en)
  values (v_organizacion, p_activo, (select auth.uid()), now())
  on conflict (organizacion_id) do update
    set activo = excluded.activo, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;

  -- Solo un cambio real deja evento (repetir el mismo valor no ensucia el historial).
  if v_antes is distinct from p_activo then
    perform private.registrar_actividad(
      case when p_activo then 'resumen_semanal.reanudado' else 'resumen_semanal.pausado' end,
      case when p_activo then 'Reanudó el resumen semanal por correo' else 'Pausó el resumen semanal por correo' end
    );
  end if;

  return p_activo;
end;
$$;

create or replace function public.estado_resumen_semanal()
returns table (
  activo boolean,
  proximo_envio timestamptz,
  ultima_semana_desde date,
  ultimo_estado text,
  destinatarios integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_local timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_lunes date := date_trunc('week', v_local)::date;
  v_proximo date;
begin
  if v_organizacion is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador ve el estado del resumen semanal' using errcode = '42501';
  end if;

  -- Próximo lunes 08:00: el de esta semana si todavía no pasó, si no el siguiente.
  v_proximo := case when v_local < (v_lunes + time '08:00') then v_lunes else v_lunes + 7 end;

  return query
    select
      coalesce((select c.activo from public.resumen_semanal_config c where c.organizacion_id = v_organizacion), true),
      ((v_proximo + time '08:00') at time zone 'America/Argentina/Buenos_Aires'),
      u.semana_desde,
      u.estado,
      coalesce(array_length(private.destinatarios_resumen_semanal(v_organizacion), 1), 0)
    from (select 1) base
    left join lateral (
      select e.semana_desde, e.estado
      from public.resumen_semanal_envios e
      where e.organizacion_id = v_organizacion
      order by e.semana_desde desc
      limit 1
    ) u on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios EXACTOS
-- ---------------------------------------------------------------------------

revoke execute on function private.destinatarios_resumen_semanal(uuid) from public, anon, authenticated;
revoke execute on function private.armar_resumen_semanal(uuid, date, date) from public, anon, authenticated;
revoke execute on function private.generar_resumen_semanal_en(uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function private.organizaciones_con_resumen_semanal_pendiente_en(timestamptz, integer) from public, anon, authenticated;

-- Barrido: solo service_role.
revoke execute on function public.organizaciones_con_resumen_semanal_pendiente() from public, anon, authenticated;
revoke execute on function public.generar_resumen_semanal(uuid, integer) from public, anon, authenticated;
revoke execute on function public.cerrar_resumen_semanal(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.organizaciones_con_resumen_semanal_pendiente() to service_role;
grant execute on function public.generar_resumen_semanal(uuid, integer) to service_role;
grant execute on function public.cerrar_resumen_semanal(uuid, boolean, text) to service_role;

-- App: solo `authenticated` (la función revalida que sea administrador de la organización).
revoke execute on function public.configurar_resumen_semanal(boolean) from public, anon;
revoke execute on function public.estado_resumen_semanal() from public, anon;
grant execute on function public.configurar_resumen_semanal(boolean) to authenticated;
grant execute on function public.estado_resumen_semanal() to authenticated;

comment on function public.organizaciones_con_resumen_semanal_pendiente() is
  'F-REP-08: organizaciones con un resumen semanal por generar o reintentar. Solo service_role.';
comment on function public.generar_resumen_semanal(uuid, integer) is
  'F-REP-08: genera o reintenta el resumen semanal de una organización y lo reserva 2 minutos. Solo service_role (Edge Function enviar-resumen-semanal).';
comment on function public.cerrar_resumen_semanal(uuid, boolean, text) is
  'F-REP-08: cierra el resumen tomado (enviado o fallido con error sanitizado). Solo service_role.';
comment on function public.configurar_resumen_semanal(boolean) is
  'F-REP-08: activa o pausa el resumen semanal de la organización de la sesión. Solo administradores; un cambio real queda en Actividad.';
comment on function public.estado_resumen_semanal() is
  'F-REP-08: estado del resumen semanal para la pantalla Mi organización (activo, próximo envío, último resumen y destinatarios). Solo administradores.';
