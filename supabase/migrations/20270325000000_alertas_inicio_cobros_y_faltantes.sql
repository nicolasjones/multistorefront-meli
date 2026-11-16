-- MSF-930 (épica MSF-824, decisión D-1 del tablero): «Qué hacer hoy» suma dos tipos de alerta, `cobros_pendientes`
-- y `faltantes`.
--
-- · cobros_pendientes (sección ventas, enlace /ventas/comprobantes): facturas confirmadas con saldo neto > 0 (total
--   menos cobros y notas de crédito), por empresa activa. La ve quien tiene Ventas con lectura y la empresa accesible.
-- · faltantes (sección stock, enlace /stock/faltantes): líneas faltantes con aviso de reposición pendiente o enviado
--   (circuito de MSF-161) y el faltante todavía abierto, por empresa activa. La ve quien tiene Stock con lectura.
-- Sin umbral: se muestran si hay al menos uno.
--
-- Esquema (Principio VII): sin tablas nuevas; se amplían los check de `dominio.alertas_inicio` y se redefine
-- `public.recalcular_alertas_inicio` (create or replace; el cuerpo de 20270213100007 más los dos bloques nuevos).
-- Migración aditiva. Reversión (migración posterior): borrar las filas de los dos tipos, volver a crear los check
-- con los cinco tipos originales de 20270201200127 y la función con el cuerpo de 20270213100007:
--   delete from dominio.alertas_inicio where tipo in ('cobros_pendientes', 'faltantes');
--   alter table dominio.alertas_inicio drop constraint alertas_inicio_tipo_check, drop constraint alertas_inicio_seccion_check,
--     drop constraint alertas_inicio_enlace_check, drop constraint alertas_inicio_tipo_coherente;
--   (y re-crearlos como en 20270201200127).

do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'dominio.alertas_inicio'::regclass and contype = 'c'
              and conname in ('alertas_inicio_tipo_check', 'alertas_inicio_seccion_check', 'alertas_inicio_enlace_check', 'alertas_inicio_tipo_coherente')
  loop
    execute format('alter table dominio.alertas_inicio drop constraint %I', r.conname);
  end loop;
end $$;

alter table dominio.alertas_inicio
  add constraint alertas_inicio_tipo_check
    check (tipo in ('sin_stock', 'stock_bajo', 'consultas_sin_atender', 'dolar_sin_cargar', 'margen_negativo', 'cobros_pendientes', 'faltantes')),
  add constraint alertas_inicio_seccion_check
    check (seccion in ('stock', 'consultas', 'cotizacion_dolar', 'rentabilidad', 'ventas')),
  add constraint alertas_inicio_enlace_check
    check (enlace in ('/stock', '/consultas', '/cotizacion', '/rentabilidad/productos', '/ventas/comprobantes', '/stock/faltantes')),
  add constraint alertas_inicio_tipo_coherente check (
    (tipo in ('sin_stock', 'stock_bajo') and seccion = 'stock' and enlace = '/stock' and empresa_id is null)
    or (tipo = 'consultas_sin_atender' and seccion = 'consultas' and enlace = '/consultas' and empresa_id is not null)
    or (tipo = 'dolar_sin_cargar' and seccion = 'cotizacion_dolar' and enlace = '/cotizacion' and empresa_id is null)
    or (tipo = 'margen_negativo' and seccion = 'rentabilidad' and enlace = '/rentabilidad/productos' and empresa_id is not null)
    or (tipo = 'cobros_pendientes' and seccion = 'ventas' and enlace = '/ventas/comprobantes' and empresa_id is not null)
    or (tipo = 'faltantes' and seccion = 'stock' and enlace = '/stock/faltantes' and empresa_id is not null)
  );

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

  -- Cobros pendientes por empresa (MSF-930): facturas confirmadas con saldo neto mayor a cero (total menos cobros y
  -- notas de crédito, el mismo saldo de private.saldo_comprobante). Sin umbral: basta con una.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, s.empresa_id, 'cobros_pendientes', 'ventas', count(*)::integer, '/ventas/comprobantes', v_ahora
    from (
      select c.empresa_id,
             round(greatest(
               c.total_con_iva
               - coalesce((select sum(b.importe) from dominio.cobros_comprobante b where b.comprobante_id = c.id), 0)
               - coalesce((select sum(n.total_con_iva) from dominio.comprobantes_venta n
                            where n.organizacion_id = c.organizacion_id and n.comprobante_origen_id = c.id
                              and n.tipo = 'nota_credito' and n.cliente_id = c.cliente_id
                              and private.comprobante_cuenta_como_facturado(n.tipo, n.estado)), 0),
               0), 2) as saldo
        from dominio.comprobantes_venta c
        join dominio.empresas em on em.id = c.empresa_id and em.organizacion_id = c.organizacion_id and em.activa
       where c.organizacion_id = p_organizacion
         and c.tipo = 'factura'
         and c.estado = 'confirmada'
    ) s
   where s.saldo > 0
   group by s.empresa_id;

  -- Faltantes avisados y sin resolver por empresa (MSF-930): líneas «A pedido» de factura confirmada con reserva
  -- activa (private.faltante_abierta) cuyo aviso de reposición está en cola o enviado (MSF-161).
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, a.empresa_id, 'faltantes', 'stock', count(*)::integer, '/stock/faltantes', v_ahora
    from dominio.faltantes_avisos a
    join dominio.empresas em on em.id = a.empresa_id and em.organizacion_id = a.organizacion_id and em.activa
   where a.organizacion_id = p_organizacion
     and a.estado in ('pendiente', 'enviado')
     and private.faltante_abierta(a.linea_id)
   group by a.empresa_id;

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
  'MSF-361/F-PRE-06/MSF-930: recalcula las alertas de Inicio de una organización (idempotente, con advisory lock); la de dólar respeta «Aviso en Inicio» y el alcance. Solo service_role (Edge Function recalcular-alertas-inicio).';
