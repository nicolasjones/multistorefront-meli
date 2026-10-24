-- F-TDA-15 (MSF-413, épica MSF-191, spec 20261024-120000-tienda-inicio-busqueda-movil): base de la
-- búsqueda pública de productos. FR-020, FR-022.
--
-- Esquemas (Principio VII, re-verificado):
--   * public.limite_pedidos_publicos        -> `public` (control de abuso transversal, no es dominio del
--                                              producto). RLS activada, sin políticas y sin privilegios para
--                                              anon/authenticated: solo la tocan funciones SECURITY DEFINER.
--   * índice productos_nombre_busqueda_trgm -> sobre `dominio.productos` (tabla de dominio).
--   * private.normalizar_busqueda / registrar_pedido_publico / visitante_publico / constantes -> `private`
--                                              (funciones internas, sin acceso de roles de API).
--
-- Migración aditiva. Reversión (migración posterior, no en este PR):
--   drop function private.registrar_pedido_publico(text, integer);
--   drop function private.visitante_publico(text);
--   drop function private.limite_busquedas_por_minuto();
--   drop function private.umbral_similitud_busqueda();
--   drop table public.limite_pedidos_publicos;
--   drop index dominio.productos_nombre_busqueda_trgm;
--   drop function private.normalizar_busqueda(text);
--   (la extensión `unaccent` se conserva: es inocua y otras funciones podrían usarla)
-- Lock: `create index` no es concurrente (bloquea escrituras en productos mientras se arma).

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'unaccent') then
    raise exception 'Falta unaccent: la búsqueda de la tienda no puede ignorar tildes (FR-020)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'Falta pg_trgm: la búsqueda de la tienda no puede tolerar errores de tipeo (FR-020)';
  end if;
end;
$$;

-- ============================================================================
-- FR-020 · normalización e índice
-- ============================================================================

-- minúsculas + sin tildes + espacios colapsados. `unaccent(text)` es `stable`; con el diccionario
-- explícito el resultado no depende de la sesión y la función puede declararse `immutable` (necesario
-- para el índice).
create or replace function private.normalizar_busqueda(texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(
           btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(texto, '')))),
           '\s+', ' ', 'g');
$$;

comment on function private.normalizar_busqueda(text) is
  'F-TDA-15: texto en minúsculas, sin tildes y con los espacios colapsados. Base de la búsqueda de la tienda pública. Sin acceso para anon/authenticated.';

revoke execute on function private.normalizar_busqueda(text) from public, anon, authenticated;

create index if not exists productos_nombre_busqueda_trgm
  on dominio.productos using gin (private.normalizar_busqueda(nombre) extensions.gin_trgm_ops);

-- Constantes únicas de la búsqueda (D1): se cambian en un solo lugar.
create or replace function private.limite_busquedas_por_minuto()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30; $$;

create or replace function private.umbral_similitud_busqueda()
returns real
language sql
immutable
set search_path = ''
as $$ select 0.4::real; $$;

comment on function private.limite_busquedas_por_minuto() is
  'F-TDA-15 (D1): pedidos de búsqueda por visitante y por minuto. Supuesto 30; Nicolás fija el número definitivo.';
comment on function private.umbral_similitud_busqueda() is
  'F-TDA-15: umbral de similitud pg_trgm (word_similarity) para tolerar errores de tipeo.';

revoke execute on function private.limite_busquedas_por_minuto() from public, anon, authenticated;
revoke execute on function private.umbral_similitud_busqueda() from public, anon, authenticated;

-- ============================================================================
-- FR-022 · límite de pedidos por visitante y minuto
-- ============================================================================

create table if not exists public.limite_pedidos_publicos (
  visitante text not null,
  ventana timestamptz not null,
  pedidos integer not null default 0,
  primary key (visitante, ventana)
);

comment on table public.limite_pedidos_publicos is
  'F-TDA-15: contador de pedidos de búsqueda de la tienda pública por visitante (hash, nunca la IP) y minuto. RLS activada, sin políticas ni privilegios para roles de API: solo la usa private.registrar_pedido_publico.';

alter table public.limite_pedidos_publicos enable row level security;
revoke all on public.limite_pedidos_publicos from public, anon, authenticated;

-- Visitante = hash (sha256) del último valor de `x-forwarded-for` (el que agrega el proxy más cercano; los
-- anteriores los puede inventar el cliente) + el host. Sin cabecera, todos caen en el grupo «desconocido»
-- (D3). Nunca se guarda la IP.
create or replace function private.visitante_publico(p_host text)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(
           sha256(convert_to(
             coalesce(
               substring(
                 (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for')
                 from '([^,[:space:]]+)[[:space:]]*$'),
               'desconocido')
             || '|' || coalesce(private.normalizar_host(p_host), ''),
             'UTF8')),
           'hex');
$$;

comment on function private.visitante_publico(text) is
  'F-TDA-15 (D3): hash sha256 de la IP del proxy (x-forwarded-for) + host. Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_publico(text) from public, anon, authenticated;

-- Cuenta el pedido en el minuto en curso (atómico: insert … on conflict) y purga las ventanas de más de
-- 10 minutos. Supera el límite cuando llega el pedido número `limite + 1` del minuto.
create or replace function private.registrar_pedido_publico(visitante text, limite integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_ahora timestamptz := now();
  v_ventana timestamptz := date_trunc('minute', v_ahora);
  v_pedidos integer;
begin
  delete from public.limite_pedidos_publicos l where l.ventana < v_ahora - interval '10 minutes';

  insert into public.limite_pedidos_publicos as l (visitante, ventana, pedidos)
  values (visitante, v_ventana, 1)
  on conflict (visitante, ventana) do update set pedidos = l.pedidos + 1
  returning l.pedidos into v_pedidos;

  if v_pedidos > limite then
    return jsonb_build_object(
      'limitado', true,
      'espera_segundos', greatest(1, ceil(extract(epoch from (v_ventana + interval '1 minute' - v_ahora)))::integer));
  end if;
  return jsonb_build_object('limitado', false, 'espera_segundos', 0);
end;
$$;

comment on function private.registrar_pedido_publico(text, integer) is
  'F-TDA-15: cuenta un pedido de búsqueda del visitante en el minuto en curso y devuelve {limitado, espera_segundos}. Atómica; purga ventanas de más de 10 minutos. Sin acceso para anon/authenticated.';

revoke execute on function private.registrar_pedido_publico(text, integer) from public, anon, authenticated;
