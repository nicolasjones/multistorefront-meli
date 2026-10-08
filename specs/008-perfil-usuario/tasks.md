# Tasks: Gestión del perfil personal

**Input**: Design documents from /specs/008-perfil-usuario/

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/perfil-personal.md y quickstart.md.

**Tests**: Se incluyen pruebas porque el plan exige Vitest para UI y pgTAP para RLS, Storage y el hook de Auth.

**Organization**: Las tareas están agrupadas por historia para permitir implementarlas y validarlas por fase.

## Phase 1: Setup

**Purpose**: preparar los puntos de edición y las pruebas de la feature.

- [X] T001 Crear el esqueleto de prueba de perfil y sus mocks de Auth/Storage en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T002 [P] Crear el archivo pgTAP de la feature y su fixture multi-tenant en supabase/tests/database/perfil_usuario.test.sql.

---

## Phase 2: Foundational

**Purpose**: crear los datos y controles que bloquean todas las historias.

**CRITICAL**: no iniciar historias hasta completar y verificar esta fase.

- [X] T003 Crear con pnpm supabase migration new perfil_usuario la migración aditiva en supabase/migrations/ para perfiles_usuario, eventos_seguridad_usuario, el bucket privado fotos-perfil, índices, grants y RLS de titular/organización descritos en specs/008-perfil-usuario/data-model.md.
- [X] T004 Completar la misma migración nueva en supabase/migrations/ con el trigger de auth.users para correo/contraseña, el Custom Access Token Hook que excluye token_refresh, y permisos exclusivos de supabase_auth_admin sin ejecución pública.
- [X] T005 Actualizar supabase/config.toml para confirmar solo el correo nuevo, notificar email_changed, permitir retorno al perfil y habilitar localmente el hook configurado en T004.
- [X] T006 Implementar las aserciones pgTAP de RLS de perfiles, eventos y storage.objects, más grants y no exposición del hook, en supabase/tests/database/perfil_usuario.test.sql.
- [X] T007 Ejecutar pnpm dev:supabase y pnpm test:db; corregir la migración nueva en supabase/migrations/ y supabase/tests/database/perfil_usuario.test.sql hasta que el aislamiento, reemplazo y borrado de foto, eventos y hook pasen.

**Checkpoint**: fundación lista; esquema, configuración local y controles de seguridad están verificados.

---

## Phase 3: User Story 1 - Consultar y actualizar datos personales (Priority: P1) MVP

**Goal**: permitir abrir un perfil propio y guardar nombre y apellido válidos.

**Independent Test**: iniciar sesión, abrir perfil, guardar ambos campos, recargar y comprobar persistencia; intentar un campo vacío y comprobar que no se modifica.

- [X] T008 [P] [US1] Escribir los casos de carga, guardado propio, validación de campos vacíos y redirección sin sesión en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T009 [US1] Implementar lectura y upsert exclusivo del titular, estados de carga/error y formulario de nombre/apellido en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T010 [US1] Registrar el recurso y ruta autenticada /cuenta/perfil en apps/web/src/App.tsx.
- [X] T011 [US1] Ejecutar pnpm test:web para apps/web/src/pages/cuenta/perfil.test.tsx y ajustar apps/web/src/pages/cuenta/perfil.tsx hasta cubrir el criterio independiente.

**Checkpoint**: US1 funciona de forma independiente y solo modifica el perfil del titular.

---

## Phase 4: User Story 2 - Identificar la sesión activa en la pantalla general (Priority: P1)

**Goal**: mostrar “Logueado como” y un acceso inequívoco al perfil desde la pantalla general.

**Independent Test**: iniciar sesión con una cuenta conocida, comprobar nombre/apellido o correo y navegar al perfil; cerrar sesión y comprobar que no persiste la identidad.

