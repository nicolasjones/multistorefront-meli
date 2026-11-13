-- MSF-161 · hallazgos de la revisión de Código y Seguridad y de QA (spec 20261110-100000-ventas-avisos-de-faltantes):
-- M-1 (aviso fallido visible), M-2 (token de tanda en el cierre), M-3 (tope de reaviso y tope diario),
-- m-2 (el disparador de «Para avisar» no traga bloqueos), m-4b (`ultimo_error` es un código genérico),
-- m-5 (`mensaje` saneado también en la base), m-6 (una sola regla de encolado para las dos RPC y comentario
-- viejo de `nivel_ventas_en_empresa`), QA M1/M5 (estado «En cola» distinto de «Avisado»).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_avisos             dominio (existente)  columna `tanda`; `mensaje` y `ultimo_error` con check.
--   dominio.faltantes_venta              dominio (existente)  solo se lee.
--   private.sanear_mensaje_aviso         private (NUEVA)      saneo del texto editable (espejo de `sanearMensaje`).
--   private.encolar_aviso_faltante       private (NUEVA)      regla única de encolado (en cola, reaviso, topes).
--   private.marcar_faltantes_para_avisar private (existente)  `create or replace`, misma firma.
--   public.tomar_aviso_faltante          public  (existente)  se recrea: `returns table` suma `tanda`. service_role.
--   public.cerrar_aviso_faltante         public  (existente)  se recrea: suma `p_tanda`. service_role.
--   public.avisar_faltantes_venta        public  (existente)  `create or replace`, misma firma; delega en la regla única.
--   public.avisar_faltantes              public  (existente)  `create or replace`, misma firma; delega en la regla única.
--   public.listar_faltantes              public  (existente)  se recrea: `returns table` suma `aviso_error`.
-- Ninguna tabla se crea: la exportación total no cambia.
--
-- Cambios de comportamiento:
--   * `faltantes_avisos.tanda` (M-2): `tomar_aviso_faltante` la fija en las líneas de la tanda y la devuelve;
--     `cerrar_aviso_faltante(…, p_tanda)` cierra SOLO las líneas de esa tanda. Un cierre tardío (reserva
--     vencida y tanda nueva en vuelo) ya no pisa la tanda nueva. Sin `p_tanda` el cierre es por cliente, como antes.
--   * `ultimo_error` (m-4b) guarda un código: smtp_auth, smtp_conexion, smtp_timeout, destinatario_invalido,
--     sin_correo, faltante_cerrado, intentos_agotados u otro. El detalle técnico queda solo en el log de la
--     función. Las filas existentes se pasan a códigos.
--   * `mensaje` (m-5) se sanea (controles, invisibles, saltos) y un check exige que ya esté saneado.
--   * `avisar_faltantes_venta` y `avisar_faltantes` (M-3, m-6) usan `private.encolar_aviso_faltante`: un
--     faltante `enviado` no se vuelve a avisar antes de 24 horas (ni con `p_reavisar`) y una organización no
--     encola más de 1.000 líneas por día móvil. El resultado suma `omitidos_reaviso_reciente` y
--     `omitidos_tope_diario`.
--   * `listar_faltantes` (M-1, QA M1/M5): `aviso` pasa a `sin_avisar | para_avisar | en_cola | avisado`:
--     `en_cola` = aviso pendiente de envío; `avisado` = correo enviado (con la fecha de envío). Un aviso
--     `agotado` NO cambia la fila: sigue «Para avisar» (llegó mercadería) o «Sin avisar», y `aviso_error`
--     trae el código del último fallo para mostrar «Aviso fallido». `p_aviso` acepta también `en_cola`.
--   * El disparador de «Para avisar» (m-2) reintenta ante deadlock/lock_not_available y, si no puede, deja
--     una actividad segura; un fallo nunca bloquea el ingreso (FR-105).
--
-- Migración idempotente. Reversión (migración posterior; exportar antes `dominio.faltantes_avisos`):
--   -- restaurar tomar_aviso_faltante / cerrar_aviso_faltante / listar_faltantes de 20270226100100,
--   --   20261213100200 y 20270226110300 (drop de las firmas nuevas + create de las viejas);
--   alter table dominio.faltantes_avisos drop constraint if exists faltantes_avisos_mensaje_saneado_chk,
--     drop constraint if exists faltantes_avisos_ultimo_error_codigo_chk, drop column if exists tanda;
--   drop function if exists private.encolar_aviso_faltante(uuid, uuid, uuid, uuid, text, boolean);
--   drop function if exists private.sanear_mensaje_aviso(text);

