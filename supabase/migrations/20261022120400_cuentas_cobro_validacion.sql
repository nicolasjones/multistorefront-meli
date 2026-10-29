-- F-VTA-03 (MSF-240, épica MSF-139): validación de CBU/CVU y CUIT de las cuentas de cobro.
-- Esquema: sin tablas nuevas (disparador sobre `dominio.cuentas_cobro`; Principio VII).
--
-- La base es la autoridad (también para llamadas directas): el disparador normaliza (solo dígitos) y valida.
--   - CBU/CVU: 22 dígitos; primer bloque (8 dígitos: banco + sucursal + verificador) con pesos 7-1-3-9-7-1-3 y
--     segundo bloque (14 dígitos: cuenta + verificador) con pesos 3-9-7-1-3-9-7-1-3-9-7-1-3; el dígito verificador
--     de cada bloque es (10 − suma mod 10) mod 10. Mismos vectores que apps/web/src/lib/ventas/cbu.ts.
--   - CUIT: `private.cuit_valido` (módulo 11, creada en 20261021161600), con o sin guiones, guardado sin ellos.
-- `updated_at` avanza solo ante un cambio real (bloqueo optimista; una escritura idempotente no lo rompe).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger cuentas_cobro_normalizar on dominio.cuentas_cobro;
--   drop function private.normalizar_cuenta_cobro();
--   drop function private.cbu_valido(text);

create or replace function private.cbu_valido(p_cbu text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pesos1 int[] := array[7, 1, 3, 9, 7, 1, 3];
  v_pesos2 int[] := array[3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  v_suma int;
  i int;
begin
  if p_cbu is null or p_cbu !~ '^[0-9]{22}$' then
    return false;
  end if;

  v_suma := 0;
  for i in 1..7 loop
    v_suma := v_suma + substr(p_cbu, i, 1)::int * v_pesos1[i];
  end loop;
  if (10 - v_suma % 10) % 10 <> substr(p_cbu, 8, 1)::int then
    return false;
  end if;

  v_suma := 0;
  for i in 1..13 loop
    v_suma := v_suma + substr(p_cbu, 8 + i, 1)::int * v_pesos2[i];
  end loop;
  return (10 - v_suma % 10) % 10 = substr(p_cbu, 22, 1)::int;
end;
$$;

revoke execute on function private.cbu_valido(text) from public, anon, authenticated;

-- `security definer`: el disparador llama a private.cbu_valido y private.cuit_valido, que `authenticated` no ejecuta.
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
        old.orden, old.activa, old.notas) then
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

create trigger cuentas_cobro_normalizar
  before insert or update on dominio.cuentas_cobro
  for each row execute function private.normalizar_cuenta_cobro();
