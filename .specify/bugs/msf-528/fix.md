# Bug Fix: MSF-528 — Costo en la ficha del proveedor

- **Slug**: msf-528
- **Applied**: 2026-10-19

## Cambios
- `supabase/migrations/20261019120000_productos_de_proveedor_costo.sql`: `productos_de_proveedor` suma `moneda` y `costo` (left join a `dominio.producto_costos`; `null` sin Rentabilidad). Drop + create por cambio de `returns table`; `revoke ... from public, anon` + `grant ... to authenticated`. Reversión documentada en la migración.
- `useProductosDeProveedor.ts`: tipo con `moneda` y `costo` (número o null).
- `ProductosDelProveedor.tsx`: columna `Costo` (alineada a la derecha, `USD 1.234,50`, `—` si null) solo con Rentabilidad en lectura/edición.
- `docs/proveedores.md` y matriz de `spec.md` (Costo pasa a «En alcance», seguimiento MSF-528).

## Fuera de alcance (sin inventar datos)
- **Último ingreso**, subtítulo y tarjeta «Últimos ingresos de mercadería»: dependen de MSF-219 (no existe tabla de ingresos). Siguen fuera de alcance; se agregarán a la misma RPC con ese ingreso. Seguimiento propio: pendiente de crear en Jira (Tarea `seguimiento`) por quien opera Jira.

## Supuesto
- La moneda del costo es la del producto (`producto_costos` no tiene moneda propia).
