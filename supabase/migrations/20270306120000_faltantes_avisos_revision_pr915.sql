-- MSF-161 · revisión de Código y Seguridad del PR #915: tope diario sin carrera ni recorrido completo, timeout SMTP como
-- intento incierto, orden de bloqueo común a las dos RPC de encolado y constraints sin bloqueo largo.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_avisos             dominio (existente)  índice (organizacion_id, created_at); checks revalidados.
--   private.encolar_aviso_faltante       private (existente)  `create or replace`, misma firma.
--   public.cerrar_aviso_faltante         public  (existente)  `create or replace`, misma firma. service_role.
--   public.avisar_faltantes_venta        public  (existente)  `create or replace`, misma firma; mismo orden de bloqueo.
-- Ninguna tabla se crea.
--
-- Cambios:
--   * M-1: `private.encolar_aviso_faltante` toma `pg_advisory_xact_lock` por organización ANTES de leer la fila y de contar
--     (las sesiones de una misma organización se serializan: el tope de 1.000/día no se excede por carrera; las de otra
--     organización no se bloquean entre sí) y el conteo usa el índice nuevo. El tope cuenta líneas con aviso encolado en
--     las últimas 24 h; reencolar un `agotado` de la misma ventana no suma cupo porque esa línea ya fue contada y su correo
--     no salió (no hay envío que limitar). Al reencolar un `enviado` sí suma: se reinicia su `created_at`.
--   * M-2: un `smtp_timeout` es un intento INCIERTO (el correo pudo salir tras el corte). `cerrar_aviso_faltante` lo deja
--     `agotado` en el acto en vez de reintentar a los 2 minutos: no se reenvía solo; la persona decide con «Reintentar».
--   * m-4: `avisar_faltantes_venta` recorre los faltantes por línea (como `avisar_faltantes`): mismo orden de bloqueo.
--   * m-6: los checks de `mensaje` y `ultimo_error` se vuelven a crear `not valid` + `validate constraint` (validación sin
--     bloqueo fuerte sobre toda la tabla).
--
-- Migración idempotente. Reversión (migración posterior): drop index if exists dominio.faltantes_avisos_org_created_idx;
-- restaurar las tres funciones de 20270306110000.

create index if not exists faltantes_avisos_org_created_idx
  on dominio.faltantes_avisos (organizacion_id, created_at);

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
  -- Primero el bloqueo de la organización (antes que cualquier bloqueo de fila: así no hay cruces de orden) y recién
  -- después se lee la fila y se cuenta: el tope diario se evalúa sin carrera. Dura hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 161));

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

create or replace function public.cerrar_aviso_faltante(
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
    -- No se toca `updated_at`: la reserva de 2 minutos corre desde la toma y es la espera del reintento. Un
    -- `smtp_timeout` es INCIERTO (el correo pudo salir después del corte): queda agotado y no se reenvía solo.
    update dominio.faltantes_avisos a
       set estado = case when a.intentos >= v_tope or v_error = 'smtp_timeout' then 'agotado' else 'pendiente' end,
           ultimo_error = v_error
     where a.cliente_id = p_cliente and a.estado = 'pendiente' and a.intentos > 0
       and (p_tanda is null or a.tanda = p_tanda);
  end if;
end;
$$;

revoke execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) to service_role;

comment on function public.cerrar_aviso_faltante(uuid, boolean, text, integer, uuid) is
  'MSF-405 / MSF-161 M-2, m-4b: marca como enviados o fallidos los avisos de la tanda p_tanda (sin ella, los tomados del cliente); el error se guarda como código genérico; al llegar al tope, o ante un smtp_timeout (intento incierto), quedan agotados. Solo service_role.';

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
     -- Mismo orden de bloqueo que avisar_faltantes (por línea): dos sesiones no se cruzan en deadlock.
     order by l.id nulls last, u.id
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

-- Los checks se vuelven a crear sin bloqueo largo: `not valid` los aplica a lo nuevo y `validate` revisa lo existente.
alter table dominio.faltantes_avisos drop constraint if exists faltantes_avisos_mensaje_saneado_chk;
alter table dominio.faltantes_avisos
  add constraint faltantes_avisos_mensaje_saneado_chk
  check (mensaje is null or mensaje = private.sanear_mensaje_aviso(mensaje)) not valid;
alter table dominio.faltantes_avisos validate constraint faltantes_avisos_mensaje_saneado_chk;

alter table dominio.faltantes_avisos drop constraint if exists faltantes_avisos_ultimo_error_codigo_chk;
alter table dominio.faltantes_avisos
  add constraint faltantes_avisos_ultimo_error_codigo_chk
  check (ultimo_error is null or ultimo_error in (
    'smtp_auth', 'smtp_conexion', 'smtp_timeout', 'destinatario_invalido', 'sin_correo',
    'faltante_cerrado', 'intentos_agotados', 'otro')) not valid;
alter table dominio.faltantes_avisos validate constraint faltantes_avisos_ultimo_error_codigo_chk;
