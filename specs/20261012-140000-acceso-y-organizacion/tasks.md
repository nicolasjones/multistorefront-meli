# Tasks: Acceso, organización y permisos · Acceso y organización

**Input**: `specs/20261012-140000-acceso-y-organizacion/` (spec.md, plan.md)

**Formato**: `- [ ] T### [STORY-x][USy] descripción (FR)`. Las historias F-ACC-01..03 y F-ORG-01 son las STORY de MSF-119.

## Matriz de trazabilidad Jira ↔ US ↔ tareas

| Jira | Historia | US | Tareas |
|---|---|---|---|
| MSF-119 | F-ACC-01 Ingreso con correo y contraseña | US1 | T001–T007 |
| MSF-119 | F-ACC-02 Recuperar y definir contraseña | US2 | T008–T011 |
| MSF-119 | F-ACC-03 Cierre y vencimiento de sesión | US3 | T012–T015 |
| MSF-119 | F-ORG-01 Aislamiento por organización | US4 | T016–T019 |
| MSF-119 | Transversal (docs, verificación) | — | T020–T021 |

## Phase 1: US1 — Ingreso con correo y contraseña (F-ACC-01, P0)

**Goal**: ingreso con mensaje genérico, bloqueo, «Mantener la sesión iniciada» y rechazo de suspendidos.

**Independent Test**: usuario activo entra; inválido ve mensaje genérico; 5 fallos bloquean 15 min; suspendido es rechazado.

- [x] T001 [F-ACC-01][US1] Migración aditiva `public.usuarios_organizacion.estado` (plataforma/auth → `public`) (`activo`/`suspendido`, default `activo`) y ajuste de `private.organizacion_id()`/`private.puede_escribir()` para excluir suspendidos; reversión documentada (FR-004, FR-013)
- [x] T002 [F-ACC-01][US1] Prueba pgTAP `estado_usuario`: activo ve su organización, suspendido no ve filas ni escribe (FR-004, FR-011)
- [x] T003 [F-ACC-01][US1] Probar el límite de intentos de Supabase Auth (5 / 15 min por correo); si no alcanza, crear migración `public.intentos_acceso` (plataforma/auth → `public`) con RLS y su función, y subir la historia a talla M; anotar la decisión aquí (FR-003)
  - Decisión: `[auth.rate_limit].sign_in_sign_ups` limita por IP y por ventana de 5 min, no por correo/15 min → no alcanza. Se creó `public.intentos_acceso` (migración `20261012140200`); la historia sube a talla M. Límite: el bloqueo lo aplica el cliente vía RPC; un llamado directo a `/token` lo evita (endurecer con un Auth Hook o Edge Function queda como seguimiento). DoS dirigido por correo y entradas acotadas de la RPC: ver commit c77b074.
