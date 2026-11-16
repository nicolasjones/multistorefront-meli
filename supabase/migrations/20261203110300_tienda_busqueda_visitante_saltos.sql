-- F-TDA-15 · devolución del Revisor (PR #339): visitante según los saltos de proxy y purga indexada.
--
-- Esquemas (Principio VII): sin tablas nuevas.
--   * índice limite_pedidos_publicos_ventana_idx -> sobre public.limite_pedidos_publicos (ya declarada en `public`).
--   * private.saltos_proxy_confiables / visitante_publico -> `private` (lógica interna, sin acceso de API).
-- Aditiva. Reversión:
--   drop index public.limite_pedidos_publicos_ventana_idx;
--   -- y restaurar private.visitante_publico(text) de 20261203110000 (último valor de x-forwarded-for);
--   drop function private.saltos_proxy_confiables();

-- Cantidad de proxies de confianza que agregan SU PROPIA IP al final de `x-forwarded-for` después de la del
-- cliente (p. ej. Traefik → Kong: si Kong agrega la IP de Traefik, vale 1). 0 = el último valor ya es el
-- cliente. Un solo lugar; se cambia con una migración nueva una vez confirmada la cadena real en DEV.
create or replace function private.saltos_proxy_confiables()
returns integer
language sql
immutable
set search_path = ''
as $$ select 0; $$;

comment on function private.saltos_proxy_confiables() is
  'F-TDA-15 (D3): proxies de confianza que agregan su IP al final de x-forwarded-for tras la del cliente. El visitante es el valor que está esa cantidad de lugares antes del último.';

revoke execute on function private.saltos_proxy_confiables() from public, anon, authenticated;

create or replace function private.visitante_publico(p_host text)
returns text
language sql
stable
set search_path = ''
as $$
  with cadena as (
    select regexp_split_to_array(
             trim((coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for')),
             '[[:space:]]*,[[:space:]]*') as ips
  )
  select encode(
           sha256(convert_to(
             coalesce(
               nullif(ips[greatest(1, coalesce(array_length(ips, 1), 0) - private.saltos_proxy_confiables())], ''),
               'desconocido')
             || '|' || coalesce(private.normalizar_host(p_host), ''),
             'UTF8')),
           'hex')
  from cadena;
$$;

comment on function private.visitante_publico(text) is
  'F-TDA-15 (D3): hash sha256 de la IP del cliente según x-forwarded-for y private.saltos_proxy_confiables() + host. Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_publico(text) from public, anon, authenticated;

-- La purga de registrar_pedido_publico filtra por `ventana` (la PK empieza por `visitante`).
create index if not exists limite_pedidos_publicos_ventana_idx
  on public.limite_pedidos_publicos (ventana);
