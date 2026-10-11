# Feature Specification: Endpoint `/health` en apps/web con validación E2E

**Feature Branch**: `epic/MSF-5-test-e2e-endpoint-health-en-apps-web`

**Jira Epic**: MSF-5 — `[TEST-E2E] Endpoint /health en apps/web`

**Created**: 2026-10-11

**Status**: Ready for implementation — clarificaciones resueltas el 2026-10-11 (ver sección Clarifications); `plan.md` y `tasks.md` generados

**Delivery scope**: refine

**Input**: User description: "Epic MSF-5: [TEST-E2E] Endpoint /health en apps/web. Como plataforma de automatización multi-tenant (Refine + Vercel), necesitamos un endpoint /health en apps/web que sirva como señal de vida verificable, y una prueba E2E (Playwright) automatizada que lo valide contra un entorno real (preview o staging) dentro del pipeline de CI en el runner self-hosted. Hoy apps/web es una SPA estática (Vite) sin backend propio, con vercel.json reescribiendo todo a index.html, por lo que no existe ningún endpoint /health ni ninguna suite Playwright E2E para apps/web."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirmar que apps/web está activo con una sola consulta (Priority: P1)

Como operador de la plataforma (o un monitor externo de disponibilidad), cuando consulto la ruta pública `/health` de apps/web, quiero recibir de inmediato una señal determinística de que el sitio responde — sin iniciar sesión, sin depender de que el bundle de JavaScript de React termine de cargar y sin que la respuesta dependa de la disponibilidad de Supabase, Kestra u otro servicio downstream.

**Why this priority**: Es la pieza mínima indispensable — sin una ruta `/health` real, no hay nada que una prueba E2E pueda validar. Punto de partida obligatorio del epic.

**Independent Test**: Se puede probar desplegando apps/web y haciendo una petición HTTP directa a `/health` (por ejemplo con `curl`), sin abrir el navegador ni autenticarse, y verificando que responde con éxito y un cuerpo determinístico.

**Acceptance Scenarios**:

1. **Given** apps/web desplegado (local, preview o producción), **When** se solicita `/health` sin sesión iniciada, **Then** la respuesta es exitosa (2xx) y determinística, sin redirigir a la pantalla de login.
2. **Given** que el bundle de JavaScript de la SPA está roto o tarda en cargar, **When** se solicita `/health`, **Then** la respuesta exitosa llega igual, porque no depende de que React se monte en el navegador.
3. **Given** que Supabase, Kestra o Superset no están disponibles en ese momento, **When** se solicita `/health`, **Then** la respuesta sigue siendo exitosa — `/health` certifica que apps/web está activo, no que sus dependencias downstream lo estén.
4. **Given** una respuesta exitosa de `/health`, **When** se inspecciona su cuerpo, **Then** incluye un identificador del build desplegado (commit SHA, ver FR-003) que permite confirmar qué versión respondió.

---

### User Story 2 - Detectar automáticamente un despliegue roto de apps/web en staging (Priority: P2)

Como equipo de plataforma, cuando se despliega apps/web, quiero que una prueba E2E automatizada (Playwright) consulte `/health` contra el entorno real recién desplegado dentro del pipeline de CI en el runner self-hosted, para que un despliegue roto se detecte solo, sin esperar a que alguien lo note manualmente ni a que un usuario reporte el problema.

**Why this priority**: Depende de que exista `/health` (Historia 1), pero es la que entrega el valor real del epic — "[TEST-E2E]" implica automatización de punta a punta, no solo la existencia de la ruta.

**Independent Test**: Se puede probar apuntando la prueba a una URL que no responde o a un SHA que no coincide y verificando que el job de la prueba E2E falla y así lo refleja en la pestaña de Actions, sin intervención manual.

**Acceptance Scenarios**:

