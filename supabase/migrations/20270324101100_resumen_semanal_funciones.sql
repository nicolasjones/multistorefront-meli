-- MSF-287 · F-REP-08 (épica MSF-265, spec 20261101-100000-analitica-avanzada-y-resumen-por-correo,
-- FR-010…FR-014): funciones del resumen semanal por correo.
--
-- Esquema (Principio VII): sin tablas nuevas; usa `dominio.resumen_semanal_envios` (20270324101000)
-- y el catálogo `public.tipos_aviso`. Las funciones van en `private` (las llama el rol de servicio
-- de Kestra `kestra_orquestacion`, como las de MSF-189).
--
-- Diseño:
--   * `private.resumen_semanal_datos(uuid)`      datos de la ORGANIZACIÓN por sección. Cada sección
--                                                sale de su fuente y SOLO si la fuente existe: si la
--                                                vista de ventas o la de stock en alerta no están, la
--                                                sección se omite sin error (FR-012).
--   * `private.armar_resumen_semanal(uuid, uuid, text)`
--                                                resumen del destinatario: se queda con las
--                                                secciones a las que la persona tiene acceso (el
--                                                correo no muestra más que el panel) y con los datos
--                                                de SU organización (FR-014).
--   * `private.reclamar_resumen_semanal(integer, text)`
--                                                encola a los destinatarios de la semana y
--                                                reclama la cola en tandas de `p_limite`, sin
--                                                doble toma y con idempotencia por destinatario
--                                                y semana (FR-013). El tope es el tamaño de la
--                                                tanda, NO un recorte: el que no entra en la
--                                                tanda queda encolado `pendiente` y sale en la
--                                                tanda siguiente de la misma corrida.
--   * `private.marcar_resumen_semanal_enviado(uuid)` / `private.registrar_fallo_resumen_semanal(uuid, text)`
--                                                cierran el envío: enviado (idempotente) o fallido
--                                                con un motivo útil (FR-013).
--
-- Periodo del resumen: los últimos 7 días (inclusive hoy). La semana (AAAA-Wnn) es solo la clave de
-- idempotencia: el contenido no depende del reloj salvo por ese periodo relativo.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el destinatario llegan por
-- argumento (quien llama es el rol de Kestra, sin sesión). `revoke … from public, anon,
-- authenticated` + grant solo a `kestra_orquestacion`. Las tres funciones que Kestra puede
-- ejecutar pasan por el guardia `private.exigir_llamante_kestra()`: si un revoke/grant futuro
-- dejara entrar a otro rol, la función se niega en vez de devolver los correos del negocio.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.armar_resumen_semanal(uuid, uuid, text);
--   drop function private.resumen_semanal_datos(uuid);
--   drop function private.reclamar_resumen_semanal(integer, text);
--   drop function private.marcar_resumen_semanal_enviado(uuid);
--   drop function private.registrar_fallo_resumen_semanal(uuid, text);

-- ============================================================================
-- Datos de la organización, por sección
-- ============================================================================

