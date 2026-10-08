-- Contexto de organización activa del superadmin (spec 004).
-- Extiende el esquema de la spec 003: agrega la columna de acción a
-- superadmin_entradas, la RPC salir_de_organizacion, y actualiza
-- entrar_a_organizacion para auditar la salida automática de la
-- organización anterior al cambiar de contexto.

-- ============================================================================
-- superadmin_entradas: distinguir entrada vs. salida (FR-006)
-- ============================================================================

alter table superadmin_entradas
  add column accion text not null default 'entrada'
    check (accion in ('entrada', 'salida'));

comment on column superadmin_entradas.accion is
  'entrada o salida de una organización por parte de un superadmin (spec 004, FR-006/FR-007). Las filas de antes de esta migración son todas "entrada" por el default.';

-- ============================================================================
-- RPC: salir_de_organizacion (Historia 2)
-- ============================================================================

create or replace function public.salir_de_organizacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizacion_id uuid;
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede salir de una organización activa' using errcode = '42501';
  end if;

  select organizacion_id into v_organizacion_id
    from superadmin_organizacion_activa
    where user_id = auth.uid();

  -- No-op si no tenía ninguna organización activa (Clarifications Q1):
  -- no falla, no borra nada, no audita nada.
  if v_organizacion_id is null then
    return;
  end if;

  delete from superadmin_organizacion_activa where user_id = auth.uid();

  insert into superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
  values (auth.uid(), v_organizacion_id, now(), 'salida');
end;
$$;

comment on function public.salir_de_organizacion() is
  'Contrato: specs/004-contexto-organizacion-activa/contracts/salir-de-organizacion.md. Superadmin sale de su organización activa (FR-005); no-op si no tenía ninguna (Clarifications Q1).';

grant execute on function public.salir_de_organizacion() to authenticated;

-- ============================================================================
-- entrar_a_organizacion: se agrega el registro de salida automática de la
-- organización anterior (FR-007), en la misma transacción. Usa
-- clock_timestamp() en vez de now() para los dos inserts de auditoría de
-- esta función porque now() devuelve el inicio de la transacción — las
-- dos filas quedarían con el mismo instante si no se usa clock_timestamp()
-- (ver research.md de la spec 004).
-- ============================================================================

create or replace function public.entrar_a_organizacion(org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizacion_anterior uuid;
begin
  if not private.is_superadmin() then
    raise exception 'Solo un superadmin puede entrar a una organización' using errcode = '42501';
  end if;

  if not exists (select 1 from organizaciones where id = org_id) then
    raise exception 'La organización % no existe', org_id using errcode = 'P0002';
  end if;

  select organizacion_id into v_organizacion_anterior
    from superadmin_organizacion_activa
    where user_id = auth.uid();

  if v_organizacion_anterior is not null and v_organizacion_anterior <> org_id then
    insert into superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
    values (auth.uid(), v_organizacion_anterior, clock_timestamp(), 'salida');
  end if;

  insert into superadmin_organizacion_activa (user_id, organizacion_id, entrado_en)
  values (auth.uid(), org_id, now())
  on conflict (user_id) do update
    set organizacion_id = excluded.organizacion_id,
        entrado_en = excluded.entrado_en;

  insert into superadmin_entradas (user_id, organizacion_id, entrado_en, accion)
  values (auth.uid(), org_id, clock_timestamp(), 'entrada');
end;
$$;

comment on function public.entrar_a_organizacion(uuid) is
  'Contrato: specs/003-fundacion-multitenant/contracts/entrar-a-organizacion.md + specs/004-contexto-organizacion-activa/contracts/entrar-a-organizacion-delta.md. Cambia el contexto activo del superadmin y audita la entrada (y la salida de la organización anterior, si había una), en una sola transacción.';

-- grant execute ya existe desde la spec 003 (CREATE OR REPLACE conserva
-- los grants de la función existente, no hace falta repetirlo).
