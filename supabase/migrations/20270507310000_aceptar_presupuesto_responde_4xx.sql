-- Lote 50 (MSF-599, primera ola de la convención de códigos de negocio mapeados a 4xx): `public.aceptar_presupuesto`
-- deja de contestar HTTP 500 ante un presupuesto vencido o ya no aceptable (`55000`, clase 55) y ante uno inexistente
-- (`P0002`). Ahora usa los códigos propios de PostgREST: `PT409` (HTTP 409, estado que no admite aceptar) y `PT404`
-- (HTTP 404, el presupuesto no existe o es de otra organización; el mismo código y mensaje en ambos casos).
-- Mismo patrón que `obtener_reparacion` (20270507180500). El cliente acepta el código viejo y el nuevo.
--
-- Parte de la definición vigente (20261204150000): solo cambian los códigos de los tres rechazos de negocio. El resto
-- (`42501`, idempotencia, `security definer`, `search_path` vacío, grants a `authenticated` sin `anon`) no cambia.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar la definición de 20261204150000.

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
    raise exception 'El presupuesto no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede aceptar presupuestos de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente: reintentar sobre un presupuesto ya aceptado devuelve el estado actual.
  if v_c.estado = 'aceptado' then
    return v_c;
  end if;
  if v_c.estado <> 'pendiente' then
    raise exception 'Este presupuesto ya no se puede aceptar' using errcode = 'PT409';
  end if;
  if v_c.valido_hasta is not null and v_c.valido_hasta < (select private.hoy_argentina()) then
    raise exception 'El presupuesto está vencido y no se puede aceptar' using errcode = 'PT409';
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
