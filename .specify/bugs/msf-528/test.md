# Bug Test: MSF-528

- Vitest `ProductosDelProveedor.test.tsx`: columna Costo con formato y `—` con Rentabilidad; sin ella no hay columna ni valor. Resultado: 20/20 en `src/components/proveedores` OK.
- pgTAP `proveedores_productos.test.sql` (plan 38): costo con Rentabilidad, null sin costo cargado, null sin Rentabilidad; anon sigue sin ejecutar. **No corrido localmente** (sin acceso a Docker): queda al CI.
- `pnpm lint` (solo warnings previos), `pnpm build`, `docs:check`, `matriz:check`, `prototipo:check`: OK.
