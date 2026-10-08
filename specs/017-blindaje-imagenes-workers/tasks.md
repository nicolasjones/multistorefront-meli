---
description: "Tareas de implementación para blindaje y publicación de imágenes de workers"
---

# Tasks: Blindaje y publicación de imágenes de workers

**Input**: Design documents from `/specs/017-blindaje-imagenes-workers/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Organization**: Las tareas están agrupadas por historia de usuario y cada fase tiene un checkpoint independiente.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Documentar el contrato mínimo de un worker nuevo y su convención de nombres en `workers/README.md`
- [X] T002 [P] Crear la plantilla de contexto seguro `.dockerignore` en `.dockerignore`
- [X] T003 [P] Crear el script de descubrimiento y validación de workers en `scripts/descubrir-workers.mjs`
- [X] T004 Agregar el comando `workers:discover` y las validaciones de build de workers en `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 Crear fixtures de un worker válido, incompleto y no permitido para probar el descubrimiento en `scripts/fixtures/workers/`
- [X] T006 [P] Agregar pruebas del descubrimiento y rechazo de workers inválidos en `scripts/descubrir-workers.test.mjs`
- [X] T007 [P] Añadir la matriz de contratos de imagen y runtime como referencia operativa en `workers/CONTRATO.md`
- [X] T008 Definir la política de severidades bloqueantes, excepciones con vencimiento y retención mínima en `.github/worker-release-policy.yml`
- [X] T009 Validar que no haya cambios de Supabase, RLS ni secretos versionados en el alcance de esta spec mediante una revisión documentada en `specs/017-blindaje-imagenes-workers/research.md`

**Checkpoint**: El repositorio descubre únicamente workers válidos, conoce el contrato común y tiene una política de release versionada.

---

## Phase 3: User Story 1 - Publicar una versión confiable de un worker (Priority: P1) 🎯 MVP

- [X] T010 [P] [US1] Crear un smoke test de build, usuario, plataforma y entrypoint en `scripts/smoke-imagenes-workers.mjs`
- [X] T011 [P] [US1] Agregar fixtures de metadatos y un reporte de escáner con vulnerabilidad crítica/alta para probar el bloqueo sin introducir una dependencia vulnerable en producción en `scripts/fixtures/worker-images/`
- [X] T012 [US1] Incorporar al CI la ejecución del descubrimiento y smoke test antes de publicar en `.github/workflows/worker-images.yml`
- [X] T013 [US1] Crear el Dockerfile parametrizado por `WORKER` con build multi-stage y runtime mínimo en `workers/Dockerfile`
- [X] T014 [US1] Ejecutar el build desde la raíz del monorepo y publicar una imagen por worker usando la matriz descubierta en `.github/workflows/worker-images.yml`
- [X] T015 [US1] Ejecutar los workers como usuario no root y eliminar `corepack` y dependencias de desarrollo del runtime en `workers/Dockerfile`
- [X] T016 [US1] Fijar la plataforma `linux/amd64`, labels de commit/worker/repositorio y referencias por SHA/digest en `.github/workflows/worker-images.yml` y `workers/Dockerfile`
- [X] T017 [US1] Agregar escaneo crítico/alto, SBOM y provenance/attestation con bloqueo de excepciones vencidas en `.github/workflows/worker-images.yml`
- [X] T018 [US1] Mantener alias `latest` solo como compatibilidad transitoria y documentar el digest como referencia canónica en `workers/README.md`

**Checkpoint**: El mecanismo construye desde checkout limpio, pasa smoke test y el CI solo publica artefactos verificables — verificado con fixtures; el primer worker real completa este checkpoint con su propia imagen.

---

## Phase 4: User Story 2 - Ejecutar un worker aislado desde Kestra (Priority: P1)

