-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T002). RF-OPI-5, D9, D12(c), CA-OPI-6.
--
-- Esquemas (Principio VII): dos funciones internas de plataforma -> `private`, sin `execute` para la API; las llaman las RPC
-- `security definer` de las fases siguientes y el panel. Sin tablas nuevas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function if exists private.validar_texto_opinion(integer, text);
--   drop function if exists private.nombre_publico_cliente(text);

-- Valida puntuación y comentario. Devuelve {ok, campos:[...], comentario: <recortado>}; `campos` lista lo erróneo
-- ("puntuacion" y/o "comentario"). El comentario se recorta (btrim) y se mide en caracteres de Postgres (1 a 1.000 tras el
-- recorte: mínimo 10). Rechaza caracteres de control (incluye saltos de línea), separadores de línea/párrafo, marcas de
-- dirección y de ancho cero, y enlaces: http(s)://, ftp://, www. y dominios sueltos (algo.com, algo.com.ar, etc.).
create or replace function private.validar_texto_opinion(p_puntuacion integer, p_comentario text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_campos text[] := '{}';
  v_texto text := btrim(coalesce(p_comentario, ''));
begin
  if p_puntuacion is null or p_puntuacion < 1 or p_puntuacion > 5 then
    v_campos := array_append(v_campos, 'puntuacion'::text);
  end if;
  if char_length(v_texto) < 10
     or char_length(v_texto) > 1000
     or v_texto ~ '[[:cntrl:]]'
     or v_texto ~ '[  ​-‏‪-‮⁠-⁩﻿]'
     or v_texto ~* '(https?|ftp)[[:space:]]*:|www[[:space:]]*\.'
     or v_texto ~* '[[:alnum:]-]+[[:space:]]*\.[[:space:]]*(com|net|org|info|biz|edu|gov|io|ly|tv|app|dev|shop|store|site|online|link|xyz|top|club|ink|page|cc|ws|gl|gg)([^[:alnum:]]|$)'
  then
    v_campos := array_append(v_campos, 'comentario'::text);
  end if;
  return jsonb_build_object('ok', cardinality(v_campos) = 0, 'campos', to_jsonb(v_campos), 'comentario', v_texto);
end;
$$;

comment on function private.validar_texto_opinion(integer, text) is
  'MSF-467 (RF-OPI-5): valida puntuación 1-5 y comentario 10-1000 sin control, marcas de dirección ni enlaces. Devuelve {ok, campos, comentario recortado}.';

-- Nombre público del cliente: primera palabra de su nombre, hasta 30 caracteres; «Cliente» si queda vacío (D9).
create or replace function private.nombre_publico_cliente(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(split_part(btrim(regexp_replace(coalesce(p_nombre, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), ' ', 1), 30), ''),
    'Cliente'
  );
$$;

comment on function private.nombre_publico_cliente(text) is
  'MSF-467 (D9): solo el nombre de pila (primera palabra, hasta 30 caracteres) es público; «Cliente» si queda vacío.';

revoke execute on function private.validar_texto_opinion(integer, text) from public, anon, authenticated;
revoke execute on function private.nombre_publico_cliente(text) from public, anon, authenticated;
