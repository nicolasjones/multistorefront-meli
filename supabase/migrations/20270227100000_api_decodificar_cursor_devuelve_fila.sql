-- F-API-01 (MSF-233): la paginación de la API ignoraba el cursor.
--
-- `private.api_decodificar_cursor` es `returns table` pero asignaba `p_clave` sin `return next`: no devolvía ninguna
-- fila, `private.api_leer_*` leía `v_clave = null` y servía SIEMPRE la primera página (con `siguiente_cursor` apuntando
-- a la misma). Detectado probando la API en dev: 4 páginas de 3 filas daban 3 filas únicas.
--
-- Rollback: volver a la definición de 20270224110203_api_lectura.sql (que tiene el defecto).
create or replace function private.api_decodificar_cursor(p_cursor text)
returns table (p_clave text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bruto text;
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;

  -- Un cursor que no es base64 ni UTF-8 válido (por ejemplo `abc` o `____`) es un cursor inválido (400), no un error interno (500).
  begin
    v_bruto := convert_from(
      decode(rpad(translate(p_cursor, '-_', '+/'), (length(p_cursor) + 3) / 4 * 4, '='), 'base64'),
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

revoke execute on function private.api_decodificar_cursor(text) from public, anon, authenticated;