1. **Given** un despliegue de apps/web recién completado, **When** corre la prueba E2E de `/health` en el runner self-hosted, **Then** el job termina en éxito si `/health` respondió correctamente dentro del tiempo límite definido.
2. **Given** un despliegue de apps/web que quedó roto (build corrupto, sitio no responde o responde con error), **When** corre la prueba E2E de `/health`, **Then** el job termina en fallo y queda visible en la pestaña de Actions, sin bloquear la promoción a producción ni otros componentes.
3. **Given** que el despliegue todavía está propagándose (condición de carrera conocida de Vercel/CDN), **When** corre la prueba E2E inmediatamente después, **Then** la prueba reintenta dentro de un tiempo límite razonable antes de reportar fallo, en vez de fallar por una carrera que no refleja un despliegue realmente roto.
4. **Given** que la prueba E2E falló, **When** se revisan los logs/artefactos del job en CI, **Then** el motivo del fallo es diagnosticable (código de estado, tiempo de espera agotado, cuerpo inesperado) sin exponer secretos ni credenciales.

---

### Edge Cases

- ¿Qué pasa si el runner self-hosted no tiene salida de red hacia la URL pública donde se desplegó apps/web (staging)? La prueba debe fallar con un error de red diagnosticable, no quedarse colgada indefinidamente.
- ¿Qué pasa si `/health` queda capturado por la reescritura `vercel.json` (`/(.*)` → `/index.html`) y termina devolviendo el shell de la SPA en vez de una señal dedicada? Debe tratarse como requisito explícito a resolver en `/speckit-plan`, no como un detalle de implementación menor — hoy esa regla captura cualquier ruta no listada antes.
- ¿Qué pasa si alguien agrega sesión/guard de Refine (`accessControlProvider`) a futuro de forma genérica para todas las rutas? `/health` debe quedar explícitamente excluido para no convertirse en un falso negativo del monitor de salud.
- ¿Qué pasa si la prueba E2E corre contra un entorno que todavía no tiene URL pública asignada (variable de URL de staging sin definir)? Debe fallar con un mensaje claro de "no se pudo resolver la URL del entorno", no interpretarse como que `/health` respondió mal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer una ruta pública `/health` en apps/web, accesible sin autenticación ni contexto de organización activa.
- **FR-002**: La respuesta de `/health` DEBE ser exitosa y determinística de forma independiente a que el bundle de JavaScript de la SPA cargue o se ejecute correctamente en el navegador.
- **FR-003**: La respuesta de `/health` DEBE incluir un identificador verificable del build/versión desplegado actualmente, para distinguir una respuesta "viva pero vieja" de un despliegue nuevo exitoso. El identificador es el **commit SHA** del build, inyectado en tiempo de build (ver Clarifications).
- **FR-004**: El sistema DEBE ejecutar automáticamente una prueba E2E (Playwright) que consulte `/health` contra el entorno real desplegado, dentro del pipeline de CI y en el runner self-hosted ya usado por el resto del proyecto (no en runners alojados por GitHub). La prueba corre únicamente contra **staging post-deploy**, con una URL fija configurada (sin resolver previews dinámicos de Vercel).
- **FR-005**: La prueba E2E DEBE hacer fallar su propio job de CI (visible en la pestaña de Actions) cuando `/health` no responda con la señal de éxito esperada, o con un SHA distinto al desplegado, dentro de un tiempo límite definido. Es una verificación independiente que solo reporta: NO bloquea la promoción a producción ni otros jobs.
- **FR-006**: La prueba E2E DEBE tolerar la propagación asíncrona de un despliegue reciente (reintentos acotados dentro de un tiempo límite) antes de reportar un fallo, para no confundir una condición de carrera del propio pipeline con un despliegue realmente roto.
- **FR-007**: El sistema NO DEBE requerir credenciales de Supabase, Kestra, Superset ni ningún otro servicio para que `/health` responda exitosamente — la señal de vida de apps/web debe ser independiente de la disponibilidad de sus dependencias downstream.
- **FR-008**: El diagnóstico de un fallo de la prueba E2E (logs/artefactos del job) DEBE ser legible por un operador sin exponer secretos ni credenciales, consistente con la convención ya vigente del proyecto para otros mecanismos de CI.

### Key Entities

