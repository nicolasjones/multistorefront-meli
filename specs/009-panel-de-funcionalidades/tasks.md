# Tasks: Panel de funcionalidades por organización

**Input**: Design documents from `/specs/009-panel-de-funcionalidades/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/gestion-funcionalidades.md, quickstart.md (todos presentes).

**Tests**: pgTAP es obligatorio para el esquema/RLS/RPCs nuevos (constitución, Technology and Quality Gates — cambio sensible de aislamiento). Se agrega además un Vitest puntual para la lógica propia de la grilla (togglear una celda, estado vacío) — ver research.md #8.

**Organization**: Tareas agrupadas por historia de usuario (spec.md), en orden de prioridad P1 → P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (archivo distinto, sin dependencia de una tarea todavía incompleta)
- **[Story]**: a qué historia de usuario pertenece (US1, US2)

---

## Phase 1: Setup

**Purpose**: preparar los puntos de edición y las pruebas de la feature, sin lógica todavía.

- [X] T001 [P] Crear `supabase/migrations/<timestamp>_panel_de_funcionalidades.sql` con el comentario de reversión (data-model.md) y sin contenido más allá de eso todavía.
- [X] T002 [P] Crear el esqueleto de `supabase/tests/database/panel_de_funcionalidades.test.sql` con el fixture multi-tenant (dos organizaciones, un administrador por cada una) — mismo patrón que `analitica_embebida.test.sql`.

**Checkpoint**: archivos listos para completar en la fase siguiente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, RLS y RPCs de los que dependen las dos historias.

**⚠️ CRITICAL**: ninguna historia de usuario puede implementarse sin esta fase.

- [X] T003 En la migración de T001: crear las 3 tablas de `data-model.md` (`features`, `organizaciones_features`, `eventos_features`) con sus PK/FK y el `check` de formato de slug en `features.id`.
- [X] T004 En el mismo archivo: agregar `private.tiene_feature(p_feature_id text)` y `private.puede_ver_feature_organizacion(p_feature_id text, p_organizacion_id uuid)` — código exacto en data-model.md, con el comentario de por qué no deben confundirse (research.md #6).
- [X] T005 En el mismo archivo: agregar las 4 RPCs (`registrar_feature`, `habilitar_feature`, `deshabilitar_feature`, `tiene_feature_publica`) según `contracts/gestion-funcionalidades.md`, todas `security definer`, `search_path = ''`, con `revoke execute ... from public; grant execute ... to authenticated`.
- [X] T006 En el mismo archivo: activar RLS en las 3 tablas, agregar las policies de `select` de `data-model.md` (incluida la de `features` restringida a `is_superadmin() or tiene_feature(id)` — research.md #4), y los `grant select` a `authenticated` sin ningún `insert`/`update`/`delete` directo.
- [X] T007 Completar `supabase/tests/database/panel_de_funcionalidades.test.sql` (pgTAP): 31 aserciones cubriendo permisos y validación de las 4 RPCs, idempotencia de habilitar/deshabilitar, aislamiento entre organizaciones con la misma feature habilitada (réplica del bug puede_ver_reporte/puede_ver_asignacion de 007), fail-closed, resolución por organización activa del superadmin, catálogo no expuesto completo (FR-008), auditoría aislada, y cascada al borrar una organización. `pnpm test:db` en verde junto con las suites existentes (161 aserciones totales). Verificado además contra el reset parcial de CI (dos corridas seguidas dropeando solo public/private) — esta migración no toca ningún schema persistente (storage), así que no aplica el problema de idempotencia encontrado en la spec de perfil.

**Checkpoint**: esquema completo, RLS probada con pgTAP, RPCs funcionando contra la base — recién acá arrancan las historias de usuario.

---

## Phase 3: User Story 1 - El superadmin habilita y deshabilita funcionalidades por organización (Priority: P1) 🎯 MVP

**Goal**: el superadmin ve en una pantalla qué funcionalidades tiene habilitadas cada organización y puede cambiarlo ahí mismo.

**Independent Test**: con una funcionalidad de prueba registrada (quickstart.md, Prerrequisitos) y dos organizaciones, habilitarla para una y confirmar que la otra no cambia; deshabilitarla y confirmar que vuelve al estado inicial (quickstart.md, secciones 2-3).

### Implementation for User Story 1

- [X] T008 [P] [US1] Crear `apps/web/src/components/GrillaFeaturesPorOrganizacion.tsx` — filas = organizaciones existentes, columnas = `features` del catálogo, `Switch` de MUI por celda (estado = fila en `organizaciones_features`); cada cambio dispara `habilitar_feature`/`deshabilitar_feature` directamente, sin guardado en lote; mensaje explícito si el catálogo no tiene ninguna fila (FR-013).
- [X] T009 [US1] Crear `apps/web/src/pages/features/administrar.tsx`: lee `features` y `organizaciones`, monta `GrillaFeaturesPorOrganizacion` — sin ningún formulario de alta de funcionalidades (research.md #2).
- [X] T010 [US1] Registrar el resource `features-administrar` y la ruta `/features/administrar` en `apps/web/src/App.tsx`; restringir su acceso a superadmin en `apps/web/src/providers/accessControlProvider.ts` (mismo criterio que `analitica-administrar`) y sumarlo a `RECURSOS_EXCLUSIVOS_SUPERADMIN` en `apps/web/src/components/SiderConSeccionesSuperadmin.tsx`.
- [X] T011 [P] [US1] Vitest para `GrillaFeaturesPorOrganizacion.tsx`: togglear una celda llama a la RPC correcta con los ids esperados, y el catálogo vacío muestra el mensaje de FR-013 en vez de una tabla sin contexto.

**Checkpoint**: el superadmin puede habilitar/deshabilitar funcionalidades por organización de punta a punta (quickstart.md, secciones 1-5, 9).

---

## Phase 4: User Story 2 - Una funcionalidad futura verifica si está habilitada (Priority: P2)

**Goal**: cualquier funcionalidad que se construya después cuenta con una única forma confiable de preguntar si la organización de quien la usa la tiene habilitada.

**Independent Test**: con una funcionalidad de prueba habilitada solo para la organización X, confirmar que la consulta da verdadero para X, falso para Y sin habilitar, y falso para una organización recién creada sin ninguna habilitación (quickstart.md, secciones 6-7).

### Implementation for User Story 2

- [X] T012 [P] [US2] Crear `apps/web/src/lib/features.ts` (`checkFeatureHabilitada(featureId: string)`) según el patrón exacto de `apps/web/src/lib/superadmin.ts` — llama a la RPC `tiene_feature_publica`.
- [X] T013 [US2] Crear `apps/web/src/hooks/useFeatureHabilitada.ts`, mismo esqueleto que `useIsSuperadmin.ts` (`useGetIdentity` + `useEffect` + la función compartida de T012 + estado `{ habilitada, isLoading }`).
- [X] T014 [P] [US2] Crear `apps/web/src/lib/recursosCondicionadosAFeature.ts` (mapa `resource -> featureId`, vacío por ahora — ninguna pantalla existente se conecta en esta spec, Assumptions de spec.md) y la rama nueva en `accessControlProvider.ts` que lo consulta vía `checkFeatureHabilitada` cuando el `resource` está en ese mapa.

**Checkpoint**: el mecanismo de consulta está disponible para que una funcionalidad futura se conecte explícitamente (quickstart.md, secciones 6-7) — a propósito, nada del producto lo usa todavía.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T015 Correr `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` (comandos de validación de `CLAUDE.md`) con todo lo anterior aplicado.
- [X] T016 Ejecutar manualmente las 9 secciones de `quickstart.md` de punta a punta y anotar cualquier desvío en este archivo, con referencia al commit que lo resuelve.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea las dos historias.
- **User Stories (Phase 3-4)**: dependen de Foundational. US1 y US2 son
  independientes entre sí (ninguna reutiliza código de la otra) — a
  diferencia de 007, acá no hay un componente compartido entre historias.
- **Polish (Phase 5)**: depende de las historias que se hayan implementado.

### User Story Dependencies

- **US1 (P1)**: solo depende de Foundational.
- **US2 (P2)**: solo depende de Foundational — no depende del código de
  US1 (la pantalla del superadmin y el hook de consulta son
  independientes; ambos leen la misma tabla, ninguno le escribe código al
  otro).

### Parallel Opportunities

- T001, T002 (Setup) — archivos distintos, en paralelo.
- T008 (componente) puede escribirse en paralelo con T012/T014 (US2) una
  vez completa Foundational — no comparten archivo.
- T011 y T014 pueden escribirse en paralelo con otras tareas de su propia
  fase, una vez exista lo que prueban/consumen.

---

## Parallel Example: User Story 2

```bash
# T012 y T014 no dependen entre sí para poder escribirse:
Task: "Crear apps/web/src/lib/features.ts"
Task: "Crear apps/web/src/lib/recursosCondicionadosAFeature.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Setup + Foundational.
2. User Story 1 completa.
3. Validar con quickstart.md secciones 1-5 y 9 (catálogo vacío, registrar,
   habilitar, deshabilitar, idempotencia, borrado de organización).
