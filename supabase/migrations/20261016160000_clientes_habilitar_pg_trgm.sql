-- MSF-502 (T019, SC-002): habilita pg_trgm y garantiza el índice de búsqueda parcial de clientes.
-- Esquema: sin tablas nuevas; solo extensión + índice sobre `public.clientes` (Principio VII: ya declarada).
-- La migración 20261016130000 creaba el índice solo si pg_trgm ya estaba instalada y en CI no lo estaba.
-- Aditiva. Reversión (en una migración posterior, no en el mismo PR):
--   drop index if exists public.clientes_busqueda_trgm_idx;
--   drop extension if exists pg_trgm;
create extension if not exists pg_trgm with schema extensions;

do $$
declare
  v_esquema text;
begin
  select n.nspname into v_esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_esquema is not null
     and to_regclass('public.clientes_busqueda_trgm_idx') is null then
    execute format(
      'create index clientes_busqueda_trgm_idx on public.clientes using gin '
      '((lower(coalesce(nombre, '''') || '' '' || coalesce(documento, '''') || '' '' || coalesce(correo, '''') || '' '' '
      '|| coalesce(telefono, '''') || '' '' || coalesce(celular, '''') || '' '' || coalesce(localidad, '''') || '' '' '
      '|| numero::text)) %I.gin_trgm_ops)',
      v_esquema
    );
  end if;
  -- Falla en voz alta: el salto silencioso (CI sin pg_trgm) fue el bug original.
  if to_regclass('public.clientes_busqueda_trgm_idx') is null then
    raise exception 'clientes_busqueda_trgm_idx no quedó creado: falta pg_trgm (SC-002)';
  end if;
end;
$$;
