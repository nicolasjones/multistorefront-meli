# Fix — MSF-656

- Migración `supabase/migrations/20270122100000_rls_empresas_rma_comprobantes.sql`: reemplaza las políticas SELECT de `dominio.comprobantes_venta`, `comprobantes_venta_lineas`, `rma` y `rma_items` agregando `empresa_id in (select private.empresas_accesibles())`; las hijas heredan la empresa del padre (`exists`). Comprobantes con `empresa_id` nulo (heredados) siguen visibles.
- Decisión de alcance: se incluye `comprobantes_venta` (misma causa; MSF-632). Esquema `dominio`, sin cambios de tabla.
- Reversión: recrear las políticas originales (documentadas en la migración). Aditiva.
- Docs: `docs/ventas-rma-devoluciones.md`, `docs/ventas-comprobantes.md`.
