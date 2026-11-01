# Test MSF-645

- `vitest run src/pages/ventas/comprobante.cobros.test.tsx`: 63/63 verde (local).
- `vitest run src/pages/service-tecnico/reparacion.comprobante.test.tsx`: 8/8 verde (local) y 8/8 verde con 12 procesos de carga de CPU, que es el escenario que reproducía el rojo del CI (antes del fix: 3 tests en rojo con «Unable to find role="button"» y «Unable to find role="region"»).
- `calidad` con `COMMITLINT_FROM=5dfc6286 COMMITLINT_TO=HEAD`: commitlint ok.
- pgTAP `service_cobro.test.sql`: no ejecutable localmente (sin acceso a Docker); lo valida el job `database` del PR.