- [x] T004 [F-ACC-01][US1] Adecuar `pages/login.tsx` al sistema de diseño y al prototipo `Login.dc.html`: correo, contraseña, enlace «¿Olvidaste tu contraseña?» (texto completo a propósito, más claro que el del prototipo; ver commit de la 9.ª devolución), estados de carga/error (FR-001, FR-014)
- [x] T005 [F-ACC-01][US1] Mensaje genérico de error y aviso de bloqueo sin revelar si el correo existe (FR-002, FR-003)
- [x] T006 [F-ACC-01][US1] «Mantener la sesión iniciada» (persistencia/duración de sesión) y rechazo de suspendidos en `authProvider` (FR-004, FR-005)
- [x] T007 [F-ACC-01][US1] Tests Vitest de ingreso (éxito, error genérico, bloqueo, suspendido, «Mantener…») (FR-001..005)
  - Devoluciones PR #20 (notas cortas; el detalle vive en cada commit):
    - 1.ª: logout resetea la marca, conteo atómico, pgTAP de limpieza (ver commit 193e6e7).
    - 4.ª: marca restaurada tras el `signOut` del suspendido; `entrar/salir_de_organizacion` sin EXECUTE para anon (ver commit b22f223).
    - 5.ª: anon solo ejecuta las RPC de acceso, migración `20261013120001` (ver commit 4800dcc).
    - 6.ª: privilegios por defecto sin anon en `public` (ver commit e1470b2).
    - 7.ª: listener SIGNED_OUT silenciado durante el rechazo (ver commit 00d4774).
    - 8.ª: migración de la sesión legacy, `signOut` local de respaldo, enlace de recuperación (ver commit db3d3ea).
    - 9.ª: migración de acceso renumerada por choque con MSF-291; `logout` borra la marca solo tras `signOut` exitoso (ver commit 1301059).
    - 10.ª: error de ingreso por un solo canal (toast de Refine) (ver commit 2858f28).
    - 11.ª: se quita el `revoke ... from public` global de privilegios por defecto (ver commit 93a5ff0).
    - 12.ª y 13.ª: purga de `intentos_acceso` y su reposición en `20261013170000` (ver commits 99961a0 y 8eb78e6).
    - 14.ª: purga acotada con índice, mensaje de servicio ante red/429/5xx, aserción pgTAP sin grants para anon (ver commit add91e6).
    - 15.ª: mensaje de bloqueo sin cifra fija, `try/finally` sobre la marca, purga con `for update skip locked` (ver commit 480a3ee).
    - 16.ª: storage tolerante en la marca y `migrarSesionLegacy`, test del superadmin sin membresía (ver commit b5159b4).
    - 17.ª: adaptador de sesión (`getItem`/`setItem`/`removeItem`) tolerante al storage bloqueado con su test, y claves `pages.login.*` sin uso fuera de `i18nProvider` (ver commit cb5ff17).

> Devolución PR #20: `20261012140300_suspendidos_sin_privilegios.sql` filtra `estado = 'activo'` en las cuatro funciones RLS restantes, con pgTAP en `estado_usuario.test.sql` (ver commit 23b52e4).
> Devolución PR #20 (2.ª): bloqueo y registro de fallo fallan cerrado; `setMantenerSesion` se revierte si el ingreso falla; `login.tsx` captura excepciones; tests del adaptador de almacenamiento, estado de carga y aviso de bloqueo. Seguimiento: purga de `intentos_acceso`, HMAC del correo (ver commit 5326df9).
> Devolución PR #20 (3.ª): `esCredencialInvalida` cuenta solo `code === 'invalid_credentials'`; un 400 de otra causa (p. ej. `email_not_confirmed`) ya no suma fallos, con test (ver commit db2a22f).
> Devolución PR #20 (CI en rojo): `grant usage on schema public to anon` en la migración de `intentos_acceso` (sin él anon no podía llamar las RPC de bloqueo) y `App.test.tsx` busca el encabezado «Ingresar» de la nueva pantalla de ingreso. pgTAP no se pudo correr localmente (sin Postgres del CI); queda para el CI del PR.

