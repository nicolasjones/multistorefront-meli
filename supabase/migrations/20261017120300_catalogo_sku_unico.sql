-- F-CAT-03 (MSF-459, épica MSF-456): SKU único por organización y autogenerado.
-- Esquema (Principio VII): sin tablas nuevas; se altera `dominio.productos`
-- (entidad del negocio → `dominio`) con un índice y un disparador.
--
-- Reglas (FR-007, FR-019), garantizadas por la base y no solo por la pantalla:
--   * El SKU se recorta; único por organización sin distinguir mayúsculas.
--   * Si llega vacío (alta o edición) se genera `PRD-` + 8 hexadecimales en
--     mayúsculas, distinto dentro de la organización; uno cargado a mano se respeta.
--   * Dos altas simultáneas con el mismo SKU: una gana y la otra recibe 23505.
--
-- ANTES de aplicar en un entorno con datos, buscar duplicados que impedirían
-- crear el índice (deben resolverse a mano; esta migración no los pisa):
--   select organizacion_id, lower(btrim(sku)), count(*)
--     from dominio.productos where nullif(btrim(sku), '') is not null
--    group by 1, 2 having count(*) > 1;
--
-- Migración aditiva (un índice, una función y un disparador; el relleno solo
-- completa los SKU vacíos nacidos en F-CAT-02). Reversión (migración posterior):
--   drop trigger productos_sku on dominio.productos;
--   drop function private.asegurar_sku_producto();
--   drop index dominio.productos_org_sku_uidx;
-- (los SKU ya generados quedan como datos válidos).

create or replace function private.asegurar_sku_producto()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_intento int := 0;
begin
  new.sku := nullif(btrim(new.sku), '');
  if new.sku is not null then
    return new;
  end if;
  -- El índice único es la garantía final; el reintento evita casi siempre el 23505
  -- espurio del autogenerado (1 en 4 mil millones por intento).
  loop
    new.sku := 'PRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from dominio.productos p
       where p.organizacion_id = new.organizacion_id
         and lower(btrim(p.sku)) = lower(new.sku)
         and p.id <> new.id
    );
    v_intento := v_intento + 1;
    if v_intento >= 10 then
      raise exception 'No se pudo generar un SKU único' using errcode = '23505';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function private.asegurar_sku_producto() from public, anon, authenticated;

-- Relleno de los SKU vacíos de F-CAT-02 (sin el disparador activo aún, se arma a mano
-- con el mismo formato; el disparador y el índice se crean después).
update dominio.productos
   set sku = 'PRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
 where nullif(btrim(sku), '') is null;

create unique index productos_org_sku_uidx
  on dominio.productos (organizacion_id, lower(btrim(sku)));

-- Se llama «productos_sku» para correr después de `productos_normalizar` (orden
-- alfabético); además recorta por su cuenta y no depende de ese orden.
create trigger productos_sku
  before insert or update on dominio.productos
  for each row execute function private.asegurar_sku_producto();

comment on index dominio.productos_org_sku_uidx is
  'F-CAT-03: SKU único por organización sin distinguir mayúsculas ni espacios extremos.';
