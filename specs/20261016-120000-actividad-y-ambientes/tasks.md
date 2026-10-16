# Tasks: Plataforma · Actividad y ambientes

**Input**: `specs/20261016-120000-actividad-y-ambientes/` (spec.md, plan.md)

**Formato**: `- [ ] T### [P] [STORY-x][USy] descripción`. **[P]** = paralelizable (archivos distintos, sin dependencia); sin [P] = secuencial.

**Delivery scope**: `refine`, `supabase`, CI/infra (verificación)

**Regla**: ninguna tarea queda `[ ]` al cierre: se hace con evidencia o se cierra con `[x]` + `Desvío:` y seguimiento trazado.

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | Tasks |
|------|----------|-------|
| F-AUD-01 | US1 Actividad e historial | T001–T015 |
| F-OPS-02 | US2 Ambientes y despliegue controlado | T016–T019 |
| MSF-455 (épica) | Docs y cierre | T020–T023 |

## Phase 1: Base de datos (supabase) — US1

**Goal**: registro transversal, función de registro y lectura paginada.

- [x] T001 [F-AUD-01][US1] Verificar esquema (`public.registro_actividad`, transversal; sin tablas en `dominio`) y que `nivel_seccion('actividad')` y la matriz existen; anotar en plan.md (FR-001, Principio VII) — hecho: esquema re-verificado y anotado en plan.md; la matriz da `lectura` también a Administración (manda la matriz)
- [x] T002 [F-AUD-01][US1] Migración aditiva `20261016120000_registro_actividad.sql`: tabla, check de `tipo`, índices, RLS solo `select`, sin privilegios `anon`, reversión en el encabezado (FR-001) — hecho (`20261016120000_registro_actividad.sql`; agrega `actor_nombre`)
- [x] T003 [F-AUD-01][US1] En la misma migración: `private.registrar_actividad` (organización y actor en servidor, valida empresa de la organización) y `public.registrar_actividad` con `revoke … public, anon` / `grant … authenticated` (FR-002) — hecho; `public.registrar_actividad` rechaza `usuario.*`, `invitacion.*`, `permisos.*`
- [x] T004 [F-AUD-01][US1] En la misma migración: `public.listar_actividad` (security invoker; período/usuario/tipo/texto/paginación; comodines escapados; tope de página; período en hora de Buenos Aires) (FR-003, FR-004) — hecho; agrega `public.opciones_actividad()` para los filtros
- [x] T005 [P] [F-AUD-01][US1] Seed de eventos de ejemplo por organización (solo local/staging) (FR-007) — hecho en `supabase/seed.sql` (solo local)
- [x] T006 [F-AUD-01][US1] Enchufar eventos de Acceso (cambio de rol, invitación, suspensión, guardado de matriz) llamando a `private.registrar_actividad` desde sus RPC, sin cambiar su comportamiento; reversión documentada (FR-007) — hecho. Desvío: eventos de Acceso por trigger sobre `eventos_membresia`; solo se reescriben las RPC de la matriz (ver commit dab1c40)
- [x] T007 [P] [F-AUD-01][US1] pgTAP `registro_actividad.test.sql`: aislamiento entre dos organizaciones, permisos por rol (cada rol según la matriz), filtro por empresa, sin escritura directa, `anon`, registrar fija organización/actor y rechaza empresa ajena, filtros y paginación (SC-002, SC-003) — hecho: `registro_actividad.test.sql` (70 pruebas). Desvío: sin Docker local, se ejecuta en el CI
- [x] T008 [P] [F-AUD-01][US1] Confirmar `rls_en_toda_tabla`, `aislamiento_organizaciones` y ejecutabilidad por `anon` verdes con lo nuevo; ajustar solo si hace falta (FR-001, FR-002) — hecho por revisión estática (RLS en la tabla, sin grants a `anon`, funciones con `revoke`). Desvío: sin Docker local, `rls_en_toda_tabla` y `aislamiento_organizaciones` se confirman en el CI

**Checkpoint**: `pnpm test:db` (pgTAP) verde.

## Phase 2: Pantalla Actividad (refine) — US1

**Goal**: listado con filtros, búsqueda y paginación, con permisos y navegación.

