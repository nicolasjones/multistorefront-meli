-- F-VTA-10 (MSF-365, épica MSF-177, FR-022 y FR-024): `public.cambiar_estado_comprobante`, el cambio de estado de una
-- factura según el ROL del actor en la empresa del comprobante, y `public.transiciones_permitidas_comprobante`, que
-- le dice a la pantalla a qué estados puede pasar quien mira (para habilitar o deshabilitar los chips).
--
-- Esquema (Principio VII): sin tablas nuevas. Lee `dominio.transiciones_estado_comprobante` (T001) y escribe
-- `dominio.comprobantes_venta` (ambas `dominio`) y, por `private.registrar_actividad`, `public.registro_actividad`.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión (nunca de un
-- argumento). Exige `ventas` en `edicion` EN LA EMPRESA del comprobante y que la transición exista para el rol del
-- actor en ELLA (`private.rol_en_empresa`; el superadmin con organización activa actúa como `administrador`).
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Reglas:
--   · Solo `factura` ya confirmada. Un `borrador`, una `anulada` o un presupuesto no admiten cambios (55000 / 22023).
--   · `cobrado` y `deuda` no los fija nadie a mano (42501): los dispara cobros (MSF-195) por
--     `private.marcar_estado_cobro_comprobante` (T004).
--   · «Pendiente» es cómo el panel muestra `confirmada`: pedir `pendiente` equivale a `confirmada`.
--   · Idempotente: pedir el estado que ya tiene devuelve el comprobante sin tocar nada ni duplicar eventos.
--   · Bloqueo optimista por `updated_at` (40001) y fila `for update`: dos cambios simultáneos no se pisan.
--   · Registra `comprobante.estado_cambiado` («Estado: Pendiente → Aceptado en la factura N») en la misma transacción.
--
-- Errores: 42501 permiso o transición no permitida al rol · 22023 dato inválido · 55000 documento sin estado
-- operativo · P0002 no existe · 40001 conflicto de edición.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.transiciones_permitidas_comprobante(uuid);
--   drop function public.cambiar_estado_comprobante(uuid, text, timestamptz);
--   drop function private.rol_actor_en_empresa(uuid);
--   drop function private.etiqueta_estado_comprobante(text);

-- Etiqueta visible de un estado (la misma que el catálogo del frontend, `estadosComprobante.ts`).
create or replace function private.etiqueta_estado_comprobante(p_estado text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_estado
    when 'borrador' then 'Borrador'
    when 'confirmada' then 'Pendiente'
    when 'pendiente' then 'Pendiente'
    when 'aceptado' then 'Aceptado'
    when 'cobrado' then 'Cobrado'
    when 'en_proceso' then 'En proceso'
    when 'deuda' then 'Deuda'
    when 'armando' then 'Armando'
    when 'incompleto' then 'Incompleto'
    when 'anulada' then 'Anulada'
    else initcap(replace(coalesce(p_estado, ''), '_', ' '))
  end;
$$;

revoke execute on function private.etiqueta_estado_comprobante(text) from public, anon, authenticated;

-- Rol con el que actúa la sesión en una empresa: el de su asignación o, para el superadmin con organización
-- activa (que `nivel_ventas_en_empresa` trata como edición), `administrador`.
create or replace function private.rol_actor_en_empresa(p_empresa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.rol_en_empresa(p_empresa_id)),
    case
      when (select private.is_superadmin())
        and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
        then 'administrador'
    end
  );
$$;

revoke execute on function private.rol_actor_en_empresa(uuid) from public, anon, authenticated;

