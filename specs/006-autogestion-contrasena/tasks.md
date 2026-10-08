---

description: "Tareas de implementacion para autogestion de contrasena"
---

# Tasks: Autogestion de contrasena

**Input**: Artefactos de `specs/006-autogestion-contrasena/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/` y `quickstart.md`

**Tests**: Se incluyen pruebas unitarias de formularios y de la politica de
contrasena, y validacion manual con Supabase local/Mailpit conforme al plan.
No se requiere migracion ni prueba pgTAP porque no se modifica una tabla ni RLS.

**Organization**: Las tareas se agrupan por historia para que cada flujo pueda
implementarse, probarse y entregarse de manera independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede realizarse en paralelo con otras tareas de archivos distintos.
- **[Story]**: Historia a la que pertenece la tarea (`US1`, `US2` o `US3`).
- Cada tarea indica rutas de archivos concretas.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establecer la base verificable de desarrollo local para Auth y correo.

- [X] T001 Verificar en `supabase/config.toml`, `apps/web/package.json` y `apps/web/src/test/setup.ts` la base local de Supabase, Mailpit y Vitest; documentar cualquier requisito operativo nuevo en `specs/006-autogestion-contrasena/quickstart.md` sin incorporar secretos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configurar la politica comun de Supabase Auth y la validacion reutilizable antes de exponer cualquier flujo.

**CRITICAL**: No iniciar una historia hasta completar esta fase.

- [X] T002 Actualizar `supabase/config.toml` con minimo de 12 caracteres, mayusculas, minusculas, numeros y simbolos; vigencia de enlace de una hora, frecuencia maxima de 15 minutos, aviso `password_changed` y redirecciones permitidas hacia `/acceso/definir-contrasena` para invitacion y recuperacion, preservando correo local y sin secretos versionados.
- [X] T003 [P] Crear pruebas de politica en `apps/web/src/lib/passwordPolicy.test.ts` para aceptar solo contrasenas de 12+ caracteres con los cuatro tipos exigidos y para no incluir el valor ingresado en mensajes.
- [X] T004 Implementar la validacion y mensajes reutilizables en `apps/web/src/lib/passwordPolicy.ts`; debe complementar, nunca sustituir, la imposicion de Supabase Auth.
- [X] T005 [P] Ajustar `apps/web/src/lib/supabase.ts` y `apps/web/src/providers/authProvider.ts` solo en lo necesario para exponer la sesion de enlace, redirigir de forma segura y conservar la sesion actual al cerrar las demas.

**Checkpoint**: Politica y utilidades comunes listas; se puede comenzar cada historia.

---

## Phase 3: User Story 1 - Crear contrasena al aceptar una invitacion (Priority: P1) MVP

**Goal**: La persona invitada define una contrasena propia desde su enlace y puede volver a iniciar sesion con ella.

**Independent Test**: Invitar una direccion nueva, completar el enlace de Mailpit, definir una contrasena valida, cerrar sesion e iniciar nuevamente con esas credenciales en menos de tres minutos.

### Tests for User Story 1

- [X] T006 [P] [US1] Crear pruebas de estados de enlace en `apps/web/src/pages/acceso/definir-contrasena.test.tsx`: sesion valida, enlace de invitacion o recuperacion usado/vencido/invalido sin sesion, politica invalida y fallo de actualizacion sin modificar la credencial.

### Implementation for User Story 1

- [X] T007 [US1] Actualizar `supabase/functions/invitar-miembro/index.ts` para que `inviteUserByEmail` redirija a `/acceso/definir-contrasena` con origen de invitacion; conservar la service-role exclusivamente en la funcion.
- [X] T008 [US1] Crear `apps/web/src/pages/acceso/definir-contrasena.tsx` para consumir la sesion del enlace, pedir y confirmar contrasena, llamar a `auth.updateUser`, y ofrecer `solicitar-recuperacion` si el enlace no puede completarse, sin autenticar ni filtrar datos en ese estado.
- [X] T009 [US1] Registrar la ruta publica de definicion de contrasena y su retorno seguro en `apps/web/src/App.tsx`.
- [X] T010 [US1] Ejecutar el escenario 1 y 2 de `specs/006-autogestion-contrasena/quickstart.md` con Supabase local y Mailpit, verificando segundo inicio de sesion, enlaces no utilizables y limite de 15 minutos.

**Checkpoint**: US1 es un MVP completo y verificable de manera independiente.

---

## Phase 4: User Story 2 - Recuperar acceso por correo (Priority: P2)

**Goal**: Una persona solicita por si misma un enlace de recuperacion y define una contrasena nueva sin revelar si su correo existe.

**Independent Test**: Pedir recuperacion para una cuenta existente y otra inexistente, observar la misma respuesta publica, completar el correo valido de Mailpit y acceder con la nueva contrasena en menos de cinco minutos.

### Tests for User Story 2

- [X] T011 [P] [US2] Crear pruebas en `apps/web/src/pages/acceso/solicitar-recuperacion.test.tsx` para respuesta neutral de cualquier correo, llamada a `resetPasswordForEmail` con redireccion segura y tratamiento del limite/fallo sin exponer existencia de cuenta.

### Implementation for User Story 2

