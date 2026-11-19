---
owner: tecnico
sources:
  - .github/workflows/validate.yml
  - infra/runner/compose.yaml
---

# CI self-hosted y almacenamiento

Los jobs principales usan runners self-hosted por defecto. Para los jobs pesados, la variable de
repo `CI_RUNS_ON_PESADO` puede mandarlos a runners hosted (`.github/workflows/validate.yml`, `runs-on: ${{ fromJSON(vars.CI_RUNS_ON_PESADO || …) }}`;
ver `docs/control-ci.md`). Por eso los jobs de `validate.yml` que instalan dependencias (`chequeos`, `application`, `e2e-visible-sesion`, `web`, `e2e-tienda` y `database`) **sí** configuran `cache: pnpm` en `actions/setup-node`: en un runner hosted cada job parte de una
VM limpia y la caché evita reinstalar todo. En un runner self-hosted el store persistente de abajo es el que evita
la descarga.

En el runner self-hosted, todas las réplicas del runner usan un store de pnpm persistente
en un volumen Docker local (`platform-runner-pnpm-store` por defecto),
compartible con los runners de otros productos de la misma máquina. Una
dependencia se descarga una vez por máquina y sobrevive a la recreación de
los contenedores. Operación, seguridad del acceso concurrente y limpieza:
`docs/deployment.md` (sección "Réplicas, memoria, red y store de pnpm del
runner").