create or replace function public.cambiar_estado_comprobante(
  p_id uuid,
  p_estado text,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_destino text := lower(btrim(coalesce(p_estado, '')));
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_rol text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para cambiar el estado de un comprobante' using errcode = '42501';
  end if;

  -- «Pendiente» es la etiqueta de `confirmada` en una factura.
  if v_destino = 'pendiente' then
    v_destino := 'confirmada';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no tiene estados de cobro ni de armado: solo las facturas cambian de estado' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de cambiar su estado' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada y ya no admite cambios de estado' using errcode = '55000';
  end if;

  if v_destino not in ('confirmada', 'aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda') then
    raise exception 'El estado "%" no es un estado válido para una factura', p_estado using errcode = '22023';
  end if;

  -- Idempotente: el mismo estado devuelve el actual, sin evento ni escritura.
  if v_c.estado = v_destino then
    return v_c;
  end if;

  if v_destino in ('cobrado', 'deuda') then
    raise exception 'Cobrado y Deuda no se cambian a mano: se actualizan solos con el cobro del comprobante' using errcode = '42501';
  end if;

  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Alguien modificó este comprobante mientras lo mirabas: recargalo y volvé a intentar' using errcode = '40001';
  end if;

  v_rol := (select private.rol_actor_en_empresa(v_c.empresa_id));
  if v_rol is null or not exists (
    select 1 from dominio.transiciones_estado_comprobante t
     where t.organizacion_id = v_org and t.tipo = v_c.tipo
       and t.estado_desde = v_c.estado and t.estado_hasta = v_destino and t.rol_id = v_rol
  ) then
    raise exception 'Tu rol (%) no puede pasar la factura de % a %',
      private.etiqueta_rol(v_rol),
      private.etiqueta_estado_comprobante(v_c.estado),
      private.etiqueta_estado_comprobante(v_destino)
      using errcode = '42501';
  end if;

  update dominio.comprobantes_venta
     set estado = v_destino,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.estado_cambiado',
    format('Estado: %s → %s en la factura %s',
      private.etiqueta_estado_comprobante(v_c.estado), private.etiqueta_estado_comprobante(v_destino), v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

revoke execute on function public.cambiar_estado_comprobante(uuid, text, timestamptz) from public, anon;
grant execute on function public.cambiar_estado_comprobante(uuid, text, timestamptz) to authenticated;

comment on function public.cambiar_estado_comprobante(uuid, text, timestamptz) is
  'Cambia el estado de una factura confirmada según la matriz de transiciones del rol del actor en la empresa (F-VTA-10, FR-022): idempotente, con bloqueo optimista, rechaza borrador, anulada, presupuesto y Cobrado/Deuda.';

-- Estados a los que la sesión puede pasar el comprobante hoy (etiquetas de la base: `confirmada` = «Pendiente»).
-- Solo informa a la pantalla; la autoridad sigue siendo `cambiar_estado_comprobante`.
create or replace function public.transiciones_permitidas_comprobante(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_nivel text;
  v_rol text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver los estados de un comprobante' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  v_nivel := (select private.nivel_ventas_en_empresa(v_c.empresa_id));
  if v_nivel not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;
  -- Solo quien edita tiene transiciones; el resto ve todos los chips deshabilitados.
  if v_nivel <> 'edicion' or v_c.tipo <> 'factura' or v_c.estado in ('borrador', 'anulada') then
    return '{}'::text[];
  end if;
  v_rol := (select private.rol_actor_en_empresa(v_c.empresa_id));
  return coalesce((
    select array_agg(t.estado_hasta order by t.estado_hasta)
      from dominio.transiciones_estado_comprobante t
     where t.organizacion_id = v_org and t.tipo = v_c.tipo and t.estado_desde = v_c.estado
       and t.rol_id = v_rol and t.estado_hasta not in ('cobrado', 'deuda')
  ), '{}'::text[]);
end;
$$;

revoke execute on function public.transiciones_permitidas_comprobante(uuid) from public, anon;
grant execute on function public.transiciones_permitidas_comprobante(uuid) to authenticated;

comment on function public.transiciones_permitidas_comprobante(uuid) is
  'Estados a los que el rol de la sesión puede pasar la factura (F-VTA-10, FR-024). Informativa: la autoridad es cambiar_estado_comprobante.';
