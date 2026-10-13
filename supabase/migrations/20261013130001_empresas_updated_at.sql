-- Empresas (F-EMP-04, MSF-323): `updated_at` se mantiene sola en cada update,
-- para que pausar/reactivar deje la marca de cuándo cambió el estado.
-- Migración aditiva. Reversión: drop trigger empresas_updated_at on dominio.empresas;
--   drop function private.tocar_updated_at();
create or replace function private.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger empresas_updated_at
  before update on dominio.empresas
  for each row execute function private.tocar_updated_at();
