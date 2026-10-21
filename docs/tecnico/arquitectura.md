---
sources:
  - apps/web/src
  - supabase/migrations
---

# Arquitectura

MSF es un **monorepo** con un panel Refine/React y un backend **Supabase self-hosted** (Postgres, Auth, Storage, PostgREST y RPC). Alrededor viven Kestra (orquestación), Superset (analítica), workers y el pipeline de CI/CD (GitHub Actions + Dokploy).

## Componentes

| Componente | Rol | Dónde |
|---|---|---|
| **Panel** | UI Refine/React/MUI; rutas, pantallas, permisos de UI | `apps/web` |
| **Supabase** | Postgres + Auth + Storage + PostgREST + RPC | `supabase/` (migraciones, RLS, tests) |
| **Kestra** | Flows de importación/ETL y jobs | `infra/kestra` |
| **Superset** | Dashboards y analítica | `infra/superset` |
| **Workers** | Importadores y procesos aislados | `workers/` |
| **Observabilidad** | Prometheus/Grafana/Loki (según producto) | `infra/` |
| **CI/CD** | GitHub Actions self-hosted + Dokploy | `.github/workflows`, `infra/` |

## Límites y decisiones

- **Una organización, varias empresas.** El aislamiento se hace en la base con **RLS** por organización y por empresa/sección; la UI no es la frontera de seguridad.
- **Datos de negocio en `dominio`; plataforma en `public`.** Cada tabla declara su esquema en la spec (Principio VII).
- **Migraciones aditivas** con reversión documentada; nunca se destruye una columna/tabla en el mismo PR que la crea.
- **Secretos** solo del lado servidor; la service-role key nunca llega al navegador.
- **El prototipo manda la UI** (`design/pantallas/*.dc.html`), pero se implementa con los componentes del template y tokens del sistema de diseño.

## Diagramas

- **[Arquitectura interactiva (Archify)](../diagrams/msf-160-architecture.html)** — catálogo, API, RLS, Storage y consumidores.
- **[ERD interactivo](../diagrams/msf-160-erd.html)** — modelo de datos del catálogo.
- **[Arquitectura base (documento)](../architecture.md)** — el detalle del template y sus capas.

!!! note "Multi-producto"
    Este repo es un producto derivado del **automation-platform-template**. Lo específico de MSF vive en `docs/producto` y `specs/`; lo reutilizable se promueve a `platform-knowledge` del orquestador.
