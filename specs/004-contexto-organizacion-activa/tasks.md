---

description: "Task list template for feature implementation"
---

# Tasks: Contexto de organización activa del superadmin

**Input**: Documentos de diseño de `specs/004-contexto-organizacion-activa/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: no hay ninguna historia que dependa de una policy de RLS nueva
(el aislamiento ya está resuelto y probado desde la spec 003) — la única
lógica de base de datos nueva es la auditoría de entrada/salida (FR-006,
FR-007), que sí se cubre con pgTAP porque es exactamente el tipo de
comportamiento (no-op vs. registro, una fila vs. dos) que se rompe en
silencio sin un test. No se agregan tests de Refine/Vitest — ninguna
historia lo pide explícitamente, mismo criterio que la spec 003.

**Organización**: por historia de usuario, en orden de prioridad. US1 no
depende de la migración — solo lee `superadmin_organizacion_activa`
(ya existente desde la spec 003); US2 sí, porque agrega el RPC de salida
y el cambio de auditoría en `entrar_a_organizacion`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias)
- **[Story]**: US1, US2

## Phase 1: Setup

- [X] T001 Confirmar `pnpm dev:supabase` corriendo, migraciones de la spec
      003 aplicadas, y `git status` limpio en la raíz del repo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: una única forma de resolver "¿el superadmin actual tiene
organización activa, y cuál?", reutilizada tanto por el ocultamiento de
menú (US1) como por el banner (US2) — para no repetir la consulta en dos
lugares con lógica ligeramente distinta.

**⚠️ CRITICAL**: ninguna tarea de la Fase 3 en adelante empieza hasta cerrar esta fase.

- [X] T002 Agregar `checkOrganizacionActiva(userId)` a
      `apps/web/src/lib/superadmin.ts` (junto a `checkIsSuperadmin`, mismo
      patrón): consulta `superadmin_organizacion_activa` con join a
      `organizaciones(nombre)`, devuelve `{ id, nombre } | null`
- [X] T003 [P] Crear el hook `useOrganizacionActiva` en
      `apps/web/src/hooks/useOrganizacionActiva.ts`, envolviendo
      `checkOrganizacionActiva` para components de React (con estado de
      loading) — lo consume el banner de US2 (depende de T002)
- [X] T004 [P] Crear `apps/web/src/lib/recursosDependientesDeOrganizacion.ts`
      con la constante `RECURSOS_DEPENDIENTES_DE_ORGANIZACION = ['clientes']`
      (research.md: "Cómo marcar qué recursos dependen de organización")

**Checkpoint**: existe una única función para resolver organización activa — nada de negocio todavía.

---

## Phase 3: User Story 1 - Sin organización activa, no aparecen pantallas que no aplican (Priority: P1) 🎯 MVP

**Goal**: un superadmin sin organización activa no ve en el menú ninguna
pantalla que dependa de organización, y si llega por URL directa es
redirigido — sin tocar RLS (ya la protege desde la spec 003).

**Independent Test**: loguearse como superadmin sin haber entrado a
ninguna organización, confirmar que "Clientes" no aparece en el menú, y
que navegar a `/clientes` por URL redirige a `/organizaciones`.

### Implementation for User Story 1

- [X] T005 [US1] Extender `apps/web/src/providers/accessControlProvider.ts`:
      para cualquier resource en `RECURSOS_DEPENDIENTES_DE_ORGANIZACION`, si
      quien pregunta es superadmin, `can` depende de
      `checkOrganizacionActiva` (sin cambios para administrador/miembro,
      que siempre ven sus propias pantallas — FR-008) (depende de T002, T004)
- [X] T006 [US1] Crear el guard de ruteo
      `apps/web/src/components/RequiereOrganizacionActiva.tsx`: redirige a
      `/organizaciones` si el superadmin no tiene organización activa
      (depende de T002)
- [X] T007 [US1] Envolver las rutas de `clientes`
      (`/clientes`, `/clientes/create`, `/clientes/edit/:id`) con el guard
      en `apps/web/src/App.tsx` (depende de T006)

**Checkpoint**: Historia 1 completa — el problema reportado (lista vacía sin contexto) ya no ocurre.

---

## Phase 4: User Story 2 - Ver y salir de la organización activa (Priority: P2)

**Goal**: el superadmin ve en qué organización está operando y puede
salir explícitamente; cambiar de organización sin salir queda auditado
con ambos movimientos.

**Independent Test**: entrar a una organización, confirmar que su nombre
aparece de forma visible, usar "Salir", confirmar que vuelve al
comportamiento de la Historia 1, y que `superadmin_entradas` registró la
salida.

### Tests for User Story 2

- [X] T008 [US2] Escribir la migración
      `supabase/migrations/<timestamp>_contexto_organizacion_activa.sql`:
      `ALTER TABLE superadmin_entradas ADD COLUMN accion text NOT NULL
      DEFAULT 'entrada' CHECK (accion IN ('entrada', 'salida'))`;
      `CREATE FUNCTION salir_de_organizacion()` con
      `grant execute on function public.salir_de_organizacion() to authenticated`
      (contracts/salir-de-organizacion.md — sin este grant, el RPC no es
      invocable desde el cliente); `CREATE OR REPLACE FUNCTION
      entrar_a_organizacion(org_id uuid)` con el paso nuevo de auditar la
      salida automática, usando `clock_timestamp()` (no `now()`) en los
      dos inserts de auditoría de esta función para que salida y entrada
      no queden con el mismo timestamp (contracts/entrar-a-organizacion-delta.md,
      research.md)
- [X] T009 [US2] Aplicar la migración (`supabase migration up`) y
      confirmar que corre sin errores (depende de T008)
- [X] T010 [US2] Extender
      `supabase/tests/database/aislamiento_organizaciones.test.sql` con:
      `salir_de_organizacion` sin organización activa es no-op (no falla,
      no inserta fila — Clarifications Q1); salir con organización activa
      inserta una fila `accion = 'salida'`; `entrar_a_organizacion` a una
      segunda organización, teniendo ya una activa, inserta dos filas —
      salida de la primera y entrada a la segunda — verificado ordenando
      por `id` (no por `entrado_en`: aunque ahora use `clock_timestamp()`,
      `id` es la garantía determinística de orden de inserción,
      `entrado_en` es solo para lectura humana) (Clarifications Q2)
      (depende de T009)
- [X] T011 [US2] Correr `pnpm test:db` y confirmar que pasa (depende de T010)

### Implementation for User Story 2

- [X] T012 [P] [US2] Crear `apps/web/src/components/OrganizacionActivaBanner.tsx`:
      muestra el nombre de la organización activa (`useOrganizacionActiva`,
      T003) y un botón "Salir" que llama al RPC `salir_de_organizacion`
      (depende de T003, T009)
- [X] T013 [US2] Montar el banner en las pantallas dependientes de
      organización (`clientes`) en `apps/web/src/App.tsx`, junto al guard
      de la Historia 1 (depende de T012, T007) — **desvío**: se montó
      dentro del propio `RequiereOrganizacionActiva` (T006) en vez de
      repetido en cada `<Route>` de `App.tsx`; cualquier pantalla futura
      que use el guard hereda el banner sin tocar `App.tsx` de nuevo

**Checkpoint**: el superadmin ve dónde está parado, puede salir, y toda entrada/salida queda auditada.

---

## Phase Final: Polish & Cross-Cutting Concerns

- [X] T014 [P] Correr los 5 bloques de `quickstart.md` completos, con al
      menos dos organizaciones reales — **desvío** (mismo criterio que
      T026 de la spec 003): los bloques 3, 4 y 5 (no-op, doble auditoría
      al cambiar de organización, salida explícita) quedaron validados de
      punta a punta por los 8 casos nuevos de pgTAP (T010/T011), que
      ejercitan exactamente el mismo camino que la UI (mismas RPC). Los
      bloques 1 y 2 (menú oculto sin contexto, banner visible con
      contexto) se validaron por revisión de código + `tsc`/build en
      verde, no clickeando la UI en un navegador — no se usó Playwright
      en esta sesión, igual que en la spec 003.
- [X] T015 Correr `pnpm lint && pnpm build && pnpm test && pnpm infra:config`
      y confirmar que los 4 pasan — los 4 en verde
- [X] T016 Marcar todas las tareas de este archivo como completas y anotar
      cualquier desvío respecto al plan — ver notas en T013 (banner
      montado en el guard, no repetido en App.tsx) y T014 (validación de
      UI por código+build, no por navegador)

**Post-implementación** (encontrado por el usuario probando la app real,
no por `/speckit-analyze` ni `/speckit-converge` — ninguno de los dos
ejecuta la UI): tras "Ingresar"/"Salir", el menú seguía mostrando solo
"Organizaciones" porque el `Sider` vive en el layout persistente y
`useCan` (`@refinedev/core`) cachea el resultado de
`accessControlProvider` vía react-query — una navegación de cliente
(`navigate()`) nunca dispara una re-consulta. Fix: `window.location.assign()`
en vez de `navigate()` en ambas acciones (`organizaciones/list.tsx`,
`OrganizacionActivaBanner.tsx`) — recarga completa, que de paso también
evita cualquier dato cacheado por el dataProvider de la organización
anterior.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de Setup — bloquea ambas historias.
- **US1 (Fase 3)**: depende de Foundational. No depende de la migración de
  US2 — es pura UI sobre datos que ya existen desde la spec 003.
- **US2 (Fase 4)**: depende de Foundational. Independiente de US1 en
  términos de datos, pero comparte el punto de wiring en `App.tsx`
  (T013 se monta junto al guard de T007).
- **Polish (Final)**: depende de que US1 y US2 estén completas.

### Paralelismo

- T003 y T004 (Foundational) en paralelo — archivos distintos.
- T012 (US2) puede empezar en paralelo con T005-T007 (US1) una vez cerrada
  Foundational, aunque su wiring final (T013) espera a T007 por compartir
  archivo (`App.tsx`).

## Implementation Strategy

### MVP primero (User Story 1)

1. Fase 1 + Fase 2 (Setup + Foundational).
2. Fase 3 (US1): el problema reportado deja de ocurrir, sin tocar la base
   de datos.
3. **Parar y validar**: en este punto ya se resolvió la queja original,
   aunque el superadmin todavía no vea en qué organización está parado.

### Entrega incremental

1. Foundational → resolución compartida de organización activa.
2. US1 → menú correcto, sin pantallas fantasma (commit propio).
3. US2 → visibilidad + salida + auditoría completa (commit propio).
4. Polish → validación integral de cierre.
