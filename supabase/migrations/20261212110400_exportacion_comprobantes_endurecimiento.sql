-- F-VTA-09 (MSF-346, devolución del Revisor PR #374): endurece la exportación diferida de comprobantes.
--   · `private.capacidad_exportacion_comprobantes` deja de ser ejecutable por `authenticated`: solo la llama la RPC
--     `public.solicitar_exportacion_comprobantes` (security definer, que ya exige ventas/exportar). Así quien no puede
--     exportar no inserta una capacidad propia ni ve el id de la conexión.
--   · Toma un lock transaccional por usuario antes de la verificación YA_EN_CURSO: dos solicitudes simultáneas con filtros
--     distintos se serializan y la segunda ve la ejecución de la primera.
--
-- Esquemas (Principio VII): sin tablas nuevas; funciones en `private`. Aditiva (create or replace + revoke).
-- Reversión: re-otorgar `grant execute on function private.capacidad_exportacion_comprobantes(uuid) to authenticated`
-- y restaurar la definición de la migración 20261212110200 (sin el `pg_advisory_xact_lock`).

create or replace function private.capacidad_exportacion_comprobantes(p_actor uuid)
returns table (conexion_id uuid, clave_capacidad text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_conexion uuid;
  v_clave text := 'exportar-comprobantes-' || p_actor::text;
begin
  if v_org is null or p_actor is null or p_actor is distinct from (select auth.uid()) then
    raise exception 'NO_AUTORIZADO: la exportación se pide con la propia sesión' using errcode = '42501';
  end if;

  -- Serializa las solicitudes del mismo usuario hasta el fin de la transacción: la verificación YA_EN_CURSO
  -- y el alta de la ejecución no se pisan entre dos pedidos simultáneos.
  perform pg_advisory_xact_lock(hashtextextended(v_clave, 0));

  select c.id into v_conexion
  from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'historial-ventas'
  order by c.created_at desc
  limit 1;
  if v_conexion is null then
    raise exception 'SIN_CONEXION_EXPORTACION: la organización no tiene habilitado el servidor de exportaciones'
      using errcode = 'P0001';
  end if;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, v_clave, 3600)
  on conflict on constraint capacidades_ejecucion_conexion_id_clave_key do nothing;

  return query select v_conexion, v_clave;
end;
$$;

revoke execute on function private.capacidad_exportacion_comprobantes(uuid) from public, anon, authenticated;

comment on function private.capacidad_exportacion_comprobantes(uuid) is
  'F-VTA-09: conexión historial-ventas y capacidad por usuario para exportar (se crea al primer uso); lock por usuario. Sin grant: solo la llama solicitar_exportacion_comprobantes.';