- [X] T012 [P] [US2] Agregar pruebas de identidad, fallback por correo, navegación y limpieza tras cierre de sesión en apps/web/src/App.test.tsx.
- [X] T013 [US2] Obtener la identidad vigente y renderizar el indicador “Logueado como” con enlace a perfil en apps/web/src/App.tsx.
- [X] T014 [US2] Ajustar el ítem personal de navegación para que “Mi cuenta” lleve a /cuenta/perfil en apps/web/src/App.tsx y preserve la separación de secciones en apps/web/src/components/SiderConSeccionesSuperadmin.tsx.
- [X] T015 [US2] Ejecutar pnpm test:web para apps/web/src/App.test.tsx y verificar manualmente el cierre de sesión con apps/web/src/providers/authProvider.ts.

**Checkpoint**: US2 identifica la sesión activa y no conserva identidad obsoleta.

---

## Phase 5: User Story 3 - Cambiar el correo de acceso (Priority: P2)

**Goal**: solicitar el cambio de correo con contraseña actual y confirmar solo el correo nuevo.

**Independent Test**: verificar contraseña, pedir un correo disponible, confirmar desde Mailpit, iniciar con el correo nuevo y observar el aviso al anterior.

- [X] T016 [P] [US3] Agregar pruebas de contraseña actual, solicitud pendiente, correo duplicado y fallo de Auth en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T017 [US3] Agregar al perfil el formulario de cambio de correo que verifica la contraseña mediante el helper existente y llama a auth.updateUser con retorno seguro en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T018 [US3] Añadir el helper de URL de retorno de perfil y el mapeo de errores de cambio de correo en apps/web/src/lib/supabase.ts.
- [X] T019 [US3] Ejecutar el escenario de correo de specs/008-perfil-usuario/quickstart.md con Supabase local y Mailpit, documentando cualquier ajuste de configuración en supabase/config.toml.

**Checkpoint**: US3 mantiene el correo anterior hasta la confirmación y genera el aviso posterior sin exponer secretos.

---

## Phase 6: User Story 4 - Personalizar la foto e identificar la cuenta (Priority: P2)

**Goal**: gestionar una foto con visibilidad restringida a la organización y ver datos de cuenta no editables.

**Independent Test**: cargar, reemplazar y quitar una foto; verla en el listado de miembros desde otra cuenta de la misma organización y rechazarla desde otra; comprobar correo, fecha, rol y organización de solo lectura.

- [X] T020 [P] [US4] Agregar pruebas de carga válida/inválida, reemplazo, eliminación, fallback neutro y resumen de cuenta en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T021 [US4] Implementar carga, reemplazo y eliminación en el bucket fotos-perfil, validando JPG/PNG/WebP y 2 MiB antes de enviar, en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T022 [US4] Implementar la obtención y presentación de correo, fecha de creación, organización y rol como datos de solo lectura en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T023 [US4] Incorporar foto o representación neutra en el indicador de sesión de apps/web/src/App.tsx sin abrir fotos de otra organización.
- [X] T024 [US4] Resolver desde Storage y presentar la foto autorizada o representación neutra de cada integrante en apps/web/src/pages/miembros/list.tsx, sin consultar perfiles_usuario ajenos ni datos personales adicionales.
- [X] T025 [US4] Agregar a apps/web/src/pages/miembros/list.test.tsx los casos de foto del mismo tenant, fallback neutro y ausencia de consulta a perfiles_usuario ajenos.
- [X] T026 [US4] Ejecutar pnpm test:web y el escenario de foto de specs/008-perfil-usuario/quickstart.md, completando las pruebas de Storage en supabase/tests/database/perfil_usuario.test.sql.

**Checkpoint**: US4 permite al titular gestionar su foto y muestra datos de cuenta sin habilitar cambios de roles u organización.

---

## Phase 7: User Story 5 - Consultar avisos de seguridad (Priority: P3)

**Goal**: mostrar solamente las 20 acciones de seguridad más recientes del titular.

**Independent Test**: iniciar sesión, cambiar contraseña y correo; comprobar los tres tipos de evento y que otra cuenta ni acciones operativas aparecen.