create or replace function private.resumen_semanal_datos(p_organizacion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_productos integer;
  v_margen numeric;
  v_bajo integer;
  v_negativo integer;
  v_filas integer;
  v_unidades bigint;
  v_facturado numeric;
  v_top text;
  v_sin_stock integer;
  v_stock_bajo integer;
  v_top_stock text;
  v_secciones jsonb := '[]'::jsonb;
begin
  if p_organizacion_id is null then
    return v_secciones;
  end if;

  -- Rentabilidad (MSF-120): consolidado de la organización.
  if to_regclass('analitica.rentabilidad_consolidado') is not null then
    select r.productos_con_margen, r.margen_promedio_ponderado_pct, r.con_margen_bajo, r.con_margen_negativo
      into v_productos, v_margen, v_bajo, v_negativo
      from analitica.rentabilidad_consolidado r
     where r.organizacion_id = p_organizacion_id;
    if found then
      v_secciones := v_secciones || jsonb_build_object(
        'clave', 'rentabilidad',
        'titulo', 'Rentabilidad',
        'datos', jsonb_build_array(
          jsonb_build_object('clave', 'productos_con_margen', 'valor', v_productos::text),
          jsonb_build_object('clave', 'margen_promedio', 'valor', case when v_margen is null then 'sin datos' else round(v_margen * 100, 1)::text || ' %' end),
          jsonb_build_object('clave', 'productos_con_margen_bajo', 'valor', v_bajo::text),
          jsonb_build_object('clave', 'productos_con_margen_negativo', 'valor', v_negativo::text)
        )
      );
    end if;
  end if;

  -- Ventas de los últimos 7 días (MSF-347 / F-VTA-22). Sin la vista no hay sección, sin error.
  if to_regclass('analitica.ventas_producto_mas_vendido') is not null then
    select count(*)::int, coalesce(sum(v.unidades), 0)::bigint, coalesce(sum(v.facturado), 0)::numeric
      into v_filas, v_unidades, v_facturado
      from analitica.ventas_producto_mas_vendido v
     where v.organizacion_id = p_organizacion_id
       and v.fecha >= current_date - 6
       and v.fecha <= current_date;

    if v_filas > 0 then
      select string_agg(t.producto_nombre || ' (' || t.unidades || ' u.)', ', ')
        into v_top
        from (
          select v.producto_nombre, sum(v.unidades)::bigint as unidades
            from analitica.ventas_producto_mas_vendido v
           where v.organizacion_id = p_organizacion_id
             and v.fecha >= current_date - 6
             and v.fecha <= current_date
           group by v.producto_nombre
           order by 2 desc, 1
           limit 3
        ) t;

      v_secciones := v_secciones || jsonb_build_object(
        'clave', 'ventas',
        'titulo', 'Ventas de la semana',
        'datos', jsonb_build_array(
          jsonb_build_object('clave', 'unidades', 'valor', v_unidades::text),
          -- El facturado va con su moneda (los comprobantes se guardan en pesos): sin la
          -- unidad, el número al lado del margen con '%' se lee como un importe sin unidad.
          jsonb_build_object('clave', 'facturado', 'valor', coalesce(round(v_facturado, 2)::text, '0') || ' ARS'),
          jsonb_build_object('clave', 'productos', 'valor', coalesce(v_top, ''))
        )
      );
    end if;
  end if;

  -- Stock en alerta (MSF-140): `public.stock_estados` es la única fuente del estado de stock.
  if to_regclass('public.stock_estados') is not null then
    select count(*) filter (where s.estado = 'sin_stock')::int,
           count(*) filter (where s.estado = 'stock_bajo')::int
      into v_sin_stock, v_stock_bajo
      from public.stock_estados s
     where s.organizacion_id = p_organizacion_id and s.activo;

    if v_sin_stock + v_stock_bajo > 0 then
      select string_agg(t.nombre || ' (' || t.estado || ')', ', ')
        into v_top_stock
        from (
          select s.nombre, s.estado
            from public.stock_estados s
           where s.organizacion_id = p_organizacion_id and s.activo
             and s.estado in ('sin_stock', 'stock_bajo')
           order by case s.estado when 'sin_stock' then 0 else 1 end, s.nombre
           limit 5
        ) t;

      v_secciones := v_secciones || jsonb_build_object(
        'clave', 'stock',
        'titulo', 'Stock en alerta',
        'datos', jsonb_build_array(
          jsonb_build_object('clave', 'sin_stock', 'valor', v_sin_stock::text),
          jsonb_build_object('clave', 'stock_bajo', 'valor', v_stock_bajo::text),
          jsonb_build_object('clave', 'productos', 'valor', coalesce(v_top_stock, ''))
        )
      );
    end if;
  end if;

  return v_secciones;
end;
$$;

comment on function private.resumen_semanal_datos(uuid) is
  'F-REP-08: datos del resumen semanal de una organización, por sección. Cada sección sale de su fuente y solo si la fuente existe y tiene datos de esa organización.';

-- ============================================================================
-- Resumen del destinatario
-- ============================================================================

create or replace function private.armar_resumen_semanal(
  p_organizacion_id uuid,
  p_destinatario_id uuid,
  p_semana text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion text;
  v_seccion jsonb;
  v_secciones jsonb := '[]'::jsonb;
begin
  select o.nombre into v_organizacion
    from public.organizaciones o
   where o.id = p_organizacion_id;
  if v_organizacion is null then
    return null;
  end if;

  for v_seccion in
    select jsonb_array_elements(private.resumen_semanal_datos(p_organizacion_id))
  loop
    -- Cada sección sale solo si el destinatario tiene acceso a ella: el correo no muestra más de
    -- lo que la persona puede ver en el panel (FR-014).
    if private.nivel_seccion_de_usuario(p_destinatario_id, v_seccion->>'clave') <> 'ninguno' then
      v_secciones := v_secciones || jsonb_build_array(v_seccion);
    end if;
  end loop;

  return jsonb_build_object(
    'semana', p_semana,
    'organizacion', v_organizacion,
    'secciones', v_secciones
  );
end;
$$;

comment on function private.armar_resumen_semanal(uuid, uuid, text) is
  'F-REP-08: resumen semanal de una organización para un destinatario: solo las secciones a las que la persona tiene acceso, con los datos de su organización.';

-- ============================================================================
-- Claims y cierre del envío
-- ============================================================================

create or replace function private.reclamar_resumen_semanal(
  p_limite integer default 50,
  p_semana text default null
)
returns table (envio_id uuid, organizacion_id uuid, destinatario text, semana text, resumen jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_semana text := coalesce(nullif(btrim(p_semana), ''), to_char(now(), 'IYYY-"W"IW'));
  v_limite integer := greatest(coalesce(p_limite, 50), 1);
  v_envio dominio.resumen_semanal_envios%rowtype;
  v_organizacion uuid;
  v_destinatario uuid;
  v_correo text;
  v_resumen jsonb;
  v_tomados integer := 0;
begin
  perform private.exigir_llamante_kestra();

  if v_semana !~ '^\d{4}-W\d{2}$' then
    raise exception 'Semana inválida: %', v_semana using errcode = '22023';
  end if;

  -- Un reclamo vencido NO se reenvía: la fila queda `fallido` con un motivo útil. Así el envío es
  -- idempotente por destinatario y semana: a lo sumo un correo por semana (FR-013, SC-002).
  update dominio.resumen_semanal_envios e
     set estado = 'fallido',
         ultimo_error = 'La corrida se interrumpió antes de confirmar el envío',
         reclamado_hasta = null,
         actualizado_en = now()
   where e.estado = 'enviando' and e.reclamado_hasta < now();

  -- Una fila `pendiente` de una semana anterior tampoco se reenvía: la semana nueva trae un
  -- resumen nuevo. Queda `fallido` con el motivo (no desaparece en silencio).
  update dominio.resumen_semanal_envios e
     set estado = 'fallido',
         ultimo_error = 'La corrida anterior no alcanzó a enviar este resumen',
         actualizado_en = now()
   where e.estado = 'pendiente' and e.semana < v_semana;

  -- 1) Encolar a los destinatarios de la semana. TODOS los que tienen datos quedan en la cola,
  --    no solo los que entran en la tanda: el tope es el tamaño de la tanda, no un recorte (si
  --    fuera un recorte, con más destinatarios que el tope los últimos no recibirían nunca el
  --    correo, porque el orden de la cola es el mismo cada semana).
  for v_organizacion, v_destinatario, v_correo in
    select uo.organizacion_id, uo.user_id, lower(btrim(au.email))
      from public.usuarios_organizacion uo
      join auth.users au on au.id = uo.user_id
     where uo.estado = 'activo'
       and btrim(coalesce(au.email, '')) <> ''
       -- Destinatarios: quien tiene acceso a `rentabilidad` (los administradores) y mantiene
       -- encendida la preferencia del tipo (la persona lo apaga en «Avisos por correo»).
       and private.nivel_seccion_de_usuario(uo.user_id, 'rentabilidad') <> 'ninguno'
       and coalesce(
             (select p.activo from public.preferencias_aviso p
               where p.user_id = uo.user_id and p.tipo_aviso = 'resumen_semanal'),
             true
           )
       -- Los que ya tienen fila para esta semana no se vuelven a encolar (idempotencia).
       and not exists (
         select 1
           from dominio.resumen_semanal_envios e
          where e.organizacion_id = uo.organizacion_id
            and e.destinatario_id = uo.user_id
            and e.semana = v_semana
       )
     order by uo.organizacion_id, uo.user_id
  loop
    v_resumen := private.armar_resumen_semanal(v_organizacion, v_destinatario, v_semana);
    -- Sin datos no hay correo que enviar: no se encola a nadie.
    if v_resumen is null or coalesce(jsonb_array_length(v_resumen->'secciones'), 0) = 0 then
      continue;
    end if;

    -- Idempotencia: una fila por destinatario y semana (FR-013). El resumen queda guardado tal
    -- como se armó: el correo es el mismo que se encoló.
    insert into dominio.resumen_semanal_envios
      (organizacion_id, destinatario_id, semana, destinatario_correo, resumen)
    values (v_organizacion, v_destinatario, v_semana, v_correo, v_resumen)
    on conflict (organizacion_id, destinatario_id, semana) do nothing;
  end loop;

  -- 2) Reclamar la cola en tandas de `v_limite` hasta que no quede nada pendiente. Sin doble
  --    toma: si otra sesión ya tiene la fila, se saltea.
  loop
    v_tomados := 0;

    for v_envio in
      select e.*
        from dominio.resumen_semanal_envios e
       where e.semana = v_semana
         and e.estado = 'pendiente'
       order by e.creado_en, e.id
       for update skip locked
       limit v_limite
    loop
      v_tomados := v_tomados + 1;

      update dominio.resumen_semanal_envios e
         set estado = 'enviando',
             intentos = e.intentos + 1,
             reclamado_hasta = now() + interval '30 minutes',
             actualizado_en = now()
       where e.id = v_envio.id;

      envio_id := v_envio.id;
      organizacion_id := v_envio.organizacion_id;
      destinatario := v_envio.destinatario_correo;
      semana := v_envio.semana;
      resumen := v_envio.resumen;
      return next;
    end loop;

    -- La tanda trajo menos que el tope: no queda nada pendiente que reclamar (la cola quedó
    -- vacía o las filas que faltan las tiene tomadas otra sesión).
    exit when v_tomados < v_limite;
  end loop;
end;
$$;

comment on function private.reclamar_resumen_semanal(integer, text) is
  'F-REP-08: encola a los destinatarios del resumen semanal de la semana (AAAA-Wnn; por defecto, la actual) y reclama la cola en tandas de p_limite hasta vaciarla, sin doble toma y con idempotencia por destinatario y semana. Solo el rol de Kestra.';

create or replace function private.marcar_resumen_semanal_enviado(p_envio uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  perform private.exigir_llamante_kestra();

  -- Idempotente: repetir la marca no cambia el momento del envío.
  update dominio.resumen_semanal_envios e
     set estado = 'enviado',
         enviado_en = coalesce(e.enviado_en, now()),
         ultimo_error = null,
         reclamado_hasta = null,
         actualizado_en = now()
   where e.id = p_envio and e.estado = 'enviando'
  returning e.estado into v_estado;

  if v_estado is null then
    select e.estado into v_estado
      from dominio.resumen_semanal_envios e
     where e.id = p_envio;
  end if;
  return coalesce(v_estado, 'desconocido');
end;
$$;

comment on function private.marcar_resumen_semanal_enviado(uuid) is
  'F-REP-08: marca el envío del resumen semanal como enviado. Idempotente: no pisa un envío ya confirmado.';

create or replace function private.registrar_fallo_resumen_semanal(p_envio uuid, p_motivo text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_error text;
  -- Formas de secreto en texto recuperable (mismo criterio que
  -- private.aplicar_cierre_aviso_reparacion): un motivo de fallo puede traer el mensaje del
  -- SMTP, con hosts o credenciales.
  c_patron_secreto constant text :=
    '(?i)(api[_-]?key|bearer|session|passwd|password|pwd|secret|token)\s*[:=]\s*\S+'
    || '|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+'
    || '|://[^/\s:]+:[^/\s@]+@'
    || '|AKIA[0-9A-Z]{16}';
begin
  perform private.exigir_llamante_kestra();

  -- El motivo se sanea en la base (no solo en el flow): nunca queda el mensaje del SMTP.
  v_error := left(coalesce(nullif(btrim(p_motivo), ''), 'No se pudo enviar el correo'), 500);
  if v_error ~ c_patron_secreto then
    v_error := 'No se pudo enviar el correo';
  end if;

  update dominio.resumen_semanal_envios e
     set estado = 'fallido',
         ultimo_error = v_error,
         reclamado_hasta = null,
         actualizado_en = now()
   where e.id = p_envio and e.estado = 'enviando'
  returning e.estado into v_estado;

  -- Un fallo tardío no reabre un envío ya confirmado.
  if v_estado is null then
    select e.estado into v_estado
      from dominio.resumen_semanal_envios e
     where e.id = p_envio;
  end if;
  return coalesce(v_estado, 'desconocido');
end;
$$;

comment on function private.registrar_fallo_resumen_semanal(uuid, text) is
  'F-REP-08: deja el envío del resumen semanal fallido con un motivo útil. Un fallo tardío no reabre un envío ya confirmado.';

revoke execute on function
  private.resumen_semanal_datos(uuid),
  private.armar_resumen_semanal(uuid, uuid, text),
  private.reclamar_resumen_semanal(integer, text),
  private.marcar_resumen_semanal_enviado(uuid),
  private.registrar_fallo_resumen_semanal(uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function
      private.reclamar_resumen_semanal(integer, text),
      private.marcar_resumen_semanal_enviado(uuid),
      private.registrar_fallo_resumen_semanal(uuid, text)
      to kestra_orquestacion;
  end if;
end
$$;