- [X] T019 [P] [US2] Crear un fixture de ejecución puntual con éxito, fallo técnico y credencial inválida en `infra/kestra/fixtures/worker-runtime/`
- [X] T020 [P] [US2] Crear el harness de contrato Kestra con SSH local, Docker Desktop/WSL2 sobre Windows, Docker Engine sobre Linux, timeout, cancelación, 100 ejecuciones de logs sanitizados y verificación de egress en `infra/kestra/validar-workers-runtime.ps1`
- [X] T021 [US2] Agregar una prueba reutilizable de idempotencia para el mismo `EJECUCION_ID` en `scripts/validar-idempotencia-workers.mjs` y conectarla al comando de validación del root
- [X] T022 [US2] Actualizar el comando de lanzamiento genérico con digest, usuario, límites de CPU/memoria, timeout, filesystem temporal, capacidades mínimas y red deny-by-default con allowlist por worker en `infra/kestra/flows/plantilla-generico.yml`
- [X] T023 [US2] Aplicar el mismo contrato de runtime, allowlist de egress y límites al despacho dedicado en `infra/kestra/flows/plantilla-dedicado.yml`
- [X] T024 N/A El template no tiene flows de producto concretos todavía (`infra/kestra/flows/` solo tiene la plantilla genérica y la dedicada) — cada producto derivado adapta sus propios flows al adoptar este mecanismo, fuera del alcance de esta spec
- [X] T025 Documentar variables, restricciones, egress permitido y comportamiento de errores en `workers/README.md` y `workers/CONTRATO.md`

**Checkpoint**: Kestra puede ejecutar un worker por digest, con límites y secretos de runtime, y las pruebas de fixture demuestran aislamiento e idempotencia — el recorrido E2E real con SSH y un worker real queda para la spec del primer producto derivado que lo adopte.

---

## Phase 5: User Story 3 - Recuperar y diagnosticar una versión (Priority: P2)

- [X] T026 [P] [US3] Crear el escenario de dos versiones, regresión y rollback en `scripts/fixtures/worker-rollback/`
- [X] T027 [US3] Automatizar la comprobación de digest, worker, flow, organización, intento y código de salida en `scripts/validar-auditoria-workers.mjs`
- [X] T028 [US3] Publicar y conservar referencias inmutables con política de retención mínima y permisos separados de push/pull en `.github/workflows/worker-images.yml`
- [X] T029 Documentar procedimiento de rollback, limpieza de imágenes y recuperación por digest en `workers/CONTRATO.md`
- [X] T030 [US3] Añadir al contrato de ejecución la correlación entre `EJECUCION_ID`, digest, flow, organización, intento y estado en `specs/017-blindaje-imagenes-workers/contracts/worker-runtime.md`

**Checkpoint**: Un operador puede diagnosticar y revertir un único worker sin reconstruirlo ni modificar las versiones de otras integraciones.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T031 [P] Actualizar el quickstart con los comandos reales y resultados observados en `specs/017-blindaje-imagenes-workers/quickstart.md`
- [X] T032 [P] Agregar un ejemplo de alta de un worker nuevo sin editar una lista central en `workers/README.md`
- [X] T033 Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config` y las validaciones de workers documentando resultados en `specs/017-blindaje-imagenes-workers/quickstart.md`
- [X] T034 Revisar el diff final contra la Constitución y registrar cualquier desvío en esta nota final

**Final Checkpoint**: La publicación, ejecución, diagnóstico, rollback y alta de un worker futuro están validados con fixtures, sin secretos reales y sin ningún worker de negocio en el template.

---

## Dependencies & Execution Order

Igual que en el producto de origen: Setup → Foundational → US1 (MVP) → US2 (fixtures en paralelo con US1, despacho real requiere las referencias de imagen de US1) → US3 (requiere publicación de US1 y contrato de auditoría de US2) → Polish.

## Notes

- Cada tarea incluye su archivo o directorio objetivo.
- No se introdujeron credenciales reales.
- No se agregan migraciones de Supabase ni un Compose raíz.

## Nota de implementación (port-back)

Este spec se implementó de una sola vez, portando y generalizando un mecanismo ya validado en producción en un producto derivado (ver "Origen" en `spec.md`), no incrementalmente vía `/speckit-implement` fase por fase. Desvíos respecto al origen, todos por ser el template genérico y no tener workers reales todavía:

- `scripts/validar-egress-workers.mjs` valida dinámicamente las entradas que existan en `workers.egress-allowlists.json` en vez de una lista fija de sistemas — el origen tenía cinco workers de negocio hardcodeados ahí; acá no hay ninguno todavía.
- `workers/egress-allowlists.json` arranca con `workers: {}` vacío; cada producto derivado agrega la entrada de su propio worker.
- `workers/Dockerfile` recibe `REPO_URL` como build-arg en vez de tener la URL de un repositorio hardcodeada en el label OCI — necesario porque el template y cada fork son repositorios distintos.
- T024 (adaptar flows de producto concretos) no aplica: el template no tiene flows de producto, solo las plantillas genérica y dedicada.
