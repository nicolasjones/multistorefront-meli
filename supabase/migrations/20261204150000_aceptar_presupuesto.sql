-- F-VTA-08 (MSF-331, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-050, FR-055):
-- `aceptar_presupuesto` y el helper `private.hoy_argentina`.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta` (dominio) y, por
-- `private.registrar_actividad`, `public.registro_actividad` (public, auditoría transversal).
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión. Exige
-- `ventas` en `edicion` EN LA EMPRESA del presupuesto (`private.nivel_ventas_en_empresa`). `revoke ... from
-- public, anon` y `grant execute ... to authenticated` explícitos.
--
-- Reglas: solo un `presupuesto`; `pendiente` → `aceptado` (evento `presupuesto.aceptado` con actor y fecha en
-- el historial de actividad). Idempotente: aceptar uno ya `aceptado` devuelve la fila sin registrar otro
-- evento. Un presupuesto vencido (`valido_hasta` < hoy, derivado, FR-055) no se acepta. Aceptar NO reserva ni
-- descuenta stock (FR-033/FR-050): no toca existencias.
--
-- Errores: 42501 permiso · P0002 no existe · 55000 estado que no admite aceptar (vencido u otro).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.aceptar_presupuesto(uuid);
--   drop function private.hoy_argentina();

-- «Hoy» en Argentina: el servidor corre en UTC y de noche el día cambiaría 3 horas antes que para el cliente.
create or replace function private.hoy_argentina()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

revoke execute on function private.hoy_argentina() from public, anon, authenticated;

comment on function private.hoy_argentina() is
  'Fecha de hoy en America/Argentina/Buenos_Aires (F-VTA-08). Base del «vencido» derivado de los presupuestos.';

create or replace function public.aceptar_presupuesto(p_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para aceptar presupuestos' using errcode = '42501';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org and c.tipo = 'presupuesto'
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede aceptar presupuestos de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente: reintentar sobre un presupuesto ya aceptado devuelve el estado actual.
  if v_c.estado = 'aceptado' then
    return v_c;
  end if;
  if v_c.estado <> 'pendiente' then
    raise exception 'Este presupuesto ya no se puede aceptar' using errcode = '55000';
  end if;
  if v_c.valido_hasta is not null and v_c.valido_hasta < (select private.hoy_argentina()) then
    raise exception 'El presupuesto está vencido y no se puede aceptar' using errcode = '55000';
  end if;

  update dominio.comprobantes_venta
     set estado = 'aceptado',
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'presupuesto.aceptado',
    format('Aceptó el presupuesto %s', v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.aceptar_presupuesto(uuid) from public, anon;
grant execute on function public.aceptar_presupuesto(uuid) to authenticated;

comment on function public.aceptar_presupuesto(uuid) is
  'Pasa un presupuesto pendiente a aceptado, idempotente; no reserva ni descuenta stock (F-VTA-08, FR-050). Exige ventas en edición en su empresa. Contrato en docs/ventas-comprobantes.md.';
