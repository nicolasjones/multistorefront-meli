-- MSF-666/validación (lote 38): DNI/CUIT validado en el SERVIDOR.
-- Hasta hoy `dominio.clientes.documento` solo se limitaba a 40 caracteres y el CUIT de `dominio.empresas` solo exigía 11
-- dígitos (sin dígito verificador): la validación vivía únicamente en el formulario.
--
-- Esquema (Principio VII): sin tablas ni columnas nuevas; funciones y dos disparadores.
-- Reglas (NULL o vacío siempre permitido):
--   · Cliente: el documento, sin puntos, guiones ni espacios, es un DNI de 7 u 8 dígitos o un CUIT de 11 dígitos con
--     dígito verificador válido (`private.cuit_valido`, módulo 11). Error 23514 con un mensaje en castellano.
--   · Empresa: el CUIT (ya acotado a 11 dígitos por `empresas_cuit_ck`) debe tener dígito verificador válido. Error 23514.
-- Datos existentes: NO se toca ninguna fila ni se agrega un CHECK (que fallaría al actualizar otras columnas de una fila
-- vieja inválida): los disparadores validan SOLO al insertar o cuando el campo cambia. Un cliente o empresa con un valor
-- viejo inválido sigue editable en lo demás; cuando se corrige el campo, se valida.
-- Importación: `private.validar_fila_cliente_migracion` (definición vigente de 20270507200000) rechaza la fila con el motivo
-- antes de insertar, así el lote informa la fila inválida en vez de abortar. El dataset demo ya usa DNI de 8 dígitos y CUIT
-- válidos (scripts/demo-dataset/lib/cuit.mjs).
--
-- Seguridad: funciones `security definer` con `search_path = ''`, objetos calificados, `revoke … from public, anon,
-- authenticated` (se ejecutan solo como disparadores o desde otras funciones).
--
-- Migración aditiva. Reversión (migración posterior): drop trigger clientes_validar_documento on dominio.clientes;
-- drop trigger empresas_validar_cuit on dominio.empresas; drop function private.validar_documento_cliente();
-- drop function private.validar_cuit_empresa(); drop function private.documento_cliente_valido(text); y volver a crear
-- `private.validar_fila_cliente_migracion` con la definición de 20270507200000.

create or replace function private.documento_cliente_valido(p_documento text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_documento, '')), '') is null then true
    else (
      with limpio as (select regexp_replace(btrim(p_documento), '[\s.\-]', '', 'g') as d)
      select d ~ '^[0-9]{7,8}$' or (d ~ '^[0-9]{11}$' and private.cuit_valido(d)) from limpio
    )
  end
$$;

comment on function private.documento_cliente_valido(text) is
  'MSF-666: vacío o nulo es válido; si no, DNI de 7 u 8 dígitos o CUIT de 11 con dígito verificador (ignora puntos, guiones y espacios).';

revoke execute on function private.documento_cliente_valido(text) from public, anon, authenticated;

create or replace function private.validar_documento_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.documento is distinct from old.documento)
     and not private.documento_cliente_valido(new.documento) then
    raise exception 'El DNI/CUIT no es válido: ingresá un DNI de 7 u 8 dígitos o un CUIT de 11 dígitos con su dígito verificador'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_documento_cliente() from public, anon, authenticated;

-- Nombre con prefijo «clientes_n…» posterior a `clientes_normalizar`: corre ya normalizado (btrim, vacío → null).
drop trigger if exists clientes_validar_documento on dominio.clientes;
create trigger clientes_validar_documento
  before insert or update of documento on dominio.clientes
  for each row execute function private.validar_documento_cliente();

create or replace function private.validar_cuit_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cuit is not null
     and (tg_op = 'INSERT' or new.cuit is distinct from old.cuit)
     and not private.cuit_valido(new.cuit) then
    raise exception 'El CUIT no es válido: revisá el dígito verificador' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_cuit_empresa() from public, anon, authenticated;

drop trigger if exists empresas_validar_cuit on dominio.empresas;
create trigger empresas_validar_cuit
  before insert or update of cuit on dominio.empresas
  for each row execute function private.validar_cuit_empresa();

-- ============================================================================
-- Importación de clientes: la fila con un DNI/CUIT inválido se rechaza con su motivo
-- ============================================================================

CREATE OR REPLACE FUNCTION private.validar_fila_cliente_migracion(p_fila jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_campo record;
  v_correo text := nullif(btrim(p_fila ->> 'correo'), '');
  v_tipo text := nullif(lower(btrim(p_fila ->> 'tipo')), '');
  v_acepta text := nullif(lower(btrim(p_fila ->> 'acepta_correo')), '');
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'nombre'), '') is null then
    return 'Falta el nombre o la razón social';
  end if;
  for v_campo in
    select * from (values
      ('nombre', 'El nombre', 200),
      ('documento', 'El DNI/CUIT', 40),
      ('correo', 'El correo', 200),
      ('telefono', 'El teléfono', 60),
      ('celular', 'El celular', 60),
      ('direccion', 'La dirección', 200),
      ('codigo_postal', 'El CP', 20),
      ('localidad', 'La localidad', 120),
      ('provincia', 'La provincia', 120),
      ('expreso_preferido', 'El expreso preferido', 120),
      ('condicion_iva', 'La condición de IVA', private.largo_maximo_condicion_iva())
    ) as t (campo, etiqueta, maximo)
  loop
    if char_length(btrim(coalesce(p_fila ->> v_campo.campo, ''))) > v_campo.maximo then
      return format('%s supera %s caracteres', v_campo.etiqueta, v_campo.maximo);
    end if;
  end loop;
  -- MSF-666: el DNI/CUIT se valida igual que en el alta y la edición (DNI de 7 u 8 dígitos o CUIT con dígito verificador).
  if not private.documento_cliente_valido(p_fila ->> 'documento') then
    return 'El DNI/CUIT no es válido: debe ser un DNI de 7 u 8 dígitos o un CUIT de 11 dígitos con dígito verificador';
  end if;
  if v_correo is not null and v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return 'El correo no tiene un formato válido';
  end if;
  if v_tipo is not null and v_tipo not in ('minorista', 'mayorista') then
    return 'El tipo de cliente debe ser minorista o mayorista';
  end if;
  -- MSF-666: `acepta_correo` es opcional; vacío = sin aceptación (no cambia nada). Solo sí/no.
  if v_acepta is not null and v_acepta not in ('si', 'sí', 's', 'true', 'verdadero', '1', 'no', 'n', 'false', 'falso', '0') then
    return 'La aceptación de correo debe ser sí o no';
  end if;
  return null;
end;
$function$;

revoke execute on function private.validar_fila_cliente_migracion(jsonb) from public, anon, authenticated;
