-- F-SVC-02 (MSF-283, épica MSF-182), devolución del Revisor sobre PR #200.
-- Esquema: sin tablas nuevas; ajusta políticas y funciones de `dominio.reparaciones` y
-- `dominio.reparacion_historial` (Principio VII: siguen en `dominio`, con RLS por organización).
--
-- 1) La lectura exige, igual que crear y actualizar, que la tienda sea una de las accesibles
--    (`private.empresas_accesibles()`): quien solo accede a la tienda A ya no lee las de la tienda B por
--    `select` ni por `obtener_reparacion`. Cubre también `uso_*` (security invoker: rige la RLS).
-- 2) El disparador valida la membresía del técnico solo al insertar o cuando `tecnico_id` cambia: si la
--    baja del técnico asignado lo dejó sin membresía, las demás ediciones se siguen pudiendo guardar.
-- 3) El ingreso no puede ser una fecha futura (al insertar o al cambiarlo).
--
-- Migración aditiva (solo `create or replace` y políticas). Reversión (migración posterior): restaurar
-- las políticas y `private.validar_reparacion()` de 20261020110100 / 20261020110300 y
-- `public.obtener_reparacion(uuid)` de 20261020110500.

drop policy reparaciones_select on dominio.reparaciones;
create policy reparaciones_select on dominio.reparaciones
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

drop policy reparacion_historial_select on dominio.reparacion_historial;
create policy reparacion_historial_select on dominio.reparacion_historial
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.reparaciones r
      where r.id = reparacion_historial.reparacion_id
        and r.empresa_id in (select private.empresas_accesibles())
    )
  );

create or replace function public.obtener_reparacion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
begin
  if (select private.organizacion_id()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver reparaciones' using errcode = '42501';
  end if;
  -- Una reparación de una tienda inaccesible se trata como inexistente (no revela que existe).
  if not exists (
    select 1 from dominio.reparaciones r
    where r.id = p_id and r.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  v_json := private.reparacion_json(p_id);
  if v_json is null then
    raise exception 'La reparación no existe' using errcode = 'P0002';
  end if;
  return v_json;
end;
$$;

create or replace function private.validar_reparacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La tienda no pertenece a la organización' using errcode = '23514';
  end if;
  if new.tecnico_id is not null
     and (tg_op = 'INSERT' or new.tecnico_id is distinct from old.tecnico_id)
     and not exists (
       select 1 from public.usuarios_organizacion u
       where u.user_id = new.tecnico_id and u.organizacion_id = new.organizacion_id
     ) then
    raise exception 'El técnico no pertenece a la organización' using errcode = '23514';
  end if;
  if new.ingreso_en > current_date
     and (tg_op = 'INSERT' or new.ingreso_en is distinct from old.ingreso_en) then
    raise exception 'El ingreso no puede ser una fecha futura' using errcode = '22023', hint = 'ingreso_en';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_reparacion() from public, anon, authenticated;
