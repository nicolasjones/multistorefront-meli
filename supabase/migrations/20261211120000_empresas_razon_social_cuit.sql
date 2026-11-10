-- F-VTA-19 (MSF-230, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-008): razón social y CUIT
-- de la empresa, que salen impresos en la factura interna y el remito.
--
-- Esquema (Principio VII): `dominio.empresas` es dominio del producto (quién vende) → `dominio`, ya vive ahí.
-- Se altera solo de forma aditiva: dos columnas nulables. RLS vigente (select por organización; update solo
-- con `private.puede_escribir()`); `anon` sin acceso. Las columnas nuevas se suman al `grant update` por
-- columna de 20261013120000 para que la ficha de la empresa pueda editarlas.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos si ya se cargaron):
--   revoke update (razon_social, cuit) on dominio.empresas from authenticated;
--   alter table dominio.empresas
--     drop constraint empresas_razon_social_ck, drop constraint empresas_cuit_ck,
--     drop column razon_social, drop column cuit;

alter table dominio.empresas
  add column if not exists razon_social text,
  add column if not exists cuit text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'empresas_razon_social_ck' and conrelid = 'dominio.empresas'::regclass
  ) then
    alter table dominio.empresas
      add constraint empresas_razon_social_ck
      check (razon_social is null or (btrim(razon_social) <> '' and length(razon_social) <= 200));
  end if;
  -- CUIT: 11 dígitos, sin guiones (la ficha los quita al guardar).
  if not exists (
    select 1 from pg_constraint
    where conname = 'empresas_cuit_ck' and conrelid = 'dominio.empresas'::regclass
  ) then
    alter table dominio.empresas
      add constraint empresas_cuit_ck
      check (cuit is null or cuit ~ '^[0-9]{11}$');
  end if;
end
$$;

comment on column dominio.empresas.razon_social is
  'Razón social que se imprime en los documentos de venta (F-VTA-19). Opcional: lo no cargado se omite.';
comment on column dominio.empresas.cuit is
  'CUIT de la empresa, 11 dígitos sin guiones (F-VTA-19). Opcional: lo no cargado se omite.';

grant update (razon_social, cuit) on dominio.empresas to authenticated;
