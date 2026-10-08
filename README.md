# Automation Platform Template

Base reutilizable para productos de automatización multi-tenant. Es un
monorepo: frontend, infraestructura, migraciones y workers evolucionan
juntos, con una sola historia Git y despliegues independientes. Cada
producto real (por ejemplo, uno para un vertical específico) parte de esta
base y agrega su propio dominio encima.

## Stack

- Refine + React en `apps/web`
- Supabase para Postgres, Auth y Storage
- Kestra para orquestación
- Apache Superset para analítica
- Workers en `workers/` cuando aparezcan casos concretos
- GitHub Spec Kit para pasar de requerimiento a implementación

## Desarrollo local

Requisitos: Node 24+, pnpm 11+, Docker Desktop y Supabase CLI (se instala con
las dependencias del repositorio).

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm install
pnpm dev:supabase
pnpm dev:refine
pnpm dev:kestra
pnpm dev:superset
pnpm dev:nango
```

Cada comando levanta sólo un producto Docker y queda agrupado de forma
independiente en Docker Desktop. Para detener uno, ejecuta
`pnpm dev:down:<producto>`. Refine también puede ejecutarse sin Docker con
`pnpm dev:refine:host`.

| Servicio | URL |
|---|---|
| Refine | http://localhost:3100 |
| Supabase API | http://127.0.0.1:8100 |
| Supabase Studio | http://127.0.0.1:3101 |
| Supabase Auth (mails de prueba, Mailpit) | http://127.0.0.1:3102 |
| Kestra | http://127.0.0.1:8082 |
| Superset | http://127.0.0.1:8088 |
| Nango (dashboard) | http://127.0.0.1:3003 |

### Usuarios y credenciales (solo stack local)

Todos los valores de abajo son los defaults del template — están pensados
para poder cambiarse (`ChangeMe1Local`, `change-me-local`, etc.) y solo
existen en Docker/Postgres local, nunca en un ambiente remoto.

| Servicio | Usuario | Password | Dónde se define |
|---|---|---|---|
| Refine (login vía Supabase Auth) | `superadmin@local.test` | `Superadmin-Local1!` | `supabase/seed.sql` — se recrea en cada `supabase db reset` |
| Supabase Studio | — (sin login) | — | `supabase/config.toml` (`[studio]`) |
| Supabase Auth / Mailpit | — (sin login) | — | `supabase/config.toml` (`[local_smtp]`) |
| Supabase Postgres (conexión directa) | `postgres` | `postgres` | fijo del CLI de Supabase, puerto `127.0.0.1:5434` |
| Supabase API keys (anon, service_role, JWT secret) | — | — | generadas por el CLI; correr `npx supabase status` para verlas (no se hardcodean acá porque son las del proyecto local activo) |
| Kestra | `admin@local.test` | `ChangeMe1Local` | `.env.example` → copiar a `infra/kestra/.env` (`KESTRA_BASIC_AUTH_USERNAME` / `KESTRA_BASIC_AUTH_PASSWORD`) |
| `kestra_backups` (rol Postgres, conexión JDBC directa del flow de respaldos, spec 011) | `kestra_backups` | `change-me-local` | `.env.example` (`KESTRA_BACKUPS_DB_PASSWORD`) — se rota por entorno, nunca queda en la migración (research.md R8) |
| Superset | `admin` (email `admin@local.test`) | `change-me-local` | `.env.example` → copiar a `infra/superset/.env` (`SUPERSET_ADMIN_USERNAME` / `SUPERSET_ADMIN_PASSWORD`) |
| Nango (dashboard, spec `20260930-153545-conexiones-oauth-nango`) | `admin@local.test` | `ChangeMe1Local` | `.env.example` → copiar a `infra/nango/.env` (`NANGO_DASHBOARD_USERNAME` / `NANGO_DASHBOARD_PASSWORD`) |

El superadmin de Refine es un usuario más de Supabase Auth marcado en la
tabla `superadmins` (ver quickstart de la spec 003) — no es un login
separado. Si cambiás los valores de `infra/kestra/.env` o
`infra/superset/.env`, esta tabla queda desactualizada para tu copia local;
son solo los defaults con los que arranca el template.

## Flujo de una funcionalidad

1. Crear la especificación con `/speckit-specify`.
2. Resolver ambigüedades importantes con `/speckit-clarify`.
3. Diseñar la solución con `/speckit-plan`.
4. Generar el trabajo con `/speckit-tasks`.
5. Implementar con `/speckit-implement`.
6. Declarar en la spec qué productos toca (`refine`, `supabase`, `kestra`,
   `superset`, `workers`) y ejecutar sus validaciones.
7. Ejecutar `pnpm lint`, `pnpm build` y `pnpm infra:config` antes de integrar.

Los comandos están disponibles tanto en Claude Code (`.claude/skills`) como en
Codex (`.agents/skills`). Consulta `docs/architecture.md` y
`docs/deployment.md` para el diseño completo.
