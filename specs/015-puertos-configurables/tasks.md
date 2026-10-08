---

description: "Task list template for feature implementation"
---

# Tasks: Puertos de Desarrollo Local Configurables

**Input**: Design documents from `/specs/015-puertos-configurables/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/variables-puerto.md, quickstart.md

**Tests**: No se pidieron tests automatizados nuevos en la spec — la validación es manual, vía `quickstart.md` (Docker Compose + Supabase CLI, no hay suite de tests unitaria aplicable a config de infraestructura).

**Organization**: Tareas agrupadas por historia de usuario (spec.md) para poder implementar y validar cada una por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Se puede hacer en paralelo (archivos distintos, sin dependencia entre sí)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3)

## Path Conventions

Repositorio único — todas las rutas son relativas a la raíz del repo, según `plan.md`.

---

## Phase 1: Setup (declaración de variables)

**Purpose**: Declarar las variables de puerto nuevas en los tres `.env.example` del repo, con el mismo default que usa el template hoy — la base que el resto de las fases consume.

- [X] T001 [P] Agregar las 12 variables de puerto nuevas a `.env.example` (raíz) — `WEB_PORT`, `SUPABASE_API_PORT`, `SUPABASE_DB_PORT`, `SUPABASE_DB_SHADOW_PORT`, `SUPABASE_POOLER_PORT`, `SUPABASE_STUDIO_PORT`, `SUPABASE_MAILPIT_PORT`, `SUPABASE_EDGE_INSPECTOR_PORT`, `SUPABASE_ANALYTICS_PORT`, `KESTRA_PORT`, `SUPERSET_PORT`, `PLAYWRIGHT_PORT` — con el default de cada una igual al puerto actual (ver `contracts/variables-puerto.md`) y un comentario que remite a ese contrato
- [X] T002 [P] Actualizar `apps/web/.env.example`: `VITE_SUPABASE_URL` con el default correspondiente a `SUPABASE_API_PORT`, con comentario aclarando que Vite no lee el `.env` de la raíz — si se cambia `SUPABASE_API_PORT`, este valor se actualiza a mano acá
- [X] T003 [P] Actualizar `supabase/functions/.env.example`: `SUPERSET_PUBLIC_URL` con el default correspondiente a `SUPERSET_PORT`

**Checkpoint**: las tres declaraciones de variables están en su lugar; cualquier archivo consumidor puede referenciarlas.

---

## Phase 2: Foundational (bloqueante)

**Purpose**: Prerrequisitos que bloquean a todas las historias.

Ninguna tarea adicional en esta fase: los nombres y defaults de las variables
ya quedaron fijados en `contracts/variables-puerto.md` durante la
planificación, así que cada archivo consumidor (Fases 3-5) puede editarse en
paralelo sin esperar a que otro termine primero — no hay una pieza de
infraestructura compartida que construir antes.

**Checkpoint**: no aplica — se pasa directo a Fase 3.

---

## Phase 3: User Story 1 - Correr el template y un producto derivado en paralelo (Priority: P1) 🎯 MVP

**Goal**: Cada servicio de desarrollo local lee su puerto desde una variable de entorno en vez de tenerlo fijo, para poder correr dos stacks completos a la vez en la misma máquina.

**Independent Test**: `quickstart.md`, pasos 1 y 2 — un checkout sin `.env` arranca en los puertos de siempre; dos checkouts con `.env` distintos arrancan en paralelo sin conflicto.

### Implementation for User Story 1

- [X] T004 [P] [US1] `infra/refine/compose.yaml`: mapeo de puerto host y contenedor desde `${WEB_PORT:-3100}`
- [X] T005 [P] [US1] `infra/refine/Dockerfile`: `ARG WEB_PORT=3100` antes de `EXPOSE`, y `EXPOSE $WEB_PORT` en vez del literal
- [X] T006 [P] [US1] `apps/web/vite.config.ts`: `server.port` y `preview.port` leídos de `process.env.WEB_PORT` (fallback `3100`)
- [X] T007 [P] [US1] `infra/kestra/compose.yaml`: mapeo de puerto desde `${KESTRA_PORT:-8082}`, y los defaults de `KESTRA_BACKUPS_DB_URL`, `KESTRA_BACKUPS_PGDUMP_URL` y `KESTRA_ORQUESTACION_DB_URL` construidos con `${SUPABASE_DB_PORT:-5434}` en vez del `5434` suelto
- [X] T008 [P] [US1] `infra/superset/compose.yaml`: mapeo de puerto host desde `${SUPERSET_PORT:-8088}` (el bind interno de gunicorn y el healthcheck del contenedor quedan en `8088`, sin cambios — no forman parte del puerto expuesto al host)
- [X] T009 [P] [US1] `infra/playwright/compose.yaml` e `infra/playwright/compose.vps.yaml`: mapeo de puerto desde `${PLAYWRIGHT_PORT:-3103}` en los dos archivos
- [X] T010 [P] [US1] `package.json` (script `test:db:ci`) y `scripts/reset-db-ci.sh`: puerto de conexión a Postgres desde `${SUPABASE_DB_PORT:-5434}` en vez del `5434` fijo
- [X] T011 [US1] Ejecutar `pnpm infra:config`, `pnpm lint` y `pnpm build`; confirmar que los tres pasan igual que antes de esta feature (depende de T004-T010)
- [X] T012 [US1] Validar `quickstart.md` pasos 1 y 2 — cero regresión sin `.env`, y dos checkouts corriendo en paralelo sin conflicto de puerto (depende de T011)
  - Desvío: validación liviana con `docker compose config` en vez de
    contenedores reales de dos checkouts (ver commit 35a63a5). Pendiente la
    corrida completa antes del cierre de la spec (Fase 5).

**Checkpoint**: User Story 1 funcional de forma independiente — ya se puede tener el template y un fork corriendo a la vez.

---

## Phase 4: User Story 2 - Cambiar el puerto de un servicio sin perseguir referencias sueltas (Priority: P2)

**Goal**: Eliminar la clase de bug real que apareció en el primer fork — CORS de Superset y redirects de Auth desalineados del puerto que realmente usa Refine.

**Independent Test**: `quickstart.md`, paso 4 — con un segundo checkout en puertos no-default, el flujo de "olvidé mi contraseña" y un reporte embebido de Superset funcionan sin error de CORS ni redirect roto.

### Implementation for User Story 2

- [X] T013 [US2] `infra/superset/superset_config.py`: `CORS_OPTIONS.origins` derivado de una sola variable (`REFINE_ORIGIN`, que el archivo ya usa) en vez de mantener dos literales fijos (`http://localhost:3100`, `http://127.0.0.1:3100`) al lado
  - Desvío: las dos variantes de loopback (`localhost`/`127.0.0.1`) se
    mantienen (las sigue exigiendo el hallazgo de la spec 007), pero su
    puerto ahora sale de `WEB_PORT` en vez de quedar fijo en `3100`; hizo
    falta además pasar `WEB_PORT` al entorno del contenedor en
    `infra/superset/compose.yaml` para que el fallback lo vea (ver commit
    12fb7d1).
