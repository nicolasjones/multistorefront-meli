-- F-STK-14 (MSF-316, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-002, FR-003, FR-004, FR-006): RPC de gestión de depósitos.
-- Esquema: sin tablas nuevas (usa dominio.depositos / depositos_empresas /
-- existencias_deposito de 20261023100000; Principio VII).
--
-- Cuatro RPC `security definer` con `search_path = ''` (las tablas no admiten escritura
-- directa). Todas exigen sesión, organización activa y rol Administrador
-- (`private.puede_escribir()`); la organización y el responsable salen de la sesión.
-- Reglas: siempre un único depósito por defecto; el por defecto no se desactiva; un depósito
-- con unidades no se desactiva; un inactivo no puede ser el por defecto. Los mensajes de
-- rechazo son los de la spec (US1-3, US1-4) y los espeja `apps/web/src/lib/depositos.ts`.
-- Concurrencia: cada RPC bloquea la(s) fila(s) del depósito; `registrar_movimiento_stock`
-- toma el depósito `for share` (20261023100200), de modo que no se puede desactivar un
-- depósito mientras entra mercadería.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.crear_deposito(text, text, uuid[]);
--   drop function public.actualizar_deposito(uuid, text, text, uuid[]);
--   drop function public.definir_deposito_por_defecto(uuid);
--   drop function public.cambiar_activo_deposito(uuid, boolean);
--   drop function private.guardar_empresas_deposito(uuid, uuid, uuid[]);
--   drop function private.validar_datos_deposito(text, text);
--   drop function private.exigir_administrador_depositos();

create or replace function private.exigir_administrador_depositos()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
begin
  if (select auth.uid()) is null or v_organizacion is null or not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede definir depósitos' using errcode = '42501';
  end if;
  return v_organizacion;
end;
$$;

revoke execute on function private.exigir_administrador_depositos() from public, anon, authenticated;

