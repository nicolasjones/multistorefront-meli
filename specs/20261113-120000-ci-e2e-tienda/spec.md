# Feature Specification: CI · E2E de la tienda pública (`e2e-tienda`)

**Spec**: `ci-e2e-tienda` · **Prioridad**: P2
**Alcance de entrega**: `supabase` (solo el stack efímero del CI; sin migraciones ni tablas) y tooling de CI (`.github/workflows/validate.yml`, specs de `apps/web/e2e`). Sin pantallas nuevas: no aplica matriz pantalla↔criterios.
**Fuente**: los 20 `apps/web/e2e/tienda-*.e2e.ts` nunca corrían en el CI (solo `acceso-publico`), así que el layout nuevo de la tienda (menú «Principal»/«Categorías», pie con «Escribinos», bloque de consultas, tarjeta de producto, carga infinita sin paginación, «Ver catálogo» → `/catalogo`) podía romperlos sin que nadie lo viera.

## Objetivo

1. Que los 20 specs de la tienda corran en el CI de todo PR que toca la web (salvo a `epic/*`, igual que el resto del e2e).
2. Que estén al día con el DOM/UX actual del código de la tienda pública (`pages/tienda-publica`).
3. Que un spec omitido por un `test.skip` condicional no dé un falso verde.

## Requirements

- **FR-001**: job `e2e-tienda` en `validate.yml`, con el mismo disparo que el e2e (`changes.web` y `changes.e2e`, no draft, no `CI_PAUSED`), requerido (`validacion` y `liberar` lo esperan).
- **FR-002**: stack de Supabase propio del CI en una ranura de `scripts/supabase-ci.mjs` (misma reserva que `database`), con `auth`, `kong`, `postgrest` y `storage`; sin `edge-runtime`; PostgREST se reinicia tras migrar (`--ignore-health-check`) y el job espera la API y las dos tiendas del seed antes de seguir.
- **FR-003**: las claves salen de `supabase status -o env` (nunca de git) y la API se alcanza por `host.docker.internal` desde Node y desde Chromium.
- **FR-004**: `playwright test --workers=1 e2e/tienda-` en serie (los specs comparten las dos tiendas del seed), Chromium con el cache y `install-deps` del paso existente, limpieza de navegadores con `always()`, `supabase stop --no-backup` + `liberar` con `always()` y artefacto `playwright-report-tienda` si falla.
- **FR-005**: el caso `robots.txt`/`sitemap.xml` de `tienda-seo` (necesita Edge Runtime) se omite solo con `E2E_SIN_EDGE=1`; `tienda-sesion-vencimiento` falla en el CI si el build no sirve el host como tienda; `tienda-disponibilidad` no tiene `test.skip` condicionales.
- **FR-006**: ningún spec escribe directo en las tablas inalterables ni en `dominio.consultas` (`pnpm e2e:escritura:check`).
- **SC-001**: los 20 specs (30 casos) corren sin omisiones inesperadas contra un stack armado con la misma receta que el job.

## Decisiones

- **Job aparte, no un paso de `application`**: corre en paralelo con `application` y `web` y no alarga el camino crítico; `application` no tiene Supabase y levantarlo ahí lo serializaría. **Ranura propia, no el stack de `database`**: `database` solo corre si cambia `supabase/` y excluye `kong`/`postgrest` (los necesitamos); compartir su stack acoplaría dos jobs con fallos distintos.
- **Sin Edge Runtime**: monta `supabase/functions` del checkout y esa ruta no existe en el Docker del host (docker-fuera-de-docker). El único caso afectado queda cubierto por `test:edge:tienda-seo` (handler) y se sigue corriendo a mano.
- **Requerido y no `continue-on-error`**: un verde que no bloquea no protege el layout. Si el job resultara inestable, se apaga con `if: false` o se marca `continue-on-error` en una línea, sin tocar los specs.
- **Topes de espera más altos solo con `CI`** (`expect` 15 s, test 60 s, `webServer` 120 s): con el runner cargado, el primer render de una ficha superó 5 s (falso rojo observado en `tienda-relacionados`).
- Reversión: borrar el job `e2e-tienda` y sus dos referencias en `needs`/`validacion` de `validate.yml`; no hay datos ni migraciones.