- [X] T014 [US2] `supabase/config.toml`: comentario explícito junto a `site_url` y `additional_redirect_urls` (bloque `[auth]`) indicando que deben mantenerse alineados a mano con `WEB_PORT` — la excepción documentada por FR-006 para este bloque específico
- [X] T015 [US2] Validar `quickstart.md` paso 4 (depende de T013, T014, y de que Fase 3 esté completa para tener un segundo stack corriendo en puertos no-default)
  - Desvío: validación liviana con `docker compose config` en vez del flujo
    real con dos checkouts (ver commit 12fb7d1). Pendiente la corrida
    completa antes del cierre de la spec (junto con la de T012).

**Checkpoint**: cambiar `WEB_PORT` en un fork ya no deja Auth ni CORS rotos en silencio.

---

## Phase 5: User Story 3 - Detectar puertos hardcodeados que se hayan vuelto a colar (Priority: P3)

**Goal**: Dejar el resto de `supabase/config.toml` señalado y confirmar, con una auditoría reproducible, que no queda ningún puerto hardcodeado fuera de su variable o de la excepción documentada.

**Independent Test**: `quickstart.md`, paso 3 — una búsqueda de texto de cada puerto de `contracts/variables-puerto.md` no encuentra apariciones fuera de su variable y de `supabase/config.toml`.