-- Valida nombre y dirección ya recortados.
create or replace function private.validar_datos_deposito(p_nombre text, p_direccion text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_nombre is null or length(p_nombre) < 1 or length(p_nombre) > 80 then
    raise exception 'El nombre del depósito debe tener entre 1 y 80 caracteres' using errcode = '22023';
  end if;
  if p_direccion is not null and length(p_direccion) > 200 then
    raise exception 'La dirección admite hasta 200 caracteres' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.validar_datos_deposito(text, text) from public, anon, authenticated;

-- Reemplaza el conjunto «Venden desde acá» del depósito; todas las empresas deben ser de la organización.
create or replace function private.guardar_empresas_deposito(p_deposito uuid, p_organizacion uuid, p_empresas uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(p_empresas) as x where x is not null), '{}');
begin
  if (select count(*) from dominio.empresas e
       where e.organizacion_id = p_organizacion and e.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Alguna de las empresas elegidas no es válida' using errcode = '22023';
  end if;
  delete from dominio.depositos_empresas where deposito_id = p_deposito;
  insert into dominio.depositos_empresas (deposito_id, empresa_id, organizacion_id)
  select p_deposito, x, p_organizacion from unnest(v_ids) as x;
end;
$$;

revoke execute on function private.guardar_empresas_deposito(uuid, uuid, uuid[]) from public, anon, authenticated;

-- ============================================================================
-- crear_deposito (FR-002)
-- ============================================================================

create or replace function public.crear_deposito(
  p_nombre text,
  p_direccion text default null,
  p_empresas uuid[] default '{}'
)
returns dominio.depositos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := private.exigir_administrador_depositos();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_direccion text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_fila dominio.depositos;
begin
  perform private.validar_datos_deposito(v_nombre, v_direccion);

  begin
    insert into dominio.depositos (organizacion_id, nombre, direccion)
    values (v_organizacion, v_nombre, v_direccion)
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Ya existe un depósito con ese nombre' using errcode = '23505';
  end;

  perform private.guardar_empresas_deposito(v_fila.id, v_organizacion, p_empresas);

  perform private.registrar_actividad('stock.deposito_creado', format('Depósito creado: %s', v_fila.nombre));
  return v_fila;
end;
$$;

comment on function public.crear_deposito(text, text, uuid[]) is
  'F-STK-14: crea un depósito (activo, no por defecto) con sus empresas «Venden desde acá». Solo Administrador.';

revoke execute on function public.crear_deposito(text, text, uuid[]) from public, anon;
grant execute on function public.crear_deposito(text, text, uuid[]) to authenticated;

-- ============================================================================
-- actualizar_deposito (FR-002): mismo formulario que el alta
-- ============================================================================

create or replace function public.actualizar_deposito(
  p_deposito uuid,
  p_nombre text,
  p_direccion text default null,
  p_empresas uuid[] default null
)
returns dominio.depositos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := private.exigir_administrador_depositos();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_direccion text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_fila dominio.depositos;
begin
  perform private.validar_datos_deposito(v_nombre, v_direccion);

  perform 1 from dominio.depositos d
   where d.id = p_deposito and d.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;

  begin
    update dominio.depositos
       set nombre = v_nombre, direccion = v_direccion, updated_at = now()
     where id = p_deposito
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Ya existe un depósito con ese nombre' using errcode = '23505';
  end;

  -- null = no tocar las empresas; un arreglo (aun vacío) reemplaza el conjunto.
  if p_empresas is not null then
    perform private.guardar_empresas_deposito(p_deposito, v_organizacion, p_empresas);
  end if;

  perform private.registrar_actividad('stock.deposito_editado', format('Depósito editado: %s', v_fila.nombre));
  return v_fila;
end;
$$;

comment on function public.actualizar_deposito(uuid, text, text, uuid[]) is
  'F-STK-14: edita nombre, dirección y empresas de un depósito. Solo Administrador.';

revoke execute on function public.actualizar_deposito(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.actualizar_deposito(uuid, text, text, uuid[]) to authenticated;

-- ============================================================================
-- definir_deposito_por_defecto (FR-003): siempre queda exactamente uno
-- ============================================================================

create or replace function public.definir_deposito_por_defecto(p_deposito uuid)
returns dominio.depositos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := private.exigir_administrador_depositos();
  v_fila dominio.depositos;
begin
  -- Bloquea todos los depósitos de la organización: dos cambios simultáneos se serializan.
  perform 1 from dominio.depositos d where d.organizacion_id = v_organizacion order by d.id for update;

  select * into v_fila from dominio.depositos d where d.id = p_deposito and d.organizacion_id = v_organizacion;
  if not found then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;
  if not v_fila.activo then
    raise exception 'Activá el depósito antes de usarlo por defecto' using errcode = '22023';
  end if;

  if not v_fila.por_defecto then
    update dominio.depositos set por_defecto = false, updated_at = now()
     where organizacion_id = v_organizacion and por_defecto;
    update dominio.depositos set por_defecto = true, updated_at = now()
     where id = p_deposito
    returning * into v_fila;
    perform private.registrar_actividad('stock.deposito_defecto', format('Depósito por defecto: %s', v_fila.nombre));
  end if;

  return v_fila;
end;
$$;

comment on function public.definir_deposito_por_defecto(uuid) is
  'F-STK-14: cambia el depósito por defecto en una transacción (siempre queda uno). Solo Administrador.';

revoke execute on function public.definir_deposito_por_defecto(uuid) from public, anon;
grant execute on function public.definir_deposito_por_defecto(uuid) to authenticated;

-- ============================================================================
-- cambiar_activo_deposito (FR-004)
-- ============================================================================

create or replace function public.cambiar_activo_deposito(p_deposito uuid, p_activo boolean)
returns dominio.depositos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := private.exigir_administrador_depositos();
  v_fila dominio.depositos;
begin
  if p_activo is null then
    raise exception 'Indicá si el depósito queda activo o inactivo' using errcode = '22023';
  end if;

  select * into v_fila from dominio.depositos d
   where d.id = p_deposito and d.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;

  if not p_activo and v_fila.activo then
    if v_fila.por_defecto then
      raise exception 'El depósito por defecto no se puede desactivar' using errcode = '22023';
    end if;
    if exists (select 1 from dominio.existencias_deposito x where x.deposito_id = p_deposito and x.cantidad > 0) then
      raise exception 'Tiene stock: trasladá la mercadería antes de desactivarlo' using errcode = '22023';
    end if;
  end if;

  if v_fila.activo is distinct from p_activo then
    update dominio.depositos set activo = p_activo, updated_at = now()
     where id = p_deposito
    returning * into v_fila;
    perform private.registrar_actividad(
      'stock.deposito_activo',
      format('Depósito %s: %s', case when p_activo then 'activado' else 'desactivado' end, v_fila.nombre));
  end if;

  return v_fila;
end;
$$;

comment on function public.cambiar_activo_deposito(uuid, boolean) is
  'F-STK-14: activa o desactiva un depósito; el por defecto y los que tienen unidades no se desactivan. Solo Administrador.';

revoke execute on function public.cambiar_activo_deposito(uuid, boolean) from public, anon;
grant execute on function public.cambiar_activo_deposito(uuid, boolean) to authenticated;
