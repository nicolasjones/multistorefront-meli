# Fix: MSF-751

- `apps/web/src/pages/ventas-reportes/rankingClientes.contrato.test.ts`: lee `20270201200118_lectura_ranking_excel.sql` (nombre vigente tras la renumeración de MSF-274, commit `c84607b2`) en vez de `20270116110500_…`, que ya no existe.
- `specs/20270104-100000-ventas-reportes-basicos/plan.md`: misma referencia corregida (desfase documental).