- [X] T027 [P] [US5] Agregar pruebas de orden descendente, límite de 20, tipos permitidos y estado vacío en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T028 [US5] Implementar la consulta y representación de eventos_seguridad_usuario limitada a 20, con tipo y momento, en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T029 [US5] Agregar verificaciones de creación por login/cambio y exclusión de eventos operativos en supabase/tests/database/perfil_usuario.test.sql.
- [X] T030 [US5] Ejecutar los escenarios de actividad de specs/008-perfil-usuario/quickstart.md y revisar los logs de Auth sin registrar secretos en supabase/tests/database/perfil_usuario.test.sql.

**Checkpoint**: US5 muestra solo actividad de seguridad propia, reciente y no administrable.

---

## Phase 8: User Story 6 - Administrar contraseña desde el perfil (Priority: P3)

**Goal**: enlazar la contraseña existente al centro de perfil sin debilitar su flujo.

**Independent Test**: desde perfil abrir cambio, cambiar contraseña válida y verificar que se mantiene la política, la sesión actual y el aviso existentes.

- [X] T031 [P] [US6] Agregar el caso de navegación desde perfil hacia el cambio de contraseña en apps/web/src/pages/cuenta/perfil.test.tsx.
- [X] T032 [US6] Enlazar la sección de contraseña del perfil a /cuenta/cambiar-contrasena en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T033 [US6] Ejecutar apps/web/src/pages/cuenta/cambiar-contrasena.test.tsx y el escenario referenciado de specs/006-autogestion-contrasena/quickstart.md para confirmar que no se alteró el flujo existente.

**Checkpoint**: US6 integra el cambio de contraseña sin modificar sus garantías.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: validar el flujo completo, accesibilidad, documentación y calidad de entrega.

- [X] T034 [P] Revisar mensajes, etiquetas, foco, estados de carga y errores accesibles en apps/web/src/pages/cuenta/perfil.tsx.
- [X] T035 [P] Actualizar los escenarios finales y resultados de validación en specs/008-perfil-usuario/quickstart.md.
- [X] T036 Ejecutar pnpm lint, pnpm build, pnpm infra:config, pnpm test:web y pnpm test:db; corregir solo archivos de apps/web/, supabase/ y specs/008-perfil-usuario/ afectados por la feature.
- [X] T037 Ejecutar de punta a punta specs/008-perfil-usuario/quickstart.md con Supabase local y Mailpit, y registrar el resultado en specs/008-perfil-usuario/quickstart.md.

---

## Dependencies & Execution Order

Setup (T001-T002) → Foundational (T003-T007) → US1 (T008-T011) → US2 (T012-T015) → US3 (T016-T019) → US4 (T020-T026) → US5 (T027-T030) → US6 (T031-T033) → Polish (T034-T037).

US2 necesita que exista la ruta de US1. US3, US4, US5 y US6 reutilizan la pantalla de perfil creada en US1. Cada checkpoint es el corte obligatorio antes de invocar /speckit-implement para la siguiente fase.

## Parallel Opportunities

- T001 y T002 pueden iniciar en paralelo.
- Tras T003-T005, T006 puede desarrollarse mientras se preparan casos Vitest de US1.
- Las pruebas iniciales marcadas [P] se pueden preparar en paralelo; las tareas que editan perfil.tsx se mantienen secuenciales.
- T034 y T035 pueden ejecutarse en paralelo tras completar todas las historias.

## Implementation Strategy

### MVP first

1. Completar Setup y Foundational.
2. Implementar y validar US1, luego US2.
3. Detenerse en el checkpoint de cada fase; usar /clear antes de iniciar la siguiente fase con /speckit-implement.

### Incremental delivery

1. US3 agrega correo seguro.
2. US4 agrega foto y resumen de cuenta.
3. US5 proyecta el historial de seguridad.
4. US6 enlaza el flujo de contraseña ya existente.
5. Finalizar con las validaciones transversales.

## Phase 10: Convergence

- [X] T038 Mostrar nombre y apellido del perfil propio en el indicador de sesion activa, con correo como fallback, y agregar pruebas por FR-012 y US2/AC1 (partial).
- [X] T039 Hacer compensables la carga, reemplazo y eliminacion de foto cuando falle la persistencia de perfil, conservando la foto anterior, y agregar pruebas por FR-014 y US4/AC5 (partial).
