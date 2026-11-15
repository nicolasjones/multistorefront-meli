-- MSF-467 · Opiniones de productos, Fase 1 «Base» (T002). RF-OPI-5, D9, D12(c), CA-OPI-6.
--
-- Esquemas (Principio VII): tres funciones internas de plataforma -> `private`, sin `execute` para la API; las llaman las RPC
-- `security definer` de las fases siguientes y el panel. Son `invoker` a propósito (puras: no leen tablas ni necesitan privilegios
-- del dueño; `security definer` solo ampliaría la superficie). Sin tablas nuevas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function if exists private.validar_texto_opinion(integer, text);
--   drop function if exists private.texto_opinion_no_permitido(text);
--   drop function if exists private.nombre_publico_cliente(text);

-- Texto con contenido no permitido: caracteres de control (incluye saltos de línea), separadores de línea/párrafo, marcas de
-- dirección y de ancho cero, y enlaces. Antes de evaluar, los puntos de otras escrituras (U+3002 «。», U+FF0E «．», U+FF61 «｡»,
-- U+2024 «․», U+FE52 «﹒») se normalizan al punto ASCII. Reglas de enlace (HEURÍSTICA, ver «Limitaciones conocidas» de la spec):
--   * `http:` / `https:` / `ftp:` (con espacios opcionales antes de los dos puntos) y `www.`. La palabra `http`/`https` SOLA,
--     sin dos puntos, se ACEPTA a propósito: rechazarla daría falsos positivos («usan https para pagar»).
--   * dominio con TLD de LISTA CERRADA, alfanumérico o guion pegado al punto y TLD pegado al punto, seguido de un no alfanumérico
--     o el final: genéricos (com, net, org, shop, online, top…) y de país/acortadores que no son palabras comunes en castellano
--     (ar, mx, cl, uy, br, co, pe, py, bo, ec, us, uk, fr, ly, tv, cc, ws, gl, gg, be, ee, fm, gd, gy, sh, vc, ph, pt, ru, cn,
--     jp, au, nz, ca, nl, ch, pl, tr). Cubre bit.ly, youtu.be, ejemplo.com.ar, x.mx, ejemplo.cl/ofertas.
--   * TLD que son palabras muy comunes (es, me, de, to, it, at, in, se, ve): solo si NO los sigue un espacio (puntuación o fin
--     de texto) y la parte previa tiene forma de dominio (4 o más alfanuméricos/guiones seguidos, o termina en guion o dígito):
--     «mi-tienda.es» y «mitienda.es.» se rechazan; «bueno.me gustó» y «diario.es genial» se aceptan.
--   * `algo.palabra/…`: cualquier TLD seguido de barra (t.me/…, wa.me/…).
--   Un punto con espacio detrás («producto. Top calidad», «el 10. Es ok.») nunca es enlace, y las palabras de dos letras que no
--   están en la lista (no, si, mi, te, la, el, ya, lo, le, en, un, al, su) tampoco: «Anda bien.No se calienta» pasa. Sin
--   cuantificadores anidados: costo lineal (medido con 50.000 a 200.000 caracteres hostiles: milisegundos). NO detecta
--   ofuscación («ejemplo punto com», «ejemplo(.)com», «ejemplo[.]com»), homógrafos cirílicos ni enlaces con espacios dentro.
--   Es `invoker` (no `security definer`) a propósito: es pura, no lee tablas ni usa privilegios del dueño; `search_path` vacío y
--   sin `execute` para la API. La reutilizan el comentario y el motivo de rechazo.
create or replace function private.texto_opinion_no_permitido(p_texto text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select t.x ~ '[[:cntrl:]]'
      or t.x ~ '[  ​-‏‪-‮⁠-⁩﻿]'
      or t.x ~* '(https?|ftp)[[:space:]]*:|www[[:space:]]*\.'
      or t.x ~* '[[:alnum:]-]\.(com|net|org|info|biz|edu|gov|mil|int|name|pro|app|dev|shop|store|site|online|link|xyz|top|club|ink|page|tech|live|cloud|blog|news|mobi|agency|website|space|fun|vip|icu|work|win|bid|click|stream|ar|mx|cl|uy|br|co|pe|py|bo|ec|us|uk|fr|ly|tv|cc|ws|gl|gg|be|ee|fm|gd|gy|sh|vc|ph|pt|ru|cn|jp|au|nz|ca|nl|ch|pl|tr)([^[:alnum:]]|$)'
      or t.x ~* '([[:alnum:]-]{4}|[-[:digit:]])\.(es|me|de|to|it|at|in|se|ve)([^[:alnum:][:space:]]|$)'
      or t.x ~* '[[:alnum:]-]\.[[:alpha:]]{2,}/'
  from (select translate(p_texto, '。．｡․﹒', '.....') as x) t;
$$;

comment on function private.texto_opinion_no_permitido(text) is
  'MSF-467: true si el texto trae control, marcas de dirección/ancho cero o un enlace (heurística: dominio con TLD de lista cerrada, acortadores, http: y www., puntos de otras escrituras normalizados; no detecta ofuscación). Pura, invoker. Compartida por el comentario y el motivo de rechazo.';

-- Valida puntuación y comentario. Devuelve {ok, campos:[...], comentario: <recortado>}; `campos` lista lo erróneo
-- ("puntuacion" y/o "comentario"). El comentario se recorta (btrim) y se mide en caracteres de Postgres (1 a 1.000 tras el
-- recorte: mínimo 10) y no admite lo que rechaza `private.texto_opinion_no_permitido`.
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
     or private.texto_opinion_no_permitido(v_texto)
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

revoke execute on function private.texto_opinion_no_permitido(text) from public, anon, authenticated;
revoke execute on function private.validar_texto_opinion(integer, text) from public, anon, authenticated;
revoke execute on function private.nombre_publico_cliente(text) from public, anon, authenticated;