-- ============================================================================
-- Saneo del texto editable (m-5)
-- ============================================================================

-- Espejo de `sanearMensaje` (supabase/functions/enviar-aviso-faltante/contenido.ts): saltos normalizados,
-- sin controles ni caracteres invisibles/bidi, a lo sumo dos saltos seguidos, recortado a 1.000; vacío = null.
create or replace function private.sanear_mensaje_aviso(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(left(btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(p_texto, ''), $re$\r\n?|[\u2028\u2029\u0085]$re$, E'\n', 'g'),
              $re$\t$re$, ' ', 'g'),
            $re$[\u0001-\u0008\u000B-\u001F\u007F-\u009F]$re$, '', 'g'),
          $re$[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]$re$, '', 'g'),
        $re$\n{3,}$re$, E'\n\n', 'g'),
      E' \n'), 1000), E' \n'),
    '');
$$;

revoke execute on function private.sanear_mensaje_aviso(text) from public, anon, authenticated;

comment on function private.sanear_mensaje_aviso(text) is
  'MSF-161 m-5: saneo del texto editable del aviso (espejo de sanearMensaje de la Edge Function enviar-aviso-faltante).';

alter table dominio.faltantes_avisos add column if not exists tanda uuid;

comment on column dominio.faltantes_avisos.tanda is
  'MSF-161 M-2: identificador de la tanda de envío que tomó la línea (tomar_aviso_faltante). El cierre con p_tanda solo toca las líneas de esa tanda.';

-- Datos existentes: texto saneado y errores como código, antes de exigirlo por check.
update dominio.faltantes_avisos a
   set mensaje = private.sanear_mensaje_aviso(a.mensaje)
 where a.mensaje is distinct from private.sanear_mensaje_aviso(a.mensaje);

update dominio.faltantes_avisos a
   set ultimo_error = case
         when a.ultimo_error = 'El cliente no tiene correo' then 'sin_correo'
         when a.ultimo_error = 'El faltante se cerró antes de enviar el aviso' then 'faltante_cerrado'
         when a.ultimo_error like 'Se agotaron los intentos%' then 'intentos_agotados'
         when a.ultimo_error = 'El correo del cliente no es una dirección válida' then 'destinatario_invalido'
         else 'otro'
       end
 where a.ultimo_error is not null
   and a.ultimo_error not in ('smtp_auth', 'smtp_conexion', 'smtp_timeout', 'destinatario_invalido', 'sin_correo',
                              'faltante_cerrado', 'intentos_agotados', 'otro');

alter table dominio.faltantes_avisos drop constraint if exists faltantes_avisos_mensaje_saneado_chk;
alter table dominio.faltantes_avisos
  add constraint faltantes_avisos_mensaje_saneado_chk
  check (mensaje is null or mensaje = private.sanear_mensaje_aviso(mensaje));

alter table dominio.faltantes_avisos drop constraint if exists faltantes_avisos_ultimo_error_codigo_chk;
alter table dominio.faltantes_avisos
  add constraint faltantes_avisos_ultimo_error_codigo_chk
  check (ultimo_error is null or ultimo_error in (
    'smtp_auth', 'smtp_conexion', 'smtp_timeout', 'destinatario_invalido', 'sin_correo',
    'faltante_cerrado', 'intentos_agotados', 'otro'));

comment on column dominio.faltantes_avisos.ultimo_error is
  'MSF-161 m-4b: código genérico del último fallo (smtp_auth, smtp_conexion, smtp_timeout, destinatario_invalido, sin_correo, faltante_cerrado, intentos_agotados, otro). El detalle va solo al log de la Edge Function.';

-- ============================================================================
-- Cola de la Edge Function: tomar / cerrar con token de tanda (M-2) y errores como código (m-4b)
-- ============================================================================

drop function if exists public.tomar_aviso_faltante(uuid, integer);