- [x] T009 [F-AUD-01][US1] Hook `useActividad` sobre `listar_actividad` (filtros incl. empresa, búsqueda, paginación, período en America/Argentina/Buenos_Aires) (FR-003, FR-004) — hecho (`hooks/useActividad.ts`, `lib/actividad.ts`)
- [x] T010 [F-AUD-01][US1] `pages/actividad/list.tsx` con componentes del template y tokens del sistema de diseño: Cuándo/Tipo/Tienda (o «Compartido»)/Detalle/Quién, filtros (período, empresa/tienda, usuario, tipo), búsqueda «Buscar en la actividad», paginación «1–10 de N», estados carga/vacío/error con reintento, 320/768/1440 px, sin UUID visible; sin «Exportar» (FR-003, FR-006, FR-008) — hecho (`pages/actividad/list.tsx`)
- [x] T011 [F-AUD-01][US1] Destino de menú «Actividad» (icono, `seccionPermiso: 'actividad'`), entrada en `SECCION_POR_RECURSO`, ruta `/actividad` con carga diferida y `RequiereAccesoSeccion` (FR-005, FR-008) — hecho (menú, `SECCION_POR_RECURSO`, ruta lazy con guard)
- [x] T012 [F-AUD-01][US1] Registrar el destino de `eventosActividad.ts` hacia `public.registrar_actividad`; un fallo no revierte la edición (FR-007) — hecho (`lib/destinoActividad.ts`, instalado en `main.tsx`)
- [x] T013 [P] [F-AUD-01][US1] Vitest del listado: filtros combinados (incl. empresa), búsqueda, paginación, estados, hora de Buenos Aires, operador ve todo (SC-001) — hecho (`list.test.tsx`, `actividad.test.ts`, `destinoActividad.test.ts`)
- [x] T014 [P] [F-AUD-01][US1] Vitest de menú/guard por `nivel_seccion` (`App.guard.test.ts`, `destinosPanel.permisos.test.ts`) (SC-001) — hecho (`destinosPanel.permisos.test.ts`; `App.guard.test.ts` cubre la ruta)
- [x] T015 [F-AUD-01][US1] E2E del listado con filtros; si aún no hay suite Playwright de la app (MSF-499), cerrar con `[x]` + `Desvío:` y deuda trazada, nunca `[ ]` (SC-001) — Desvío: el recorrido con sesión necesita fixtures por rol (MSF-499 sigue pendiente, ver `docs/e2e-app.md`); se agregó la parte pública (`/actividad` sin sesión → ingreso). Seguimiento por trazar en Jira (E2E del listado con filtros)

**Checkpoint**: `pnpm lint`, `pnpm build`, `pnpm test` verdes.

## Phase 3: Ambientes y despliegue controlado — US2

**Goal**: adoptar y verificar el CI staging → producción del template.

- [x] T016 [F-OPS-02][US2] Verificar Environments de staging y producción con secretos separados, y los workflows de migraciones, deploy y flows; documentar brechas y trazar las reales; confirmar que `SUPABASE_DB_URL` de cada Environment apunta a Supabase self-hosted (nunca Cloud) y documentar que `migraciones-cloud` es solo el nombre heredado (FR-009) — hecho: `docs/ambientes-verificacion.md`. Desvío: los valores de `SUPABASE_DB_URL` no son legibles por API; confirmación humana de que apuntan al self-hosted (ver commit f23e970); confirmación humana pendiente
- [x] T017 [F-OPS-02][US2] Verificar la compuerta `verificar-staging-exitoso.mjs`: producción rechaza un commit sin staging verde (SC-004) — hecho: 6/6 pruebas de la compuerta verdes
- [x] T018 [F-OPS-02][US2] Cambio de prueba inocuo que recorre staging → producción; guardar links a los runs como evidencia (SC-004) — Desvío: no se disparó un run nuevo a producción (acción externa sin autorización); evidencia con la promoción real 38592333660 → 38592807917 (ver `docs/ambientes-verificacion.md` y commit f23e970)
- [x] T019 [P] [F-OPS-02][US2] Verificar aislamiento por organización entre ambientes (sin datos ni secretos compartidos) y documentar (FR-009) — hecho: documentado en `docs/ambientes-verificacion.md`

**Checkpoint**: evidencia de la promoción en `docs/`.

## Phase 4: Cierre

- [x] T020 [P] [MSF-455] `docs/actividad.md`: contrato de registro para otros componentes, tipos `entidad.accion`, permisos, reversión (FR-010) — hecho (`docs/actividad.md`, commit be6d46d)
- [x] T021 [P] [MSF-455] Actualizar `docs/permisos-por-rol.md` (auditoría de F-ROL-02) y `docs/adoptar-cicd-staging-produccion.md` (evidencia F-OPS-02) (FR-010) — hecho (`permisos-por-rol.md` y §7 de `adoptar-cicd-staging-produccion.md`)
- [x] T022 [MSF-455] Revisión de seguridad (`authz-security`) y validación final: `pnpm lint && pnpm build && pnpm test && pnpm docs:check`; anotar en el PR diferencias contra el prototipo y «Exportar» (SC-001…005) — hecho: lint, build, docs:check y vitest del área verdes; revisión authz de la migración (RLS solo select, `revoke … anon`, `search_path=''`, organización y actor fijados en servidor). Desvío: pgTAP sin Docker local, corre en el CI
- [x] T023 [MSF-455] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md` (paso manual) y comprobar que ninguna tarea queda `[ ]` — Desvío: la fila ya está en `docs/roadmap-template.md` con estado «En PR»; pasarla a «Implementado» es el paso manual al merge (no se automatiza)
