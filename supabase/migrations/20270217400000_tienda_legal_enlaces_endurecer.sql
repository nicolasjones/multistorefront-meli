-- MSF-149 (hallazgo 3 de la revisión independiente): endurece `dominio.tienda_legal_enlaces` sin tocar la migración
-- 20270212100001 (ya aplicada).
--   * La URL no puede llevar credenciales (`https://usuario@host`, `https://usuario:clave@host`): la autoridad
--     (lo que va entre `https://` y el primer `/`, `?` o `#`) no admite `@`. Un `@` posterior (ruta, query)
--     sigue siendo válido.
--   * Tope DEFENSIVO de 10 enlaces por empresa (no es una regla de negocio: evita que una carga errónea o
--     abusiva infle el pie legal y la respuesta anónima de `publico.legal_por_dominio`). Se cambia con una
--     migración nueva si el cliente necesita más.
--
-- Esquemas (Principio VII): sin tablas nuevas; la función de trigger va en `private` (soporte de `dominio`).
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger if exists tienda_legal_enlaces_tope on dominio.tienda_legal_enlaces;
--   drop function if exists private.limitar_tienda_legal_enlaces();
--   alter table dominio.tienda_legal_enlaces drop constraint if exists tienda_legal_enlaces_url_sin_credenciales_ck;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tienda_legal_enlaces_url_sin_credenciales_ck'
       and conrelid = 'dominio.tienda_legal_enlaces'::regclass
  ) then
    -- `not valid`: las filas existentes no frenan la migración; se intenta validar enseguida.
    alter table dominio.tienda_legal_enlaces
      add constraint tienda_legal_enlaces_url_sin_credenciales_ck
      check (substring(url from '^https://([^/?#]*)') !~ '@') not valid;
  end if;
  begin
    alter table dominio.tienda_legal_enlaces validate constraint tienda_legal_enlaces_url_sin_credenciales_ck;
  exception when check_violation then
    raise notice 'tienda_legal_enlaces: hay URLs con credenciales previas; la restricción rige solo para filas nuevas. Corregirlas a mano.';
  end;
end
$$;

create or replace function private.limitar_tienda_legal_enlaces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 10;
begin
  -- Serializa las altas de la misma empresa: dos inserciones simultáneas no se pasan del tope.
  perform pg_advisory_xact_lock(hashtextextended('tienda_legal_enlaces:' || new.empresa_id::text, 0));
  if (select count(*) from dominio.tienda_legal_enlaces l
       where l.empresa_id = new.empresa_id and l.id is distinct from new.id) >= c_tope then
    raise exception 'Una empresa admite hasta % enlaces legales.', c_tope using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.limitar_tienda_legal_enlaces() from public, anon, authenticated;

comment on function private.limitar_tienda_legal_enlaces() is
  'MSF-149: tope defensivo de 10 enlaces legales por empresa (no es regla de negocio). Falla con 23514.';

drop trigger if exists tienda_legal_enlaces_tope on dominio.tienda_legal_enlaces;
create trigger tienda_legal_enlaces_tope
  before insert or update of empresa_id on dominio.tienda_legal_enlaces
  for each row execute function private.limitar_tienda_legal_enlaces();