create function public.tomar_aviso_faltante(p_cliente uuid, p_tope integer default 5)
returns table (cliente text, correo text, lineas jsonb, tanda uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_correo text;
  v_nombre text;
  v_ids uuid[];
  v_tanda uuid;
begin
  -- Serializa por cliente: dos barridos simultáneos no toman las mismas líneas.
  perform 1 from dominio.faltantes_avisos a where a.cliente_id = p_cliente and a.estado = 'pendiente' for update;

  -- Tope cumplido y reserva vencida (el proceso murió en el último intento): queda agotado y visible.
  update dominio.faltantes_avisos a
     set estado = 'agotado',
         ultimo_error = coalesce(a.ultimo_error, 'intentos_agotados'),
         updated_at = now()
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and a.intentos >= v_tope and a.updated_at <= now() - interval '2 minutes';

  -- El faltante se cerró antes de salir el correo: no se avisa de un faltante que ya no existe. Una línea en
  -- vuelo (intento tomado hace menos de 2 minutos) no se toca: ese correo ya salió y lo cierra su tanda.
  update dominio.faltantes_avisos a
     set estado = 'agotado',
         ultimo_error = 'faltante_cerrado',
         updated_at = now()
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
     and not private.faltante_abierta(a.linea_id);

  -- Un envío del mismo cliente puede estar EN VUELO (tanda reservada hace menos de 2 minutos): no se abre
  -- otra tanda para ese cliente.
  if exists (
    select 1
    from dominio.faltantes_avisos a
    where a.cliente_id = p_cliente
      and a.estado = 'pendiente'
      and a.intentos > 0
      and a.updated_at > now() - interval '2 minutes'
  ) then
    return;
  end if;

  -- La tanda: las líneas pendientes vigentes del cliente con el MISMO texto que la más antigua.
  with cand as (
    select a.linea_id, a.mensaje, a.created_at
      from dominio.faltantes_avisos a
     where a.cliente_id = p_cliente and a.estado = 'pendiente'
       and a.intentos < v_tope
       and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
       and private.faltante_abierta(a.linea_id)
  ), primera as (
    select c.mensaje from cand c order by c.created_at, c.linea_id limit 1
  )
  select array_agg(c.linea_id order by c.created_at, c.linea_id) into v_ids
    from cand c
   where c.mensaje is not distinct from (select p.mensaje from primera p);
  if v_ids is null then
    return;
  end if;

  select nullif(btrim(c.correo), ''), c.nombre into v_correo, v_nombre
    from public.clientes c where c.id = p_cliente;
  if v_correo is null then
    update dominio.faltantes_avisos a
       set estado = 'agotado', ultimo_error = 'sin_correo', updated_at = now()
     where a.linea_id = any (v_ids);
    return;
  end if;

  v_tanda := gen_random_uuid();
  update dominio.faltantes_avisos a
     set intentos = a.intentos + 1, updated_at = now(), tanda = v_tanda
   where a.linea_id = any (v_ids);

  return query
    select v_nombre, v_correo,
           jsonb_agg(jsonb_build_object(
             'producto', p.nombre,
             'sku', p.sku,
             'cantidad', coalesce(fv.cantidad_faltante, l.cantidad),
             'comprobante', c.numero,
             'mensaje', a.mensaje
           ) order by c.numero, l.orden),
           v_tanda
      from dominio.faltantes_avisos a
      join dominio.comprobantes_venta_lineas l on l.id = a.linea_id
      join dominio.comprobantes_venta c on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
      join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
      left join dominio.faltantes_venta fv
        on fv.comprobante_id = l.comprobante_id and fv.linea_orden = l.orden
       and fv.organizacion_id = l.organizacion_id and fv.estado = 'abierto'
     where a.linea_id = any (v_ids);
end;
$$;

drop function if exists public.cerrar_aviso_faltante(uuid, boolean, text, integer);
drop function if exists public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid);

-- Cierra los avisos tomados: enviado, o fallido (queda pendiente para el reintento y, al llegar al tope,
-- agotado). Con `p_tanda` solo toca las líneas de esa tanda (un cierre tardío no pisa una tanda nueva); sin
-- ella, todas las pendientes tomadas del cliente (compatibilidad). `p_error` es un código: lo que no sea uno
-- conocido se guarda como `otro` (el detalle técnico no entra a la base).
create function public.cerrar_aviso_faltante(
  p_cliente uuid,
  p_enviado boolean,
  p_error text default null,
  p_tope integer default 5,
  p_tanda uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_error text := case
    when p_error in ('smtp_auth', 'smtp_conexion', 'smtp_timeout', 'destinatario_invalido', 'sin_correo',
                     'faltante_cerrado', 'intentos_agotados') then p_error
    else 'otro'
  end;
begin
  if p_enviado then
    update dominio.faltantes_avisos a
       set estado = 'enviado', enviado_en = now(), ultimo_error = null, updated_at = now()
     where a.cliente_id = p_cliente and a.estado = 'pendiente' and a.intentos > 0
       and (p_tanda is null or a.tanda = p_tanda);
  else
    -- No se toca `updated_at`: la reserva de 2 minutos corre desde la toma y es la espera del reintento.
    update dominio.faltantes_avisos a
       set estado = case when a.intentos >= v_tope then 'agotado' else 'pendiente' end,
           ultimo_error = v_error
     where a.cliente_id = p_cliente and a.estado = 'pendiente' and a.intentos > 0
       and (p_tanda is null or a.tanda = p_tanda);
  end if;
end;
$$;

revoke execute on function public.tomar_aviso_faltante(uuid, integer) from public, anon, authenticated;
revoke execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.tomar_aviso_faltante(uuid, integer) to service_role;
grant execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) to service_role;

