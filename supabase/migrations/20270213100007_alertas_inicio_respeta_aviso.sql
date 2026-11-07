-- MSF-423 (devolución del PR #711): restaura en `public.recalcular_alertas_inicio` la lógica de «Aviso en Inicio»
-- y alcance de la alerta `dolar_sin_cargar` (F-PRE-06, definida en 20270122100200).
--
-- Causa: 20270201200138 (MSF-361) redefinió la función DESPUÉS de 20270122100200 con la versión previa al aviso, y
-- por orden de versiones pisó el chequeo `aviso_activo`/alcance: con el aviso apagado igual se generaba la alerta
-- (pgTAP cotizacion_alcance, test 95). Esta migración vuelve a dejar el cuerpo de 20270122100200.
--
-- Esquema (Principio VII): sin tablas nuevas. Migración aditiva (create or replace).
-- Reversión (migración posterior): volver a crear la función con el cuerpo de 20270201200138.

create or replace function public.recalcular_alertas_inicio(p_organizacion uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ahora timestamptz := now();
  v_hoy_inicio timestamptz :=
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_total integer;
begin
  if p_organizacion is null or not exists (select 1 from public.organizaciones where id = p_organizacion) then
    raise exception 'La organización no existe' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('alertas_inicio:' || p_organizacion::text, 0));

  delete from dominio.alertas_inicio where organizacion_id = p_organizacion;

  -- Stock (por organización): productos activos sin stock o bajo el mínimo.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en)
  select p_organizacion, null, e.estado, 'stock', count(*)::integer,
         case when count(*) = 1 then (array_agg(e.producto_id))[1] end, '/stock', v_ahora
    from public.stock_estados e
   where e.organizacion_id = p_organizacion
     and e.activo
     and e.estado in ('sin_stock', 'stock_bajo')
   group by e.estado;

  -- Consultas nuevas sin atender, por empresa activa.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, c.empresa_id, 'consultas_sin_atender', 'consultas', count(*)::integer, '/consultas', v_ahora
    from dominio.consultas c
    join dominio.empresas em on em.id = c.empresa_id and em.organizacion_id = c.organizacion_id and em.activa
   where c.organizacion_id = p_organizacion
     and c.estado = 'nueva'
   group by c.empresa_id;

  -- Dólar: sin carga confirmada hoy. No se genera si «Aviso en Inicio» está apagado (F-PRE-06); con alcance
  -- «empresa» aparece si alguna empresa activa no cargó el dólar de hoy.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, null, 'dolar_sin_cargar', 'cotizacion_dolar', 1, '/cotizacion', v_ahora
   where (select k.aviso_activo from private.cotizacion_config(p_organizacion) k)
     and case
       when (select k.alcance from private.cotizacion_config(p_organizacion) k) = 'empresa' then exists (
         select 1 from dominio.empresas em
          where em.organizacion_id = p_organizacion and em.activa
            and not exists (
              select 1 from dominio.cotizaciones z
               where z.organizacion_id = p_organizacion and z.empresa_id = em.id
                 and z.cargada_en >= v_hoy_inicio
                 and z.cargada_en < v_hoy_inicio + interval '1 day'
            )
       )
       else not exists (
         select 1 from dominio.cotizaciones z
          where z.organizacion_id = p_organizacion and z.empresa_id is null
            and z.cargada_en >= v_hoy_inicio
            and z.cargada_en < v_hoy_inicio + interval '1 day'
       )
     end;

  -- Margen negativo por empresa, solo si el contrato de rentabilidad existe.
  if to_regclass('analitica.margen_producto_canal') is not null then
    execute $q$
      insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en)
      select $1::uuid, m.empresa_id, 'margen_negativo', 'rentabilidad', count(*)::integer,
             case when count(*) = 1 then (array_agg(m.producto_id))[1] end, '/rentabilidad/productos', $2::timestamptz
        from analitica.margen_producto_canal m
       where m.organizacion_id = $1
         and m.estado = 'negativo'
       group by m.empresa_id
    $q$ using p_organizacion, v_ahora;
  end if;

  select count(*)::integer into v_total from dominio.alertas_inicio where organizacion_id = p_organizacion;

  insert into dominio.alertas_inicio_calculos (organizacion_id, calculada_en, alertas)
  values (p_organizacion, v_ahora, v_total)
  on conflict (organizacion_id) do update set calculada_en = excluded.calculada_en, alertas = excluded.alertas;

  return jsonb_build_object('alertas', v_total, 'calculada_en', v_ahora);
end;
$$;

revoke execute on function public.recalcular_alertas_inicio(uuid) from public, anon, authenticated;
grant execute on function public.recalcular_alertas_inicio(uuid) to service_role;

comment on function public.recalcular_alertas_inicio(uuid) is
  'MSF-361/F-PRE-06: recalcula las alertas de Inicio de una organización (idempotente, con advisory lock); la de dólar respeta «Aviso en Inicio» y el alcance. Solo service_role (Edge Function recalcular-alertas-inicio).';
