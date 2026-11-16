-- F-VTA-10 (MSF-365, épica MSF-177, FR-026): `private.marcar_estado_cobro_comprobante`, el punto de entrada por el
-- que cobros (MSF-195, F-VTA-12) pasará una factura a Cobrado o Deuda. Cobrado y Deuda existen, se muestran y se
-- filtran, pero ninguna persona los cambia a mano (`cambiar_estado_comprobante` los rechaza). El disparo en sí
-- queda FUERA de esta historia.
--
-- Esquema (Principio VII): sin tablas nuevas. Lee `dominio.transiciones_estado_comprobante` (rol `sistema`),
-- escribe `dominio.comprobantes_venta` (`dominio`) y `public.registro_actividad` (por `private.insertar_actividad`).
--
-- Seguridad: función `private`, SIN `grant` a `authenticated` ni `anon`: solo la llaman otras funciones
-- `security definer` (la de cobros). Como no hay persona detrás, no hay `auth.uid()`: el actor del evento es el
-- sistema (`actor_id` nulo → «Sistema» en el historial) y la organización sale del propio comprobante.
--
-- Reglas: solo facturas con estado operativo (no `borrador` ni `anulada`); `p_estado` ∈ (`cobrado`, `deuda`); la
-- transición debe existir para el actor `sistema` en la matriz de la organización; idempotente (mismo estado =
-- sin cambios ni evento); fila `for update`. Registra `comprobante.estado_cambiado`.
--
-- Migración aditiva. Reversión (migración posterior): drop function private.marcar_estado_cobro_comprobante(uuid, text);

create or replace function private.marcar_estado_cobro_comprobante(p_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c dominio.comprobantes_venta;
begin
  if p_estado is null or p_estado not in ('cobrado', 'deuda') then
    raise exception 'El estado de cobro debe ser cobrado o deuda' using errcode = '22023';
  end if;

  select * into v_c from dominio.comprobantes_venta c where c.id = p_id for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Solo las facturas tienen estado de cobro' using errcode = '22023';
  end if;
  if v_c.estado in ('borrador', 'anulada') then
    raise exception 'La factura no está en un estado operativo: no admite estado de cobro' using errcode = '55000';
  end if;
  if v_c.estado = p_estado then
    return;
  end if;
  if not exists (
    select 1 from dominio.transiciones_estado_comprobante t
     where t.organizacion_id = v_c.organizacion_id and t.tipo = v_c.tipo
       and t.estado_desde = v_c.estado and t.estado_hasta = p_estado and t.rol_id = 'sistema'
  ) then
    raise exception 'La factura no puede pasar de % a % por el cobro',
      private.etiqueta_estado_comprobante(v_c.estado), private.etiqueta_estado_comprobante(p_estado)
      using errcode = '55000';
  end if;

  update dominio.comprobantes_venta
     set estado = p_estado,
         updated_at = clock_timestamp()
   where id = v_c.id;

  perform private.insertar_actividad(
    v_c.organizacion_id,
    null,
    'comprobante.estado_cambiado',
    format('Estado: %s → %s en la factura %s',
      private.etiqueta_estado_comprobante(v_c.estado), private.etiqueta_estado_comprobante(p_estado), v_c.numero),
    v_c.empresa_id
  );
end;
$$;

revoke execute on function private.marcar_estado_cobro_comprobante(uuid, text) from public, anon, authenticated;

comment on function private.marcar_estado_cobro_comprobante(uuid, text) is
  'Pasa una factura a Cobrado o Deuda con actor sistema (F-VTA-10, FR-026). Punto de entrada de cobros (MSF-195); no ejecutable por authenticated.';
