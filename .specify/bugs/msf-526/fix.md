# Fix: Importar y exportar proveedores (MSF-526, seguimiento de MSF-205)

- **Slug**: msf-526
- **Status**: parcial (MSF-663)
- **Importar**: ya existía vía el asistente de migración (`/migracion/importar/proveedores`, F-MIG-02); no se reescribe.
- **Exportar**: el listado suma «Exportar» para quien tiene la acción `exportar` en Proveedores. Lotes por `public.exportar_proveedores`
  (security definer, acotada a la organización, tope de 50000 filas, actividad `proveedores.exportados`) y archivo `.xlsx` armado en el cliente
  con el patrón de `exportarClientes`. Archivos: `apps/web/src/lib/exportarProveedores.ts`, `apps/web/src/components/proveedores/ExportarProveedores.tsx`,
  `supabase/migrations/20270507400000_proveedores_numero_y_exportar.sql`.
- **Tests**: vitest (`exportarProveedores.test.ts`, `ExportarProveedores.test.tsx`, `pages/proveedores/list.test.tsx`) y pgTAP `proveedores_numero_y_exportar.test.sql`.
- **No tocado**: el diálogo «Importar proveedores» del prototipo (con «Descargar plantilla CSV» e «Importar N proveedores»): la importación sigue siendo la del asistente de migración.
