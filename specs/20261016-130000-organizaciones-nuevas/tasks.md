# Tasks: Acceso, organización y permisos · Organizaciones nuevas

**Input**: `specs/20261016-130000-organizaciones-nuevas/` (spec.md, plan.md)

**Formato**: `- [ ] T### [P] [STORY-x][USy] descripción`. **[P]** = paralelizable (archivos distintos, sin dependencia); sin [P] = secuencial.

**Delivery scope**: `refine`, `supabase`

**Estado**: borrador. Las fases 2–4 quedan **bloqueadas hasta responder Q1–Q5** de la spec; no se implementa antes. Tareas dentro de F-ORG-02 solo dependen de tareas de F-ORG-02.

**Regla**: ninguna tarea queda `[ ]` al cierre: se hace con evidencia o se cierra con `[x]` + `Desvío:` y seguimiento trazado.

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | Requisitos | Tasks |
|------|----------|------------|-------|
| F-ORG-02 | US1 Alta de nuevas organizaciones | FR-001, FR-005 | T002–T006 |
| F-ORG-02 | US1 (multi-pertenencia, si Q1 = sí) | FR-002, FR-003, FR-006 | T007–T012 |
| F-ORG-02 | US1 (facturación, si Q3 = sí) | FR-004 | T013–T014 |
| Tarea de cierre (label cierre) | Docs, seguridad, roadmap | — | T015–T017 |

## Phase 1: Verificación de partida — F-ORG-02

- [ ] T001 [F-ORG-02][US1] Verificar esquema de cada tabla tocada (tabla de esquemas de la spec; Principio VII), leer `crear-organizacion`, `pages/organizaciones/*`, `private.organizacion_id()` y las pruebas de aislamiento; anotar en plan.md (FR-005)

## Phase 2: Alta de organización — F-ORG-02

**Goal**: crear una organización con su primer administrador y sus empresas (FR-001).

- [ ] T002 [F-ORG-02][US1] Migración aditiva con la RPC/ajuste de datos que haga falta para crear empresas iniciales de la organización, RLS, sin `anon`, reversión en el encabezado (FR-001)
- [ ] T003 [F-ORG-02][US1] Extender Edge Function `crear-organizacion`: organización + administrador invitado + empresas iniciales, atómico con reversión (FR-001)
- [ ] T004 [P] [F-ORG-02][US1] `pages/organizaciones/create.tsx`: datos del alta según Q5, estados carga/vacío/error/éxito, 320/768/1440 px, sin UUID visible (FR-001)
- [ ] T005 [P] [F-ORG-02][US1] pgTAP: organización nueva aislada de las demás, RLS en `public` + `dominio`, `anon` sin ejecución (FR-005)
- [ ] T006 [P] [F-ORG-02][US1] Vitest del alta (éxito, error, reversión) (FR-001)

**Checkpoint**: `pnpm lint`, `pnpm build`, `pnpm test` verdes.

## Phase 3: Multi-pertenencia y selector — F-ORG-02 (solo si Q1 = sí)

- [ ] T007 [F-ORG-02][US1] Migración aditiva: clave `(user_id, organizacion_id)` de `usuarios_organizacion` con camino de reversión documentado (FR-002, FR-006)
- [ ] T008 [F-ORG-02][US1] Organización activa del usuario normal (almacenamiento y RPC `grant … authenticated`, `revoke … public, anon`) y ajuste de `private.organizacion_id()` (FR-002, FR-006)
- [ ] T009 [F-ORG-02][US1] Reescribir políticas, `private.nivel_seccion` y tablas de empresas por usuario (`usuarios_empresas` / `usuario_empresa_activa`) según Q2 (FR-006)
- [ ] T010 [F-ORG-02][US1] Selector de organización en `ContextoPanel` para usuarios normales (teclado, lector de pantalla, estados) (FR-003)
- [ ] T011 [P] [F-ORG-02][US1] pgTAP: usuario en dos organizaciones solo ve la activa; cambio de organización sin fuga; concurrencia (FR-002, FR-005)
- [ ] T012 [P] [F-ORG-02][US1] Vitest del selector (FR-003)

**Checkpoint**: pgTAP de aislamiento verde con multi-pertenencia.

## Phase 4: Facturación propia — F-ORG-02 (solo si Q3 = sí)

- [ ] T013 [F-ORG-02][US1] Migración aditiva de facturación del servicio (esquema según Q3, RLS por organización, reversión) (FR-004)
- [ ] T014 [P] [F-ORG-02][US1] pgTAP y Vitest de facturación (FR-004)

## Phase 5: Cierre

- [ ] T015 [P] [CIERRE] `docs/`: alta de organizaciones, selector y facturación (lo que aplique); `pnpm docs:check`
- [ ] T016 [CIERRE] Revisión de seguridad (`authz-security`) y validación final: `pnpm lint && pnpm build && pnpm test && pnpm docs:check`
- [ ] T017 [CIERRE] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md` (paso manual) y comprobar que ninguna tarea queda `[ ]`
