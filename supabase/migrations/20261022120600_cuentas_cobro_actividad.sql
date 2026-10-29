-- F-VTA-03 (MSF-240, épica MSF-139): actividad de cuentas de cobro (FR-013).
-- Esquema: sin tablas nuevas (usa `dominio.cuentas_cobro` y `public.registro_actividad`; Principio VII).
--
-- Un disparador `security definer` registra `cuenta_cobro.creada|editada|desactivada|reactivada` en la misma
-- transacción, con el nombre de la cuenta (nunca el CBU/CVU ni el CUIT: dato sensible). Sin evento si no hubo
-- cambio real (`updated_at` no avanzó), así las operaciones idempotentes no duplican. Un cambio solo de
-- «Disponible en» avanza `updated_at` (variable de transacción `cuentas_cobro.tocar`, fijada por la RPC de
-- edición) y cuenta como edición.
--
-- Migración aditiva (reemplaza la función de normalización para sumar el avance forzado de `updated_at`).
-- Reversión (migración posterior):
--   drop trigger cuentas_cobro_registrar_actividad_alta on dominio.cuentas_cobro;
--   drop trigger cuentas_cobro_registrar_actividad on dominio.cuentas_cobro;
--   drop function private.registrar_actividad_cuenta_cobro_alta();
--   drop function private.registrar_actividad_cuenta_cobro();
--   restaurar private.normalizar_cuenta_cobro() a su definición de 20261021165000_cuentas_cobro_validacion.sql.

-- La variable `cuentas_cobro.tocar` (id de la cuenta) solo fuerza el avance del bloqueo optimista; no relaja
-- ninguna validación, así que un llamador directo no gana nada fijándola.
create or replace function private.normalizar_cuenta_cobro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre de la cuenta no puede estar vacío' using errcode = '23514';
  end if;

  new.titular := nullif(btrim(new.titular), '');
  new.banco := nullif(btrim(new.banco), '');
  new.alias := nullif(btrim(new.alias), '');
  new.notas := nullif(btrim(new.notas), '');

  -- CUIT del titular: opcional en la base (la carga inicial puede no traerlo); si viene, tiene que ser válido.
  if new.cuit is not null then
    if new.cuit ~ '[^0-9\s.\-]' then
      raise exception 'El CUIT solo admite números (con o sin guiones)' using errcode = '22023';
    end if;
    new.cuit := nullif(regexp_replace(new.cuit, '[\s.\-]', '', 'g'), '');
    if new.cuit is not null then
      if length(new.cuit) <> 11 then
        raise exception 'El CUIT debe tener 11 dígitos' using errcode = '22023';
      end if;
      if not private.cuit_valido(new.cuit) then
        raise exception 'El CUIT no es válido: revisá el dígito verificador' using errcode = '22023';
      end if;
    end if;
  end if;

  if new.cbu is not null then
    if new.cbu ~ '[^0-9\s.\-]' then
      raise exception 'El CBU/CVU solo admite números' using errcode = '22023';
    end if;
    new.cbu := nullif(regexp_replace(new.cbu, '[\s.\-]', '', 'g'), '');
    if new.cbu is not null then
      if length(new.cbu) <> 22 then
        raise exception 'El CBU/CVU debe tener 22 dígitos' using errcode = '22023';
      end if;
      if not private.cbu_valido(new.cbu) then
        raise exception 'El CBU/CVU no es válido: revisá los dígitos verificadores' using errcode = '22023';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (new.nombre, new.titular, new.cuit, new.banco, new.alias, new.cbu, new.tipo, new.moneda,
        new.orden, new.activa, new.notas)
       is not distinct from
       (old.nombre, old.titular, old.cuit, old.banco, old.alias, old.cbu, old.tipo, old.moneda,
        old.orden, old.activa, old.notas)
       and coalesce(current_setting('cuentas_cobro.tocar', true), '') <> new.id::text then
      new.updated_at := old.updated_at;
    else
      -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
      -- repetirían updated_at y el bloqueo optimista no avanzaría.
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_cuenta_cobro() from public, anon, authenticated;

create or replace function private.registrar_actividad_cuenta_cobro_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'cuenta_cobro.creada',
    format('Creó la cuenta de cobro %s', new.nombre), null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_cuenta_cobro_alta() from public, anon, authenticated;

create trigger cuentas_cobro_registrar_actividad_alta
  after insert on dominio.cuentas_cobro
  for each row execute function private.registrar_actividad_cuenta_cobro_alta();

create or replace function private.registrar_actividad_cuenta_cobro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_estado_cambia boolean;
  v_datos_cambian boolean;
begin
  if v_actor is null or new.updated_at is not distinct from old.updated_at then
    return new;
  end if;
  v_estado_cambia := new.activa is distinct from old.activa;
  v_datos_cambian :=
    (new.nombre, new.titular, new.cuit, new.banco, new.alias, new.cbu, new.tipo, new.moneda, new.orden, new.notas)
    is distinct from
    (old.nombre, old.titular, old.cuit, old.banco, old.alias, old.cbu, old.tipo, old.moneda, old.orden, old.notas);

  -- `updated_at` avanzó: o cambiaron los datos, o el estado, o solo las empresas habilitadas (edición).
  if v_datos_cambian or not v_estado_cambia then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor, 'cuenta_cobro.editada',
      format('Editó la cuenta de cobro %s', new.nombre), null
    );
  end if;
  if v_estado_cambia then
    perform private.insertar_actividad(
      new.organizacion_id, v_actor,
      case when new.activa then 'cuenta_cobro.reactivada' else 'cuenta_cobro.desactivada' end,
      format('%s la cuenta de cobro %s', case when new.activa then 'Reactivó' else 'Marcó «No usar» en' end, new.nombre),
      null
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_cuenta_cobro() from public, anon, authenticated;

create trigger cuentas_cobro_registrar_actividad
  after update on dominio.cuentas_cobro
  for each row execute function private.registrar_actividad_cuenta_cobro();