- [X] T012 [US2] Crear `apps/web/src/pages/acceso/solicitar-recuperacion.tsx` con formulario de correo que use `auth.resetPasswordForEmail`, redirija a `/acceso/definir-contrasena?origen=recuperacion` y mantenga una respuesta neutral para direcciones existentes e inexistentes.
- [X] T013 [US2] Actualizar `apps/web/src/pages/login.tsx` para mostrar el acceso a recuperacion y registrar la ruta publica correspondiente en `apps/web/src/App.tsx`.
- [X] T014 [US2] Ajustar `apps/web/src/pages/acceso/definir-contrasena.tsx` para identificar el origen de recuperacion, reutilizar la politica comun y comunicar correctamente errores de enlace o de actualizacion sin revelar secretos.
- [X] T015 [US2] Ejecutar el escenario 3 de `specs/006-autogestion-contrasena/quickstart.md` con Mailpit: respuesta neutral, enlace de una hora/un uso, contrasena anterior rechazada, nueva aceptada, cierre de otras sesiones y aviso de cambio sin secretos.

**Checkpoint**: US1 y US2 funcionan y se validan de forma independiente.

---

## Phase 5: User Story 3 - Modificar contrasena desde una sesion (Priority: P3)

**Goal**: El titular autenticado cambia su propia contrasena confirmando la actual, sin que roles administrativos puedan hacerlo en su nombre.

**Independent Test**: Con una sesion existente, ingresar actual, nueva y confirmacion; comprobar que la anterior ya no inicia sesion, la nueva si, y un visitante no autenticado es redirigido.

### Tests for User Story 3

- [X] T016 [P] [US3] Crear pruebas en `apps/web/src/pages/cuenta/cambiar-contrasena.test.tsx` para exigir sesion y contrasena actual, validar nueva/confirmacion, rechazar actual incorrecta y solicitar cierre de las otras sesiones solo tras una actualizacion efectiva.

### Implementation for User Story 3

- [X] T017 [US3] Crear `apps/web/src/pages/cuenta/cambiar-contrasena.tsx` que exija sesion, use `auth.updateUser` con `current_password`, valide la nueva contrasena y, tras exito, cierre las demas sesiones preservando la actual y sin registrar campos sensibles.
- [X] T018 [US3] Incorporar en `apps/web/src/App.tsx` una ruta autenticada hacia `cuenta/cambiar-contrasena` y en la navegacion existente un acceso visible solo para el titular autenticado.
- [X] T019 [US3] Ejecutar el escenario 4 de `specs/006-autogestion-contrasena/quickstart.md`: actual incorrecta no altera nada, sesion actual continua, otras no se renuevan, llega aviso y ningun rol administrativo posee una accion de cambio ajeno.

**Checkpoint**: Las tres historias quedan funcionales y probadas de manera independiente.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verificar seguridad, no regresion y cierre de la entrega.

- [X] T020 Revisar `apps/web/src/pages/acceso/`, `apps/web/src/pages/cuenta/`, `apps/web/src/lib/`, `apps/web/src/providers/authProvider.ts` y `supabase/functions/invitar-miembro/index.ts` para confirmar que no hay contrasenas en logs, mensajes, auditorias, URLs ni codigo de administrador en el navegador.
- [X] T021 Documentar en `.env.example` y `specs/006-autogestion-contrasena/quickstart.md` que produccion requiere SMTP externo configurado fuera de Git y que Mailpit solo cubre desarrollo local, sin agregar valores secretos.
- [X] T022 Ejecutar los comandos de cierre de `specs/006-autogestion-contrasena/quickstart.md`: `pnpm test:web`, `pnpm test:db`, `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm infra:config`; documentar el resultado en la entrega sin versionar secretos.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: comienza de inmediato.
- **Phase 2**: depende de Phase 1 y bloquea las historias.
- **Phase 3 (US1)**: depende de Phase 2; es el MVP y debe completarse antes de pasar de fase.
- **Phase 4 (US2)**: depende de la ruta y politica de US1, que reutiliza.
- **Phase 5 (US3)**: depende de la politica y proveedor de sesion de Phase 2; se implementa despues de US2 para respetar el corte por fases del repositorio.
- **Phase 6**: depende de las tres historias.

### User Story Dependencies

- **US1 (P1)**: no depende de otra historia; entrega la capacidad de crear la primera contrasena.
- **US2 (P2)**: reutiliza la pantalla de definicion de US1 y agrega la solicitud neutral de recuperacion.
- **US3 (P3)**: reutiliza politica y sesion, sin conceder acciones de contrasena a administradores.

### Parallel Opportunities

- T003 y T005 pueden realizarse en paralelo despues de T002.
- T006 puede avanzar en paralelo con T007 una vez finalizada la fase comun.
- T011 puede avanzar en paralelo con el ajuste de invitacion de US1 ya completado.
- T016 puede comenzar mientras se concluye la validacion manual de US2, pero T017-T019 se realizan en la fase US3.

## Implementation Strategy

### MVP First (US1)

1. Completar T001-T005.
2. Completar T006-T010.
3. Detenerse en el checkpoint de US1 y validar el segundo acceso antes de ejecutar US2.

### Incremental Delivery

1. US1 permite a una invitacion convertirse en una credencial reutilizable.
2. US2 agrega recuperacion autoservicio y el camino de reintento ante enlace fallido.
3. US3 agrega cambio autenticado con confirmacion de la contrasena actual.
4. Phase 6 verifica la seguridad transversal y los comandos de cierre.

---

## Phase 7: Convergence

- [X] T023 Desactivar el registro publico en `supabase/config.toml` y verificar que las invitaciones administrativas siguen creando acceso conforme al plan: sin registro publico (contradicts).
- [X] T024 Distinguir en `apps/web/src/pages/cuenta/cambiar-contrasena.tsx` un fallo temporal de verificacion de una contrasena actual incorrecta, con pruebas para ambos resultados, conforme a FR-010 (partial).