comment on function public.tomar_aviso_faltante(uuid, integer) is
  'MSF-405 / F-VTA-26 / MSF-161 M-2: reserva los avisos pendientes de un cliente (con el mismo texto) para mandarle un correo, cuenta el intento y devuelve el token de la tanda. No abre una segunda tanda del mismo cliente mientras hay un envío en vuelo. Solo service_role (Edge Function enviar-aviso-faltante).';
comment on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) is
  'MSF-405 / MSF-161 M-2, m-4b: marca como enviados o fallidos los avisos de la tanda p_tanda (sin ella, los tomados del cliente); el error se guarda como código genérico; al llegar al tope quedan agotados. Solo service_role.';

-- ============================================================================
-- Regla única de encolado (M-3, m-5, m-6)
-- ============================================================================

-- Encola el aviso de UNA línea con las reglas compartidas por las dos RPC de la pantalla:
--   pendiente -> en_cola (nunca se pisa) · enviado sin p_reavisar -> ya_avisado · enviado con p_reavisar pero
--   enviado hace menos de 24 h -> reaviso_reciente (sin override) · organización con 1.000 líneas encoladas en
--   las últimas 24 h -> tope_diario · agotado (o sin fila) -> encolado (estado pendiente, intentos 0, sin error).
-- El permiso y la pertenencia a la organización los resuelve quien llama; acá solo se escribe la cola.
create or replace function private.encolar_aviso_faltante(
  p_linea uuid, p_org uuid, p_empresa uuid, p_cliente uuid, p_mensaje text, p_reavisar boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado text;
  v_enviado_en timestamptz;
  v_hoy integer;
  v_filas integer;
  v_mensaje text := private.sanear_mensaje_aviso(p_mensaje);
begin
  select a.estado, a.enviado_en into v_estado, v_enviado_en
    from dominio.faltantes_avisos a where a.linea_id = p_linea for update;

  if v_estado = 'pendiente' then
    return 'en_cola';
  end if;
  if v_estado = 'enviado' then
    if not coalesce(p_reavisar, false) then
      return 'ya_avisado';
    end if;
    if coalesce(v_enviado_en, '-infinity'::timestamptz) > now() - interval '24 hours' then
      return 'reaviso_reciente';
    end if;
  end if;

  select count(*)::integer into v_hoy
    from dominio.faltantes_avisos a
   where a.organizacion_id = p_org and a.created_at > now() - interval '24 hours';
  if v_hoy >= 1000 then
    return 'tope_diario';
  end if;

  insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje)
  values (p_linea, p_org, p_empresa, p_cliente, v_mensaje)
  on conflict (linea_id) do update
    set estado = 'pendiente', intentos = 0, ultimo_error = null, enviado_en = null, tanda = null,
        created_at = now(), updated_at = now(), mensaje = excluded.mensaje
    where dominio.faltantes_avisos.estado = 'agotado'
       or (dominio.faltantes_avisos.estado = 'enviado' and coalesce(p_reavisar, false));
  get diagnostics v_filas = row_count;
  if v_filas > 0 then
    return 'encolado';
  end if;
  -- Otra sesión la dejó en cola o la avisó entre la lectura y la escritura.
  return case
    when (select a.estado from dominio.faltantes_avisos a where a.linea_id = p_linea) = 'pendiente' then 'en_cola'
    else 'ya_avisado'
  end;
end;
$$;

