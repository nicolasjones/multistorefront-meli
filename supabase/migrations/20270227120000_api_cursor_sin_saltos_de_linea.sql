-- F-API-01 (MSF-233): el cursor de `stock` no se podía usar.
--
-- `encode(..., 'base64')` de Postgres parte la salida con un salto de línea cada 76 caracteres. El cursor de las lecturas
-- con clave triple (stock: fecha | producto | depósito, 121 caracteres) salía con un `\n` adentro: no es base64url, rompe
-- una URL sin codificar y, codificado, el decodificador contaba el salto en el largo del relleno y lo rechazaba
-- (`400 cursor_invalido` en la segunda página de /v1/stock). Productos, precios y ventas (71 caracteres) no se veían afectados.
--
-- · El codificador quita los saltos de línea.
-- · El decodificador ignora espacios en blanco, así que un cursor emitido antes de este arreglo (con `\n`) sigue siendo válido.
--
-- Rollback: volver a las definiciones de 20270224110203_api_lectura.sql y 20270227100000_api_decodificar_cursor_devuelve_fila.sql.
create or replace function private.api_codificar_cursor(p_fecha timestamptz, p_id uuid, p_extra uuid default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select rtrim(
    translate(
      replace(
        encode(
          convert_to(
            (extract(epoch from p_fecha) * 1000000)::bigint::text || '|' || p_id::text ||
            case when p_extra is null then '' else '|' || p_extra::text end,
            'UTF8'
          ),
          'base64'
        ),
        E'\n', ''
      ),
      '+/', '-_'
    ),
    '='
  );
$$;

create or replace function private.api_decodificar_cursor(p_cursor text)
returns table (p_clave text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limpio text;
  v_bruto text;
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;

  -- Sin espacios ni saltos de línea (los cursores viejos de stock los traían).
  v_limpio := regexp_replace(p_cursor, '\s', '', 'g');

  -- Un cursor que no es base64 ni UTF-8 válido (por ejemplo `abc` o `____`) es un cursor inválido (400), no un error interno (500).
  begin
    v_bruto := convert_from(
      decode(rpad(translate(v_limpio, '-_', '+/'), (length(v_limpio) + 3) / 4 * 4, '='), 'base64'),
      'UTF8'
    );
  exception when others then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end;

  if position('|' in v_bruto) = 0 then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end if;

  p_clave := v_bruto;
  return next;
end;
$$;

revoke execute on function private.api_codificar_cursor(timestamptz, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.api_decodificar_cursor(text) from public, anon, authenticated;
