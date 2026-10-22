# Fix: «Compra para» en el proveedor (MSF-524)

- **Slug**: msf-524 · **Origen**: seguimiento T029/FR-020 de MSF-205 (spec `proveedores-y-productos`).
- **Decisión** (las preguntas abiertas del assessment): «Compra para» es **informativo** (no restringe ingresos);
  el alta parte **sin tiendas marcadas**; el filtro por tienda del listado **entra**.

## Cambios
- `supabase/migrations/20261019120000_proveedores_empresas.sql` (aditiva, reversión en el encabezado):
  `dominio.proveedores_empresas` (esquema `dominio`, RLS select por organización/sección, sin grants de escritura,
  disparador de pertenencia), RPC `public.guardar_empresas_de_proveedor` (security definer, `revoke … public, anon`,
  `grant … authenticated`) y `listar_proveedores` con `empresas` + `p_empresa_id` (drop/create por el tipo de retorno).
- `apps/web`: hook `useEmpresasDeProveedor` (+`guardarEmpresasDeProveedor`), chips «Compra para» en
  `ProveedorFormDialog`, columna + filtro «Tienda» en `list.tsx`, dato en `show.tsx`, `useListarProveedores` con `empresaId`.
- Docs: `docs/proveedores.md` (§ «Compra para»), matriz de la spec (de «fuera de alcance» a entregado).

## Riesgos
- Se guarda el proveedor y luego las tiendas (dos llamadas): si la segunda falla, el aviso lo dice y el reintento no duplica.
- El `inventory.json` del prototipo no cambia (el prototipo no se tocó).