### Implementation for User Story 3

- [X] T016 [P] [US3] `supabase/config.toml`: comentario junto a cada puerto restante (`[api] port`, `[db] port` y `shadow_port`, `[db.pooler] port`, `[studio] port`, `[local_smtp] port`, `[edge_runtime] inspector_port`, `[analytics] port`) señalando su variable equivalente de `contracts/variables-puerto.md`
- [X] T017 [US3] Ejecutar la búsqueda de texto de `quickstart.md` paso 3 para cada puerto de `contracts/variables-puerto.md` y confirmar que las únicas apariciones fuera de su variable están en `supabase/config.toml` (depende de T004-T010, T013, T014, T016)
  - Desvío: un hallazgo no-violación — `infra/superset/compose.yaml` trae su
    propio fallback `${REFINE_ORIGIN:-http://localhost:3100}`, duplicando el
    3100 de `.env.example` fuera de las tres categorías permitidas en la
    letra estricta de la regla. Se acepta: mismo patrón ya usado para
    `KESTRA_ALERTAS_WEBHOOK_URL` (URL completa overrideable, no un puerto
    aislado), y sin impacto funcional porque las variantes de loopback de
    `CORS_OPTIONS.origins` (T013) ya derivan de `WEB_PORT` por su cuenta.

**Checkpoint**: SC-002 verificado — ningún puerto hardcodeado suelto fuera de la excepción documentada.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T018 [P] Revisar que `.env.example`, `apps/web/.env.example` y `supabase/functions/.env.example` queden con los mismos defaults que `contracts/variables-puerto.md`
- [X] T019 Ejecutar `pnpm test` completo (requiere `pnpm dev:supabase` corriendo) y confirmar que no hay regresión funcional
- [X] T020 Si algo se resolvió distinto a lo planeado, agregar la nota de desvío corta en este archivo con referencia al commit (regla del proyecto — sin repetir el párrafo del commit)
  - Sin desvíos en esta fase: T018 y T019 se ejecutaron tal como estaban
    planeados.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias — arranca de inmediato
- **Foundational (Fase 2)**: vacía, no bloquea nada adicional
- **User Story 1 (Fase 3)**: depende de Fase 1 (las variables tienen que estar declaradas antes de referenciarlas, aunque el nombre ya esté fijado en el contrato)
- **User Story 2 (Fase 4)**: depende de Fase 1; su validación (T015) además depende de que Fase 3 esté completa
- **User Story 3 (Fase 5)**: depende de Fase 1; su auditoría (T017) depende de que Fases 3 y 4 estén completas (audita el resultado de ambas)
- **Polish (Fase 6)**: depende de las historias que se quieran incluir en esta entrega

### Parallel Opportunities

- T001, T002, T003 (Fase 1) en paralelo — archivos distintos
- T004-T010 (Fase 3) en paralelo entre sí — cada una toca un archivo distinto y los valores ya están fijados en `contracts/variables-puerto.md`
- T016 (Fase 5) puede arrancar en paralelo con Fase 4, ya que edita una sección distinta de `supabase/config.toml` a la que toca T014

---

## Parallel Example: User Story 1

