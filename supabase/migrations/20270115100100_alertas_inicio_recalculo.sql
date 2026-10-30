-- MSF-361 · F-INI-02 (FR-021, FR-022, FR-027): recálculo de las alertas de Inicio. Solo service_role (lo
-- llama la Edge Function `recalcular-alertas-inicio`, que dispara el flow de Kestra `alertas-inicio`). El SQL
-- solo calcula y registra: no hace HTTP (docs/adoptar-ciclo-ejecuciones.md §3.1).
--
-- Esquema (Principio VII): sin tablas nuevas; escribe dominio.alertas_inicio y
-- dominio.alertas_inicio_calculos (20270115100000).
--
-- Diseño:
--   * Reemplaza TODAS las filas de la organización en una transacción, bajo `pg_advisory_xact_lock`: dos
--     corridas seguidas (o simultáneas) dejan el mismo conjunto, sin duplicados (SC-004).
--   * Cinco tipos: `sin_stock` y `stock_bajo` (de public.stock_estados, productos activos, por organización),
--     `consultas_sin_atender` (consultas en estado `nueva` por empresa activa), `dolar_sin_cargar` (sin carga
--     confirmada hoy en America/Argentina/Buenos_Aires, igual que public.cotizacion_del_dia) y
--     `margen_negativo` (productos con estado `negativo` por empresa, solo si existe la vista
--     `analitica.margen_producto_canal`; se detecta en tiempo de ejecución).
--   * Las alertas de Mercado Libre / precios en revisión NO existen: el check de `tipo` no las admite y este
--     cálculo no las genera (FR-027) hasta que lo habiliten las épicas de Mercado Libre.
--   * Una consulta agregada por tipo (no por producto), según el riesgo del plan.
--
-- Seguridad: security definer, search_path = ''; la organización llega por argumento porque quien llama es
-- service_role (no hay sesión). `revoke … from public, anon, authenticated` + grant a service_role.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.recalcular_alertas_inicio(uuid);

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

  -- Dólar: sin carga confirmada hoy.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, null, 'dolar_sin_cargar', 'cotizacion_dolar', 1, '/cotizacion', v_ahora
   where not exists (
     select 1 from dominio.cotizaciones z
      where z.organizacion_id = p_organizacion
        and z.cargada_en >= v_hoy_inicio
        and z.cargada_en < v_hoy_inicio + interval '1 day'
   );

  -- Margen negativo por empresa, solo si el contrato de rentabilidad existe.
  if to_regclass('analitica.margen_producto_canal') is not null then
    execute $q$
      insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en)
      select $1, m.empresa_id, 'margen_negativo', 'rentabilidad', count(*)::integer,
             case when count(*) = 1 then (array_agg(m.producto_id))[1] end, '/rentabilidad/productos', $2
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
  'MSF-361: recalcula las alertas de Inicio de una organización (idempotente, con advisory lock) y registra el cálculo. Solo service_role (Edge Function recalcular-alertas-inicio).';