**Checkpoint**: US1 verde (Vitest local; `pnpm test:db` lo corre el CI del PR #20, sin Docker local); desbloquea US3.

## Phase 2: US2 — Recuperar y definir contraseña (F-ACC-02, P0)

**Goal**: recuperación neutra, enlaces de un solo uso con vencimiento a 1 h y reglas de contraseña visibles.

**Independent Test**: pedir enlace, definir contraseña válida, reabrir el enlace y ver el aviso de vencido.

- [x] T008 [F-ACC-02][US2] Adecuar `acceso/solicitar-recuperacion` a `RecuperarContrasena.dc.html`: confirmación neutra siempre y aviso de enlace vencido (FR-006, FR-014) — sin `RecuperarContrasena.dc.html` en el repo; se adecuó al sistema de diseño MUI y se agregó aviso `?enlace=vencido`, al que redirige `definir-contrasena` cuando el enlace es inválido o vencido (ver commit 04c0b21)
- [x] T009 [F-ACC-02][US2] Adecuar `acceso/definir-contrasena` a `DefinirContrasena.dc.html`: reglas visibles (12+, mayúscula y minúscula, número, símbolo) y confirmación (FR-007, FR-014)
- [x] T010 [F-ACC-02][US2] Verificar en `supabase/config.toml` vencimiento de enlaces a 1 h y un solo uso; ajustar si difiere (FR-006) — verificado sin cambios: `otp_expiry = 3600`, `max_frequency = "15m"`, OTP de un solo uso por defecto de Auth
- [x] T011 [F-ACC-02][US2] Tests Vitest de recuperación/definir contraseña (neutralidad, reglas, enlace vencido/usado), reutilizando los de spec 006 (FR-006, FR-007)

**Checkpoint**: US2 verde, independiente de US1/US3/US4.

## Phase 3: US3 — Cierre y vencimiento de sesión (F-ACC-03, P0)

**Goal**: «Cerrar sesión» desde el menú de cuenta, vencimiento por inactividad / 30 días y corte de sesión del suspendido. **Depende de T001.**

**Independent Test**: cerrar sesión; simular vencimiento; suspender con sesión abierta y verificar corte.

- [x] T012 [F-ACC-03][US3] Confirmar que el plan de Supabase contratado permite `[auth.sessions] inactivity_timeout`/`timebox`; si no, documentar la alternativa en plan.md (FR-009) — no verificable desde el repo (depende del plan hosted); alternativa documentada en plan.md; **pendiente confirmar el plan hosted antes de producción**
- [x] T013 [F-ACC-03][US3] Configurar vencimiento de sesión: 12 h de inactividad, 30 días con «Mantener la sesión iniciada» (FR-009) — `timebox=720h` en config.toml; inactividad de 12 h en cliente (`vencimientoSesion.ts`)
- [x] T014 [F-ACC-03][US3] «Cerrar sesión» en el menú de cuenta de la barra superior (`AdminHeader.dc.html`) y redirección al ingreso (FR-008, FR-014) — «Salir» pasó a «Cerrar sesión» en `MenuCuenta`
- [x] T015 [F-ACC-03][US3] Corte de sesión al pasar a `suspendido` (invalidar sesiones) con prueba pgTAP/Vitest (FR-010) — trigger `cortar_sesiones_suspendido` + pgTAP; depende de la columna `estado` de T001

**Checkpoint**: US3 verde.

## Phase 4: US4 — Aislamiento por organización (F-ORG-01, P0)

**Goal**: regla de aislamiento para tablas de dominio y prueba que exige RLS en toda tabla.

**Independent Test**: pgTAP con dos organizaciones y recorrido del catálogo de tablas.

- [X] T016 [F-ORG-01][US4] Prueba pgTAP que recorre las tablas de todos los esquemas expuestos (`public` + `dominio`) y falla si alguna no tiene RLS activado (FR-012)
- [X] T017 [F-ORG-01][US4] Extender las pruebas de aislamiento existentes (dos organizaciones, sin membresía, suspendido) (FR-011) — Desvío: «suspendido» queda para F-ACC-01 (`estado`, T001/T002); ver commit 66c3852.
- [X] T018 [F-ORG-01][US4] Documentar en `docs/` la regla para tablas de dominio (`organizacion_id`, `private.organizacion_id()`, `private.puede_escribir()`) (FR-011, FR-015)
- [X] T019 [F-ORG-01][US4] Revisión del build: ninguna tabla expuesta (`public` o `dominio`) sin RLS en `supabase/migrations`, y cada tabla nueva declara su esquema (FR-012) — Revisión manual, sin script nuevo (el gate es la prueba de T016); ver commit 66c3852.

**Checkpoint**: US4 verde.

## Phase 5: Cierre

- [ ] T020 [Transversal][—] E2E de ingreso, recuperación y cierre de sesión sobre `infra/playwright` (SC-001, SC-003)
- [ ] T021 [Transversal][—] Actualizar documentación funcional (`docs/`, `AGENTS.md` si aplica) y correr `pnpm lint && pnpm build && pnpm test && pnpm docs:check`; al merge, actualizar `docs/roadmap-template.md` (FR-015, SC-005)
- [ ] T022 [F-ACC-01][US1] Endurecer el bloqueo de intentos en el servidor (Auth Hook o Edge Function) para cerrar el llamado directo a `/auth/v1/token`; incluir HMAC con secreto para el hash del correo y purga periódica de `intentos_acceso` que no dependa de que alguien falle un ingreso (hoy solo `registrar_fallo_acceso` purga; FR-003). Seguimiento de T003; sin historia asignada todavía
