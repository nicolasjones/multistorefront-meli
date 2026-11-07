-- F-SVC-02 (MSF-283, épica MSF-182): numeración correlativa de reparaciones por empresa.
-- Esquema: sin tablas nuevas (usa `dominio.reparaciones`; Principio VII).
--
-- El número sale del servidor bajo un bloqueo transaccional por empresa: altas simultáneas se
-- serializan, no hay repetidos ni saltos (si la transacción falla, el número no se consume
-- porque se deriva del máximo existente). Cada empresa tiene su propia serie (FR-012).
-- El formato `R-0001` es solo de presentación: se guarda el entero.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function private.codigo_reparacion(integer);
--   drop function private.siguiente_numero_reparacion(uuid);

create or replace function private.siguiente_numero_reparacion(p_empresa_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero integer;
begin
  -- Bloqueo por empresa que se libera al terminar la transacción.
  perform pg_advisory_xact_lock(hashtextextended('reparaciones:' || p_empresa_id::text, 0));
  select coalesce(max(r.numero), 0) + 1 into v_numero
    from dominio.reparaciones r
   where r.empresa_id = p_empresa_id;
  return v_numero;
end;
$$;

revoke execute on function private.siguiente_numero_reparacion(uuid) from public, anon, authenticated;

comment on function private.siguiente_numero_reparacion(uuid) is
  'F-SVC-02: próximo número correlativo de reparación de la empresa, bajo bloqueo transaccional.';

create or replace function private.codigo_reparacion(p_numero integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'R-' || lpad(p_numero::text, 4, '0');
$$;

revoke execute on function private.codigo_reparacion(integer) from public, anon, authenticated;