- **Señal de salud (`/health`)**: respuesta pública y determinística de apps/web; atributos relevantes: código de estado, commit SHA (ver FR-003), tiempo de respuesta.
- **Ejecución de prueba E2E**: corrida del job de Playwright contra un entorno real; atributos relevantes: entorno objetivo (staging, ver FR-004), resultado (éxito/fallo), motivo de fallo cuando aplica, timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cualquier persona u monitor externo puede confirmar que apps/web está activo consultando una única URL pública, sin iniciar sesión, con respuesta en menos de 2 segundos en condiciones normales.
- **SC-002**: El 100% de los despliegues de apps/web cubiertos por esta spec quedan validados automáticamente por la prueba E2E antes de considerarse exitosos, sin ningún paso manual de verificación.
- **SC-003**: Un despliegue roto de apps/web (build corrupto o sitio sin responder) queda reflejado como fallo visible en el pipeline de CI sin que ningún usuario final tenga que reportarlo primero.
- **SC-004**: En una ventana de al menos 10 ejecuciones consecutivas de la prueba E2E contra despliegues sanos, cero fallos son atribuibles a condiciones de carrera del propio pipeline (consultar antes de que el despliegue esté listo).

## Assumptions

- apps/web continúa siendo una SPA estática (Vite) sin backend propio; esta spec no introduce un servidor persistente nuevo — `/health` se resuelve con el mecanismo más simple posible compatible con Vercel (decisión de implementación para `/speckit-plan`).
- La verificación de `/health` es de disponibilidad superficial ("el sitio responde"), no una verificación profunda de dependencias downstream (Supabase, Kestra, Superset) — así lo fija explícitamente FR-007, consistente con el principio de simplicidad operativa de la constitución del proyecto.
- El runner self-hosted (`infra/runner/`) que ya ejecuta el resto del CI del proyecto tiene salida de red saliente hacia la URL pública de staging en Vercel. Si esa salida no existe, `/speckit-plan` debe investigarlo igual que lo hizo la spec `20261003-105444-cicd-staging-produccion` para la conectividad hacia el VPS.
- Esta spec no reemplaza ni modifica el gate manual staging→producción ya definido en `specs/20261003-105444-cicd-staging-produccion/`; se integra como una verificación adicional de apps/web, no como un nuevo mecanismo de promoción entre entornos.
- `/health` no requiere autenticación y su cuerpo no debe filtrar información sensible (URLs internas, nombres de servicios downstream, secretos) — solo una señal de vida y un identificador de build no sensible.
- El único Playwright existente hoy en el repositorio (`infra/playwright/`) es un servidor de navegador remoto para automatización de IA, no una suite de pruebas E2E; esta spec es la primera en introducir una suite Playwright E2E real para apps/web, por lo que `/speckit-plan` parte sin un arnés de pruebas E2E previo que reutilizar.

## Clarifications

Respuestas de Nicolás en Jira (2026-10-11), que cierran las 5 preguntas abiertas:

- **Historias Jira**: no existían; se crean al aprobar la spec, una por historia (US1 → STORY-1, US2 → STORY-2). Hasta entonces las claves son marcadores `STORY-1`/`STORY-2`.
- **Entorno**: solo staging post-deploy, URL fija (variable de repositorio `WEB_STAGING_URL`), sin resolver previews dinámicos.
- **Identificador de build**: commit SHA inyectado en build.
- **Mecanismo**: archivo estático servido directo, sin depender de React; el rewrite de `vercel.json` se resuelve en el plan.
- **CI**: verificación independiente que solo reporta; no se integra al gate de promoción.

## Trazabilidad Jira ↔ Historias de usuario ↔ Tareas

| Jira | US | Rel. Jira→US | Tareas | Rel. US→tareas |
|---|---|---|---|---|
| MSF-5 (epic) | US1, US2 | 1:N | — | — |
| STORY-1 (por crear) | US1 — `/health` (P1) | 1:1 | T001–T005 | 1:N |
| STORY-2 (por crear) | US2 — E2E en staging (P2) | 1:1 | T006–T011 | 1:N |

Cobertura: FR-001/002/003/007 → US1; FR-004/005/006/008 → US2. Detalle en `tasks.md`.
