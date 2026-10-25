# Verificación: «Compra para» en el proveedor (MSF-524)

| Qué | Resultado |
|---|---|
| Vitest (`useListarProveedores`, `useEmpresasDeProveedor`, `pages/proveedores`, `components/proveedores`) | 64 pasan (6 archivos) |
| `pnpm lint` | 0 errores (solo warnings del mismo patrón que los hooks hermanos) |
| `pnpm build` | OK |
| `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check` | OK |
| pgTAP `supabase/tests/database/proveedores_empresas.test.sql` (19 aserciones) | **No se pudo correr localmente** (sin acceso al daemon Docker); queda para el CI |

Cobertura nueva: RLS/aislamiento por organización, rechazo de tienda/proveedor ajenos (RPC y disparador), reemplazo
atómico y normalización, `anon` sin ejecución, filtro por tienda y `empresas` en el listado, diálogo (alta, edición,
sin tocar, fallo parcial sin duplicar, error de carga), listado (chips y filtro) y ficha.
