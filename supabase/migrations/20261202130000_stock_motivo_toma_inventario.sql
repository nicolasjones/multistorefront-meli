-- F-STK-11 (MSF-415, épica MSF-131, spec 20261024-120000-stock-lotes-e-inventario, FR-104):
-- motivo de sistema «Toma de inventario» (aplica a `ajuste`) para los ajustes de la toma.
-- Esquema (Principio VII): sin tablas nuevas; es un dato de `dominio.motivos_movimiento`
-- (dominio del producto), sembrado por organización igual que los demás motivos iniciales.
--
-- 1. `private.sembrar_motivos_movimiento` gana el motivo (organizaciones nuevas, vía el trigger
--    existente). Parte de la versión vigente (20261021180000_ingresos_mercaderia_tablas.sql) y conserva
--    sus seis motivos, incluido «Anulación de ingreso de mercadería» (F-PRV-04).
-- 2. Relleno de las organizaciones existentes (idempotente: `on conflict do nothing`).
--
-- Migración aditiva. Reversión (migración posterior):
--   restaurar `private.sembrar_motivos_movimiento` de 20261021180000_ingresos_mercaderia_tablas.sql
--   (la versión anterior a esta, con seis motivos);
--   delete from dominio.motivos_movimiento m where lower(btrim(m.nombre)) = 'toma de inventario'
--     and not exists (select 1 from dominio.movimientos_stock s where s.motivo_id = m.id);
--   (si ya hay ajustes con ese motivo, el libro es de solo agregado: se desactiva desde Motivos).

create or replace function private.sembrar_motivos_movimiento(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values
    (p_organizacion_id, 'Compra a proveedor', '{entrada}'),
    (p_organizacion_id, 'Venta en local', '{salida}'),
    (p_organizacion_id, 'Conteo de inventario', '{ajuste}'),
    (p_organizacion_id, 'Devolución', '{entrada,salida}'),
    (p_organizacion_id, 'Rotura o pérdida', '{salida,ajuste}'),
    (p_organizacion_id, 'Anulación de ingreso de mercadería', '{salida}'),
    (p_organizacion_id, 'Toma de inventario', '{ajuste}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
$$;

revoke execute on function private.sembrar_motivos_movimiento(uuid) from public, anon, authenticated;

select private.sembrar_motivos_movimiento(o.id) from public.organizaciones o;