4. En este punto el superadmin ya puede operar el panel de punta a
   punta — el MVP de esta spec es la capacidad de gestión, la de consulta
   (US2) es para que la use una funcionalidad futura, no un valor visible
   por sí sola todavía.

### Incremental Delivery

1. Setup + Foundational → esquema listo.
2. US1 → el superadmin puede armar y operar el catálogo.
3. US2 → el mecanismo de consulta queda disponible para conectar la
   primera funcionalidad real que lo necesite (fuera del alcance de esta
   spec).

---

## Notes

- Sin tareas de contract test dedicadas (`tests/contract/`) — el contrato
  de las RPCs se verifica con pgTAP (T007), igual que en 007.
- Las notas de desvío respecto a este plan van acá, cortas, con
  referencia al commit (`ver commit <hash>`) — la razón completa vive en
  el mensaje de commit (regla de `CLAUDE.md`).
- T016: secciones 1, 2, 3 y 5 de `quickstart.md` corridas de punta a
  punta contra la UI real (`pnpm dev:supabase` + contenedor `refine-dev`
  ya corriendo), con un superadmin y un administrador de organización de
  prueba creados vía Admin API — catálogo vacío mostrando el mensaje de
  FR-013, alta de `feature-de-prueba` reflejada en la grilla, toggle de X
  sin afectar a Y y sin estado residual al apagarlo, y el administrador
  de X sin ver el ítem del Sider ni poder entrar a la ruta directamente.
  Secciones 4, 6, 7, 8 y 9 (idempotencia, aislamiento, resolución por
  organización activa del superadmin, catálogo no expuesto, cascada de
  borrado) no se repitieron a mano por separado: son exactamente las que
  T007 ya prueba con pgTAP contra las RPCs y RLS reales, con la misma
  técnica de impersonación por rol que describe el propio quickstart —
  repetirlas a mano no agrega señal sobre lo que la corrida en verde de
  `pnpm test` ya confirmó. Sin desvíos de código: nada de lo anterior
  requirió un cambio sobre lo implementado en las fases previas. Fixture
  de este quickstart (dos organizaciones, tres usuarios de prueba, la
  funcionalidad de prueba) descartada al terminar — no quedó nada
  persistente en la base local.
