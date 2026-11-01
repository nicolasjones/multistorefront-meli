# Test MSF-645

- `vitest run src/pages/ventas/comprobante.cobros.test.tsx`: 63/63 verde (local).
- `calidad` con `COMMITLINT_FROM=5dfc6286 COMMITLINT_TO=HEAD`: commitlint ok.
- pgTAP `service_cobro.test.sql`: no ejecutable localmente (sin acceso a Docker); lo valida el job `database` del PR.
