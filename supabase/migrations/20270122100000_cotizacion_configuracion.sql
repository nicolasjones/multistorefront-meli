-- F-PRE-06 (MSF-419, épica MSF-352) · FR-001, FR-002: configuración de la cotización del dólar.
-- Los valores que MSF-116 dejó fijos (umbral de recálculo 1 %, confirmación 15 %, redondeo $ 10, aviso
-- siempre activo, una cotización para todo el sistema) pasan a una fila por organización.
--
-- Esquema (Principio VII), objeto por objeto:
--   dominio.cotizacion_configuracion      dominio  (NUEVA) dato de negocio del producto: cómo se carga y
--                                         recalcula la cotización de la organización. Una fila por
--                                         organización; sin fila rigen los valores del lanzamiento.
--                                         RLS por organización; select para `cotizacion_dolar` ≥ lectura;
--                                         SIN insert/update/delete para `authenticated`: escribe solo
--                                         `public.guardar_configuracion_cotizacion` (y, para el alcance,
--                                         `public.cambiar_alcance_cotizacion`, 20270122100150). `anon`
--                                         sin privilegios.
--   private.cotizacion_config(org)        private  lectura con valores por omisión (definer: la leen
--                                         funciones que corren con roles sin acceso a la sección).
--   public.obtener_configuracion_cotizacion / guardar_configuracion_cotizacion   public  RPC (no almacenan
--                                         datos).
--
-- `guardar_configuracion_cotizacion` es SECURITY DEFINER (excepción acotada, como `confirmar_cotizacion`):
-- la tabla no tiene escritura para `authenticated` y el evento de actividad (`private.insertar_actividad`)
-- tampoco es invocable por la app. Verifica `edicion` en `cotizacion_dolar` y toma la organización de la
-- SESIÓN; nada de eso llega por parámetro. No cambia el alcance (eso es `cambiar_alcance_cotizacion`).
--
-- Redondeo admitido: 1 («ninguno»), 10, 50 y 100 pesos (las opciones de F-PRE-07). Confirmación: mayor al
-- umbral y hasta 100.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean);
--   drop function public.obtener_configuracion_cotizacion();
--   drop function private.cotizacion_config(uuid);
--   drop table dominio.cotizacion_configuracion;

create table dominio.cotizacion_configuracion (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  alcance text not null default 'sistema' check (alcance in ('sistema', 'empresa')),
  redondeo_pesos integer not null default 10 check (redondeo_pesos in (1, 10, 50, 100)),
  umbral_pct numeric(7, 3) not null default 1 check (umbral_pct >= 0 and umbral_pct <= 100),
  confirmacion_pct numeric(7, 3) not null default 15 check (confirmacion_pct <= 100),
  aviso_activo boolean not null default true,
  updated_at timestamptz not null default now(),
  check (confirmacion_pct > umbral_pct)
);

comment on table dominio.cotizacion_configuracion is
  'F-PRE-06: configuración de la cotización del dólar de la organización (alcance, redondeo, umbral de recálculo, confirmación de variación inusual y aviso en Inicio). Sin fila rigen los valores del lanzamiento. Escritura solo por RPC.';

alter table dominio.cotizacion_configuracion enable row level security;

create policy cotizacion_configuracion_select on dominio.cotizacion_configuracion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('cotizacion_dolar')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.cotizacion_configuracion from public, anon, authenticated;
grant select on dominio.cotizacion_configuracion to authenticated;

-- Configuración efectiva de una organización: la fila o, sin ella, los valores del lanzamiento.
create or replace function private.cotizacion_config(p_organizacion uuid)
returns table (alcance text, redondeo_pesos integer, umbral_pct numeric, confirmacion_pct numeric, aviso_activo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.alcance, 'sistema'), coalesce(c.redondeo_pesos, 10), coalesce(c.umbral_pct, 1),
         coalesce(c.confirmacion_pct, 15), coalesce(c.aviso_activo, true)
    from (select 1) x
    left join dominio.cotizacion_configuracion c on c.organizacion_id = p_organizacion;
