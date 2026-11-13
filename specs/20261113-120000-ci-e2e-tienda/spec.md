# Feature Specification: CI · E2E de la tienda pública (`e2e-tienda`)

**Spec**: `ci-e2e-tienda` · **Prioridad**: P2
**Alcance de entrega**: `supabase` (solo el stack efímero del CI; sin migraciones ni tablas) y tooling de CI (`.github/workflows/validate.yml`, specs de `apps/web/e2e`). Sin pantallas nuevas: no aplica matriz pantalla↔criterios.
**Fuente**: los 20 `apps/web/e2e/tienda-*.e2e.ts` nunca corrían en el CI (solo `acceso-publico`), así que el layout nuevo de la tienda (menú «Principal»/«Categorías», pie con «Escribinos», bloque de consultas, tarjeta de producto, carga infinita sin paginación, «Ver catálogo» → `/catalogo`) podía romperlos sin que nadie lo viera.

## Objetivo

1. Que los 20 specs de la tienda corran en el CI de todo PR que toca la web (salvo a `epic/*`, igual que el resto del e2e).
2. Que estén al día con el DOM/UX actual del código de la tienda pública (`pages/tienda-publica`).
3. Que un spec omitido por un `test.skip` condicional no dé un falso verde.

## Requirements

- **FR-001**: job `e2e-tienda` en `validate.yml`, con el mismo disparo que el e2e (`changes.web` y `changes.e2e`, no draft, no `CI_PAUSED`), kill switch `vars.CI_E2E_TIENDA != 'false'` y sin PRs de forks. Entra en `needs` de `validacion` y `liberar` pero **arranca no bloqueante** (`continue-on-error: ${{ vars.E2E_TIENDA_BLOQUEA != 'true' }}`); pasa a requerido con `E2E_TIENDA_BLOQUEA=true`.
- **FR-002**: stack de Supabase propio del CI en una ranura de `scripts/supabase-ci.mjs` (misma reserva que `database`), con `auth`, `kong`, `postgrest` y `storage`; sin `edge-runtime`; PostgREST se reinicia tras migrar (`--ignore-health-check`) y el job espera la API y las dos tiendas del seed antes de seguir.
- **FR-003**: las claves salen de `supabase status -o env` (nunca de git) y la API se alcanza por `host.docker.internal` desde Node y desde Chromium.
- **FR-004**: `playwright test --workers=1 e2e/tienda-` en serie (los specs comparten las dos tiendas del seed), Chromium con el cache y `install-deps` del paso existente, limpieza de navegadores con `always()`, `supabase stop --no-backup` + `liberar` con `always()` y artefacto `playwright-report-tienda` si falla.
- **FR-007**: espera de ranura de 10 min (`SUPABASE_CI_LOCK_MIN`), timeout del job de 55 min y TTL de ranuras de 75 min (`SUPABASE_CI_LOCK_TTL_MIN`) en `e2e-tienda` y en `database`; readiness de PostgREST, Auth (`/auth/v1/health`) y Storage (`/storage/v1/status`) antes de correr; artefacto con 7 días de retención también si se cancela.
- **FR-008**: los jobs que corren código del PR en el runner self-hosted (`application`, `web`, `e2e-tienda`, `infrastructure`, `database`, carril y `liberar`) se saltean en PRs de forks; `validacion` falla para ese PR (no da verde con todo `skipped`); `merge_group` y `push` no cambian.
- **FR-005**: el caso `robots.txt`/`sitemap.xml` de `tienda-seo` (necesita Edge Runtime) se omite solo con `E2E_SIN_EDGE=1`; `tienda-sesion-vencimiento` falla en el CI si el build no sirve el host como tienda; `tienda-disponibilidad` no tiene `test.skip` dinámicos. Una guarda final (`pnpm e2e:omitidos:check`, reporte JSON de Playwright) falla si hay más de 1 test omitido: 18 specs se omiten solos a nivel `describe` si falta el entorno y Playwright lo cuenta como éxito.
- **FR-006**: ningún spec escribe directo en las tablas inalterables ni en `dominio.consultas` (`pnpm e2e:escritura:check`).
- **SC-001**: los 20 specs (30 casos) corren sin omisiones inesperadas contra un stack armado con la misma receta que el job.

## Decisiones

- **Job aparte, no un paso de `application`**: corre en paralelo con `application` y `web` y no alarga el camino crítico; `application` no tiene Supabase y levantarlo ahí lo serializaría. **Ranura propia, no el stack de `database`**: `database` solo corre si cambia `supabase/` y excluye `kong`/`postgrest` (los necesitamos); compartir su stack acoplaría dos jobs con fallos distintos.
- **Sin Edge Runtime**: monta `supabase/functions` del checkout y esa ruta no existe en el Docker del host (docker-fuera-de-docker). El único caso afectado queda cubierto por `test:edge:tienda-seo` (handler) y se sigue corriendo a mano.
- **No bloqueante al principio, requerido después**: un job nuevo que nunca corrió en el runner real no debe frenar todos los PRs el primer día. `continue-on-error` por variable de repo (`E2E_TIENDA_BLOQUEA`) hace que el fallo llegue como `success` a `validacion`/`liberar` y la lógica de `skipped`/`failure` de esos jobs queda intacta; se pasa a requerido tras ~10 corridas verdes (T011). `CI_E2E_TIENDA=false` lo apaga sin tocar el workflow.
- **Ranuras**: espera corta (10 min) para no retener un runner; si no hay ranura el job falla y, siendo no bloqueante, el PR sigue. El TTL (75 min) va por encima del timeout (55) en todos los jobs que comparten ranuras, porque quien reclama recicla las vencidas. Caso marginal: una cancelación forzada del runner deja los contenedores `ci-…` y la ranura hasta el TTL; el siguiente job de la ranura los baja con `supabase stop`.
- **Forks**: los jobs pesados no corren código de forks en runners self-hosted; `validacion` falla cerrado en un PR de fork.
- **Topes de espera más altos solo con `CI`** (`expect` 15 s, test 60 s, `webServer` 120 s): con el runner cargado, el primer render de una ficha superó 5 s (falso rojo observado en `tienda-relacionados`).
- Reversión: `CI_E2E_TIENDA=false` lo apaga al instante; para quitarlo, borrar el job `e2e-tienda`, sus referencias en `needs`/`validacion` de `validate.yml` y el `env` de TTL de `database`; no hay datos ni migraciones.
