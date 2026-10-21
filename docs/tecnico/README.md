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

- **[Arquitectura](arquitectura.md)** — componentes y límites.
- **[Datos y DER](datos.md)** — esquemas, tablas, RLS y ERD.
- **[API y RPC](api.md)** — contratos y cómo descubrirlos.
- **[Flujos](flujos.md)** — importaciones, estados y secuencias.
- **[Operación](operacion.md)** — deploy, CI, backups y e2e.
- **[Onboarding](onboarding.md)** — convenciones y primer PR.
- **[Decisiones (ADR)](adr.md)** — por qué está construido así.
- **[Biblioteca](biblioteca.md)** — todos los documentos existentes.

!!! tip "Regla de oro"
    Si el código, una migración o un contrato cambia y esta documentación no, el check de docs lo marca. La documentación se versiona en el mismo repo y se revisa en el PR.