$$;

comment on function private.cotizacion_config(uuid) is
  'F-PRE-06: configuración efectiva de la cotización de una organización (la fila o los valores del lanzamiento).';

revoke execute on function private.cotizacion_config(uuid) from public, anon;
grant execute on function private.cotizacion_config(uuid) to authenticated;

create or replace function public.obtener_configuracion_cotizacion()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;

  select * into v_config from private.cotizacion_config(v_organizacion);
  return jsonb_build_object(
    'alcance', v_config.alcance,
    'redondeo_pesos', v_config.redondeo_pesos,
    'umbral_pct', v_config.umbral_pct,
    'confirmacion_pct', v_config.confirmacion_pct,
    'aviso_activo', v_config.aviso_activo
  );
end;
$$;

comment on function public.obtener_configuracion_cotizacion() is
  'F-PRE-06: configuración de la cotización (alcance, redondeo, umbral, confirmación y aviso); sin fila, los valores del lanzamiento. 42501 sin acceso a cotizacion_dolar.';

create or replace function public.guardar_configuracion_cotizacion(
  p_redondeo integer, p_umbral numeric, p_confirmacion numeric, p_aviso boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_actual record;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar la configuración de la cotización' using errcode = '42501';
  end if;
  if p_redondeo is null or p_redondeo not in (1, 10, 50, 100) then
    raise exception 'Elegí un redondeo válido' using errcode = '22023';
  end if;
  if p_umbral is null or p_umbral::text in ('NaN', 'Infinity', '-Infinity') or p_umbral < 0 or p_umbral > 100
     or p_umbral <> round(p_umbral, 3) then
    raise exception 'El umbral debe estar entre 0 y 100 %% y tener hasta 3 decimales' using errcode = '22023';
  end if;
  if p_confirmacion is null or p_confirmacion::text in ('NaN', 'Infinity', '-Infinity')
     or p_confirmacion <= p_umbral or p_confirmacion > 100 or p_confirmacion <> round(p_confirmacion, 3) then
    raise exception 'La confirmación debe ser mayor al umbral y de hasta 100 %%' using errcode = '22023';
  end if;
  if p_aviso is null then
    raise exception 'Indicá si querés el aviso en Inicio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_actual from private.cotizacion_config(v_organizacion);
  -- Idempotente: guardar lo mismo no escribe ni deja evento.
  if (v_actual.redondeo_pesos, v_actual.umbral_pct, v_actual.confirmacion_pct, v_actual.aviso_activo)
     is not distinct from (p_redondeo, p_umbral, p_confirmacion, p_aviso)
     and exists (select 1 from dominio.cotizacion_configuracion c where c.organizacion_id = v_organizacion) then
    return jsonb_build_object('actualizado', false);
  end if;

  insert into dominio.cotizacion_configuracion as c
    (organizacion_id, redondeo_pesos, umbral_pct, confirmacion_pct, aviso_activo)
  values (v_organizacion, p_redondeo, p_umbral, p_confirmacion, p_aviso)
  on conflict (organizacion_id) do update
    set redondeo_pesos = excluded.redondeo_pesos, umbral_pct = excluded.umbral_pct,
        confirmacion_pct = excluded.confirmacion_pct, aviso_activo = excluded.aviso_activo,
        updated_at = now();

  perform private.insertar_actividad(
    v_organizacion, v_usuario, 'cotizacion.configuracion_guardada',
    'Cambió la configuración de la cotización del dólar', null
  );

  return jsonb_build_object('actualizado', true);
end;
$$;

comment on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) is
  'F-PRE-06: guarda redondeo, umbral, confirmación y aviso (no cambia el alcance). Idempotente. 42501 sin edición en cotizacion_dolar; 22023 valor fuera de rango.';

revoke execute on function public.obtener_configuracion_cotizacion() from public, anon;
revoke execute on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) from public, anon;
grant execute on function public.obtener_configuracion_cotizacion() to authenticated;
grant execute on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) to authenticated;
