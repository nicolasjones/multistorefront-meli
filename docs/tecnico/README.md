---
owner: producto
sources: []
---

# Empezar (técnico)

MSF es un monorepo **Refine + React + MUI** sobre **Supabase self-hosted (Postgres + Auth + Storage)**, con **Kestra** para orquestación, **Apache Superset** para analítica, **workers** para procesos aislados y **GitHub Spec Kit** para especificar.

## En 30 segundos

```bash
pnpm install
pnpm dev:supabase      # Postgres/Auth/Storage local (Docker)
pnpm dev               # panel en http://localhost:5173
pnpm test              # unit + db + web
pnpm test:e2e          # Playwright (requiere build o E2E_BASE_URL)
```

## Mapa del repo

| Carpeta | Qué hay |
|---|---|
| `apps/web` | Panel (Refine/React/MUI), rutas, pantallas, tests |
| `packages/` | Código compartido (core, IA, MCP, etc.) |
| `supabase/` | Migraciones, RLS, RPC, tests pgTAP, seed |
| `workers/` | Procesos aislados (importadores, jobs) |
| `infra/` | Compose/Docker por producto, runners, observabilidad |
| `specs/` | Specs de Spec Kit (`spec.md`, `plan.md`, `tasks.md`) |
| `design/pantallas` | Prototipo HTML (fuente visual) |
| `scripts/` | Tooling (docs, calidad, e2e, prototipo) |
| `docs/` | Esta documentación |

## Por dónde seguir

<div class="grid cards" markdown>

-   :material-sitemap-outline:{ .lg .middle } **Arquitectura**

    ---

    Componentes y límites.

    [:octicons-arrow-right-24: Abrir](arquitectura.md)

-   :material-database-outline:{ .lg .middle } **Datos y DER**

    ---

    Esquemas, tablas, RLS y ERD.

    [:octicons-arrow-right-24: Abrir](datos.md)

-   :material-api:{ .lg .middle } **API y RPC**

    ---

    Contratos y cómo descubrirlos.

    [:octicons-arrow-right-24: Abrir](api.md)

-   :material-swap-horizontal:{ .lg .middle } **Flujos**

    ---

    Importaciones, estados y secuencias.

    [:octicons-arrow-right-24: Abrir](flujos.md)

-   :material-server-outline:{ .lg .middle } **Operación**

    ---

    Deploy, CI, backups y e2e.

    [:octicons-arrow-right-24: Abrir](operacion.md)

-   :material-rocket-launch-outline:{ .lg .middle } **Onboarding**

    ---

    Convenciones y primer PR.

    [:octicons-arrow-right-24: Abrir](onboarding.md)

-   :material-scale-balance:{ .lg .middle } **Decisiones (ADR)**

    ---

    Por qué está construido así.

    [:octicons-arrow-right-24: Abrir](adr.md)

-   :material-bookshelf:{ .lg .middle } **Biblioteca**

    ---

    Todos los documentos existentes.

    [:octicons-arrow-right-24: Abrir](biblioteca.md)

</div>

!!! tip "Regla de oro"
    Si el código, una migración o un contrato cambia y esta documentación no, el check de docs lo marca. La documentación se versiona en el mismo repo y se revisa en el PR.