revoke execute on function private.encolar_aviso_faltante(uuid, uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;

comment on function private.encolar_aviso_faltante(uuid, uuid, uuid, uuid, text, boolean) is
  'MSF-161 M-3 / m-6: regla única de encolado de un aviso de faltante (en cola, ya avisado, reaviso no antes de 24 h, tope diario de 1.000 líneas por organización). La usan avisar_faltantes_venta y avisar_faltantes.';

create or replace function public.avisar_faltantes_venta(
  p_ids uuid[],
  p_mensaje text default null,
  p_reavisar boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensaje text := nullif(btrim(coalesce(p_mensaje, '')), '');
  v_reavisar boolean := coalesce(p_reavisar, false);
  v_fila record;
  v_nivel text;
  v_resultado text;
  v_detalle jsonb := '[]'::jsonb;
  v_encolados integer := 0;
  v_ya integer := 0;
  v_cola integer := 0;
  v_sin_correo integer := 0;
  v_sin_permiso integer := 0;
  v_no_abiertos integer := 0;
  v_reciente integer := 0;
  v_tope integer := 0;
  v_clientes uuid[] := '{}';
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('ventas')) is distinct from 'edicion' then
    raise exception 'No tenés permiso para avisar faltantes' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;
  if length(v_mensaje) > 1000 then
    raise exception 'El texto del aviso no puede pasar de 1.000 caracteres' using errcode = '22023';
  end if;

  for v_fila in
    select u.id,
           f.empresa_id,
           f.id as faltante_id,
           l.id as linea_id,
           c.cliente_id,
           nullif(btrim(cl.correo), '') as correo
      from (select distinct x as id from unnest(p_ids) x where x is not null) u
      left join dominio.faltantes_venta f
        on f.id = u.id and f.organizacion_id = v_org and f.estado = 'abierto'
      left join dominio.comprobantes_venta c
        on c.id = f.comprobante_id and c.organizacion_id = f.organizacion_id
      left join dominio.comprobantes_venta_lineas l
        on l.comprobante_id = f.comprobante_id and l.orden = f.linea_orden
       and l.organizacion_id = f.organizacion_id
      left join public.clientes cl
        on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
     order by u.id
  loop
    v_resultado := null;
    if v_fila.faltante_id is null or v_fila.linea_id is null then
      v_resultado := 'no_abierto';
    else
      v_nivel := (select private.nivel_ventas_en_empresa(v_fila.empresa_id));
      if v_nivel is distinct from 'edicion' then
        -- Una tienda que ni se puede leer no delata que el faltante existe.
        v_resultado := case when v_nivel = 'lectura' then 'sin_permiso' else 'no_abierto' end;
      elsif v_fila.correo is null then
        v_resultado := 'sin_correo';
      else
        v_resultado := private.encolar_aviso_faltante(
          v_fila.linea_id, v_org, v_fila.empresa_id, v_fila.cliente_id, v_mensaje, v_reavisar);
        if v_resultado = 'encolado' then
          v_clientes := v_clientes || v_fila.cliente_id;
        end if;
      end if;
    end if;

    case v_resultado
      when 'encolado' then v_encolados := v_encolados + 1;
      when 'ya_avisado' then v_ya := v_ya + 1;
      when 'en_cola' then v_cola := v_cola + 1;
      when 'sin_correo' then v_sin_correo := v_sin_correo + 1;
      when 'sin_permiso' then v_sin_permiso := v_sin_permiso + 1;
      when 'reaviso_reciente' then v_reciente := v_reciente + 1;
      when 'tope_diario' then v_tope := v_tope + 1;
      else v_no_abiertos := v_no_abiertos + 1;
    end case;
    v_detalle := v_detalle || jsonb_build_object('id', v_fila.id, 'resultado', v_resultado);
  end loop;

  if jsonb_array_length(v_detalle) = 0 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;

  if v_encolados > 0 then
    perform private.registrar_actividad(
      'ventas.faltantes_avisados',
      left(format('Aviso de faltantes encolado para %s faltantes de %s clientes', v_encolados,
                  (select count(distinct x) from unnest(v_clientes) x)), 500)
    );
  end if;

  return jsonb_build_object(
    'encolados', (select count(distinct x) from unnest(v_clientes) x),
    'lineas_avisadas', v_encolados,
    'omitidos_ya_avisados', v_ya,
    'omitidos_en_cola', v_cola,
    'omitidos_sin_correo', v_sin_correo,
    'omitidos_sin_permiso', v_sin_permiso,
    'omitidos_no_abiertos', v_no_abiertos,
    'omitidos_reaviso_reciente', v_reciente,
    'omitidos_tope_diario', v_tope,
    'detalle', v_detalle
  );
end;
$$;

revoke execute on function public.avisar_faltantes_venta(uuid[], text, boolean) from public, anon;
grant execute on function public.avisar_faltantes_venta(uuid[], text, boolean) to authenticated;

comment on function public.avisar_faltantes_venta(uuid[], text, boolean) is
  'F-VTA-26 / MSF-161 M-3: encola el aviso de los faltantes de venta elegidos (uno por línea, un correo por cliente) con el texto editable saneado, por la regla única private.encolar_aviso_faltante. Exige ventas en edición (global y en la tienda); omite ya avisados (salvo p_reavisar, y no antes de 24 h), en cola, sin correo, de tiendas sin edición y lo que pase el tope diario de 1.000 líneas por organización. La organización y el actor salen de la sesión.';

-- La RPC de F-STK-17 (por línea de la vista `faltantes_listado`) comparte la regla única de encolado.
create or replace function public.avisar_faltantes(p_lineas uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_fila record;
  v_resultado text;
  v_ya integer := 0;
  v_sin_stock integer := 0;
  v_sin_correo integer := 0;
  v_sin_permiso integer := 0;
  v_tope integer := 0;
  v_avisadas integer := 0;
  v_clientes uuid[] := '{}';
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('stock')) not in ('lectura', 'edicion') then
    raise exception 'No tenés permiso para avisar faltantes' using errcode = '42501';
  end if;
  if p_lineas is null or cardinality(p_lineas) = 0 or cardinality(p_lineas) > 200 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;

  for v_fila in
    select v.linea_id, v.empresa_id, v.cliente_id, v.estado_stock, v.aviso,
           nullif(btrim(c.correo), '') as correo
      from public.faltantes_listado v
      join public.clientes c on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.linea_id = any (p_lineas) and v.organizacion_id = v_org
     order by v.linea_id
  loop
    if (select private.nivel_ventas_en_empresa(v_fila.empresa_id)) <> 'edicion' then
      v_sin_permiso := v_sin_permiso + 1;
    elsif v_fila.aviso = 'avisado' then
      v_ya := v_ya + 1;
    elsif v_fila.estado_stock = 'sin_stock' then
      v_sin_stock := v_sin_stock + 1;
    elsif v_fila.correo is null then
      v_sin_correo := v_sin_correo + 1;
    else
      v_resultado := private.encolar_aviso_faltante(
        v_fila.linea_id, v_org, v_fila.empresa_id, v_fila.cliente_id, null, false);
      if v_resultado = 'encolado' then
        v_avisadas := v_avisadas + 1;
        v_clientes := v_clientes || v_fila.cliente_id;
      elsif v_resultado = 'tope_diario' then
        v_tope := v_tope + 1;
      else
        v_ya := v_ya + 1;  -- otra sesión la avisó entre la lectura y la escritura
      end if;
    end if;
  end loop;

  if v_avisadas > 0 then
    perform private.registrar_actividad(
      'stock.faltantes_avisados',
      format('Aviso de reposición encolado para %s faltantes', v_avisadas)
    );
  end if;

  return jsonb_build_object(
    'encolados', (select count(distinct x) from unnest(v_clientes) x),
    'lineas_avisadas', v_avisadas,
    'omitidos_ya_avisados', v_ya,
    'omitidos_sin_stock', v_sin_stock,
    'omitidos_sin_correo', v_sin_correo,
    'omitidos_sin_permiso', v_sin_permiso
  ) || case when v_tope > 0 then jsonb_build_object('omitidos_tope_diario', v_tope) else '{}'::jsonb end;
end;
$$;

revoke execute on function public.avisar_faltantes(uuid[]) from public, anon;
grant execute on function public.avisar_faltantes(uuid[]) to authenticated;

comment on function public.avisar_faltantes(uuid[]) is
  'MSF-405 / MSF-161 m-6: encola el aviso de reposición de los faltantes elegidos (uno por línea, un correo por cliente) por la regla única private.encolar_aviso_faltante. Exige ventas en edición en la tienda; omite ya avisados, sin stock, sin correo y lo que pase el tope diario.';

-- Comentario corregido (m-6c): el de 20270112130100 decía que `nivel_ventas_en_empresa` no es ejecutable por
-- `authenticated`; desde 20261213100200 sí lo es (no filtra datos: informa el nivel de quien llama).
comment on function private.nivel_ventas_en_empresa(uuid) is
  'Nivel de Ventas de quien llama en una empresa (ninguno | lectura | edicion). Ejecutable por authenticated desde 20261213100200 (lo usan la política de faltantes_avisos y las vistas security_invoker); security definer, no recibe datos ajenos.';

-- ============================================================================
-- listar_faltantes: «En cola», «Avisado» solo si salió, y el error del aviso fallido (M-1, QA M1/M5)
-- ============================================================================

drop function if exists public.listar_faltantes(uuid, integer, integer, text);

create function public.listar_faltantes(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10,
  p_aviso text default null
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa text,
  cliente text,
  producto text,
  sku text,
  cantidad_faltante integer,
  linea_orden integer,
  comprobante_id uuid,
  comprobante text,
  fecha date,
  desde timestamptz,
  stock_estado text,
  stock_disponible integer,
  aviso text,
  aviso_en timestamptz,
  aviso_error text,
  filas bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresas uuid[];
  v_limite integer := least(greatest(coalesce(p_tamano, 10), 1), 200);
  v_pagina integer := least(greatest(coalesce(p_pagina, 1), 1), 100000);
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los faltantes' using errcode = '42501';
  end if;
  if p_aviso is not null and p_aviso not in ('sin_avisar', 'avisado', 'para_avisar', 'en_cola') then
    raise exception 'El filtro de aviso no es válido' using errcode = '22023';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_org
     and (select private.puede_leer_faltantes_empresa(e.id));

  return query
  with base as (
    select f.id,
           f.empresa_id,
           e.nombre as empresa,
           cl.nombre as cliente,
           pr.nombre as producto,
           pr.sku,
           f.cantidad_faltante,
           f.linea_orden,
           c.id as comprobante_id,
           c.numero as comprobante,
           c.fecha,
           f.creado_en as desde,
           s.estado as stock_estado,
           s.disponible as stock_disponible,
           -- `agotado` (o sin aviso) no cambia la fila: sigue «Para avisar» si llegó mercadería (QA M1).
           case
             when a.estado = 'enviado' then 'avisado'
             when a.estado = 'pendiente' then 'en_cola'
             when f.para_avisar_en is not null then 'para_avisar'
             else 'sin_avisar'
           end as aviso,
           case
             when a.estado = 'enviado' then coalesce(a.enviado_en, a.created_at)
             when a.estado = 'pendiente' then a.created_at
             else f.para_avisar_en
           end as aviso_en,
           case when a.estado = 'agotado' then coalesce(a.ultimo_error, 'otro') end as aviso_error
      from dominio.faltantes_venta f
      join dominio.empresas e
        on e.id = f.empresa_id and e.organizacion_id = f.organizacion_id
      join dominio.comprobantes_venta c
        on c.id = f.comprobante_id and c.organizacion_id = f.organizacion_id
      join public.clientes cl
        on cl.id = c.cliente_id and cl.organizacion_id = f.organizacion_id
      join dominio.productos pr
        on pr.id = f.producto_id and pr.organizacion_id = f.organizacion_id
      left join public.stock_estados s
        on s.producto_id = f.producto_id and s.organizacion_id = f.organizacion_id
      left join dominio.comprobantes_venta_lineas l
        on l.comprobante_id = f.comprobante_id and l.orden = f.linea_orden
       and l.organizacion_id = f.organizacion_id
      left join dominio.faltantes_avisos a
        on a.linea_id = l.id and a.organizacion_id = f.organizacion_id
     where f.organizacion_id = v_org
       and f.estado = 'abierto'
       and f.empresa_id = any (v_empresas)
       and (p_empresa_id is null or f.empresa_id = p_empresa_id)
  )
  select b.id, b.empresa_id, b.empresa, b.cliente, b.producto, b.sku, b.cantidad_faltante, b.linea_orden,
         b.comprobante_id, b.comprobante, b.fecha, b.desde, b.stock_estado, b.stock_disponible,
         b.aviso, b.aviso_en, b.aviso_error,
         count(*) over () as filas
    from base b
   where p_aviso is null or b.aviso = p_aviso
   order by case when p_aviso = 'para_avisar' then b.desde end asc nulls last,
            b.desde desc,
            b.id
   limit v_limite
  offset (v_pagina - 1) * v_limite;
end;
$$;

comment on function public.listar_faltantes(uuid, integer, integer, text) is
  'Faltantes de venta ABIERTOS, paginados, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde», el stock de hoy y el aviso (sin_avisar | para_avisar | en_cola | avisado) con su fecha y, si el último envío falló, aviso_error (código genérico). p_aviso filtra y con para_avisar ordena del más antiguo al más nuevo. Solo de las empresas donde la persona tiene Ventas en lectura (F-VTA-18 FR-043, F-VTA-26 FR-008, F-VTA-27 FR-103, MSF-161 M-1).';

revoke execute on function public.listar_faltantes(uuid, integer, integer, text) from public, anon;
grant execute on function public.listar_faltantes(uuid, integer, integer, text) to authenticated;

-- ============================================================================
-- Disparador de «Para avisar»: no traga bloqueos (m-2)
-- ============================================================================

create or replace function private.marcar_faltantes_para_avisar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo integer;
  v_marcados integer;
  v_producto text;
  v_intento integer := 0;
  v_hecho boolean := false;
  f record;
begin
  while not v_hecho loop
    v_intento := v_intento + 1;
    begin
      v_saldo := new.cantidad;
      v_marcados := 0;
      for f in
        select fv.id, fv.cantidad_faltante
          from dominio.faltantes_venta fv
         where fv.organizacion_id = new.organizacion_id
           and fv.producto_id = new.producto_id
           and fv.estado = 'abierto'
           and fv.para_avisar_en is null
           and not exists (
             select 1
               from dominio.comprobantes_venta_lineas l
               join dominio.faltantes_avisos a on a.linea_id = l.id
              where l.comprobante_id = fv.comprobante_id
                and l.orden = fv.linea_orden
                and l.organizacion_id = fv.organizacion_id
                and a.estado in ('pendiente', 'enviado')
           )
         order by fv.creado_en, fv.id
           for update of fv
      loop
        -- Un faltante cuenta completo o no cuenta: el que no entra en el saldo se salta y se sigue con el
        -- siguiente más antiguo (así un faltante grande no bloquea a los demás del producto).
        exit when v_saldo <= 0;
        continue when f.cantidad_faltante > v_saldo;
        update dominio.faltantes_venta
           set para_avisar_en = now(), para_avisar_ingreso_id = new.ingreso_id
         where id = f.id;
        v_saldo := v_saldo - f.cantidad_faltante;
        v_marcados := v_marcados + 1;
      end loop;
      v_hecho := true;
    exception
      when deadlock_detected or lock_not_available then
        -- Bloqueo transitorio (p. ej. contra registrar_faltantes_despacho): se reintenta un par de veces con
        -- una espera corta; las marcas parciales del intento ya se deshicieron con el bloque.
        if v_intento < 3 then
          perform pg_sleep(0.05 * v_intento);
        else
          raise warning 'marcar_faltantes_para_avisar: bloqueo sin resolver tras % intentos (%)', v_intento, sqlstate;
          begin
            perform private.registrar_actividad(
              'ventas.faltantes_para_avisar_demorado',
              'Ingreso de mercadería: por un bloqueo no se pudieron marcar los faltantes Para avisar; se marcan con el próximo ingreso del producto'
            );
          exception when others then
            raise warning 'marcar_faltantes_para_avisar: no se registró la demora (%)', sqlstate;
          end;
          return new;
        end if;
      when others then
        -- El ingreso de mercadería nunca se rompe por esto (FR-105); el detalle queda en el log del servidor.
        raise warning 'marcar_faltantes_para_avisar: no se pudo marcar (%)', sqlstate;
        return new;
    end;
  end loop;

  if v_marcados > 0 then
    begin
      select p.nombre into v_producto
        from dominio.productos p
       where p.id = new.producto_id and p.organizacion_id = new.organizacion_id;
      perform private.registrar_actividad(
        'ventas.faltantes_para_avisar',
        left(format('Ingreso de mercadería: %s faltantes de %s quedaron Para avisar',
                    v_marcados, coalesce(v_producto, 'un producto')), 500)
      );
    exception when others then
      raise warning 'marcar_faltantes_para_avisar: no se registró la actividad (%)', sqlstate;
    end;
  end if;

  return new;
end;
$$;

revoke execute on function private.marcar_faltantes_para_avisar() from public, anon, authenticated;

comment on function private.marcar_faltantes_para_avisar() is
  'F-VTA-27 / MSF-161 m-2: disparador AFTER INSERT de dominio.ingresos_mercaderia_lineas. Marca «Para avisar» los faltantes abiertos del producto, por antigüedad, hasta agotar la cantidad ingresada. Reintenta ante deadlock/lock_not_available y deja una actividad segura si no puede. No envía nada y no rompe el ingreso si falla.';