```bash
# Lanzar juntas las ediciones de compose/config de la Fase 3:
Task: "infra/refine/compose.yaml: puerto desde ${WEB_PORT:-3100}"
Task: "infra/refine/Dockerfile: ARG WEB_PORT + EXPOSE $WEB_PORT"
Task: "apps/web/vite.config.ts: server.port/preview.port desde process.env.WEB_PORT"
Task: "infra/kestra/compose.yaml: puerto y URLs JDBC desde variables"
Task: "infra/superset/compose.yaml: puerto host desde ${SUPERSET_PORT:-8088}"
Task: "infra/playwright/compose.yaml + compose.vps.yaml: puerto desde ${PLAYWRIGHT_PORT:-3103}"
Task: "package.json + scripts/reset-db-ci.sh: puerto Postgres desde ${SUPABASE_DB_PORT:-5434}"
```

---

## Implementation Strategy

### MVP First (User Story 1 solamente)

1. Fase 1: Setup (T001-T003)
2. Fase 2: Foundational — vacía, se salta
3. Fase 3: User Story 1 (T004-T012)
4. **Parar y validar**: correr `quickstart.md` pasos 1 y 2
5. Con esto solo ya se resuelve el caso que motivó la spec (correr dos stacks en paralelo)

### Incremental Delivery

1. Setup → Fase 3 (US1) → validar → ya es usable (MVP)
2. Agregar Fase 4 (US2) → validar con `quickstart.md` paso 4 → cierra el riesgo de Auth/CORS roto
3. Agregar Fase 5 (US3) → validar con `quickstart.md` paso 3 → confirma que no quedó nada hardcodeado
4. Fase 6 (Polish) al final, una sola vez

## Notes

- [P] = archivos distintos, sin dependencia entre sí
- Cada historia es un incremento completo y validable por separado con su paso correspondiente de `quickstart.md`
- Sin tests automatizados nuevos — la validación es manual vía `quickstart.md`, según lo indicado en el encabezado de este archivo

---

## Phase 7: Convergence

Tareas agregadas por `/speckit-converge` tras comparar el código contra spec.md/plan.md/tasks.md. Ver el resumen de hallazgos de esa corrida para el detalle de evidencia.

- [X] T021 [US2] Declarar `APP_URL` en `supabase/functions/.env.example` (mismo patrón que `SUPERSET_PUBLIC_URL`, default alineado a `WEB_PORT`) y alinear el fallback literal `http://127.0.0.1:3100` de `supabase/functions/invitar-miembro/index.ts` con esa variable per SC-002 (missing)
- [X] T022 [US1] Ejecutar `quickstart.md` pasos 1, 2 y 4 con dos checkouts reales corriendo en paralelo (no solo `docker compose config`) y confirmar sin conflicto de puertos ni error de CORS/redirect — cierra el pendiente dejado en las notas de desvío de T012/T015/T017 per US1/AC2 (partial)
  - Desvío: `infra/refine/compose.yaml` e `infra/superset/compose.yaml`
    fijan `name:` (identidad de producto, Constitución Principio IV) —
    un segundo checkout del *mismo* template no puede correr esos dos
    servicios en paralelo vía Compose sin renombrar el proyecto (eso sí
    lo tiene un fork real). Validado igual: Supabase en paralelo genuino
    (project-id propio, sin choque de puerto), Refine del segundo
    checkout vía `dev:refine:host` (WEB_PORT=4100, sin Docker), y el
    redirect de "olvidé mi contraseña" confirmado de punta a punta
    (GoTrue + Mailpit reales) apuntando a :4100. El CORS de Superset se
    verificó con la misma lógica de `superset_config.py` corrida en un
    contenedor `docker run --rm` aislado (WEB_PORT=4100 → orígenes
    correctos) en vez de un segundo Superset compose, para no arriesgar
    el Superset del checkout original (que sí sufrió un `Recreate`
    accidental por el nombre de proyecto compartido, restaurado sin
    pérdida de datos).
- [X] T023 [P] [US1] Agregar `args: WEB_PORT: ${WEB_PORT:-3100}` al `build:` de `infra/refine/compose.yaml` para que el `ARG` de `infra/refine/Dockerfile` refleje el `WEB_PORT` real en vez de construir siempre con el default per FR-005 (partial)
