---
owner: tecnico
sources:
  - specs
---

# CI self-hosted y almacenamiento

Los jobs principales usan runners self-hosted. No se configura `cache: pnpm`
en `actions/setup-node`: las cachés de dependencias se almacenan en GitHub
aunque el job se ejecute en infraestructura propia.

En su lugar, todas las réplicas del runner usan un store de pnpm persistente
en un volumen Docker local (`platform-runner-pnpm-store` por defecto),
compartible con los runners de otros productos de la misma máquina. Una
dependencia se descarga una vez por máquina y sobrevive a la recreación de
los contenedores. Operación, seguridad del acceso concurrente y limpieza:
`docs/deployment.md` (sección "Réplicas, memoria, red y store de pnpm del
runner").

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
