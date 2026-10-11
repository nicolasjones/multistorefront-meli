# Feature Specification: Endpoint `/health` en apps/web con validación E2E

**Feature Branch**: `epic/MSF-5-test-e2e-endpoint-health-en-apps-web`

**Jira Epic**: MSF-5 — `[TEST-E2E] Endpoint /health en apps/web`

**Created**: 2026-10-11

**Status**: Draft — NEEDS_INFO (ver preguntas al final; no se generaron `plan.md` ni `tasks.md` hasta resolverlas)

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
4. **Given** una respuesta exitosa de `/health`, **When** se inspecciona su cuerpo, **Then** incluye un identificador del build desplegado (ver pregunta de clarificación FR-003) que permite confirmar qué versión respondió.

---

### User Story 2 - Bloquear el pipeline cuando un despliegue de apps/web queda roto (Priority: P2)

Como equipo de plataforma, cuando se despliega apps/web, quiero que una prueba E2E automatizada (Playwright) consulte `/health` contra el entorno real recién desplegado dentro del pipeline de CI en el runner self-hosted, para que un despliegue roto se detecte solo, sin esperar a que alguien lo note manualmente ni a que un usuario reporte el problema.

**Why this priority**: Depende de que exista `/health` (Historia 1), pero es la que entrega el valor real del epic — "[TEST-E2E]" implica automatización de punta a punta, no solo la existencia de la ruta.

**Independent Test**: Se puede probar rompiendo deliberadamente el build de apps/web (o apuntando la prueba a una URL que no responde) y verificando que el job de la prueba E2E falla y así lo refleja en la pestaña de Actions, sin intervención manual.

**Acceptance Scenarios**:

1. **Given** un despliegue de apps/web recién completado, **When** corre la prueba E2E de `/health` en el runner self-hosted, **Then** el job termina en éxito si `/health` respondió correctamente dentro del tiempo límite definido.
2. **Given** un despliegue de apps/web que quedó roto (build corrupto, sitio no responde o responde con error), **When** corre la prueba E2E de `/health`, **Then** el job termina en fallo y queda visible en la pestaña de Actions, sin bloquear silenciosamente el resto del pipeline de otros componentes.
3. **Given** que el despliegue todavía está propagándose (condición de carrera conocida de Vercel/CDN), **When** corre la prueba E2E inmediatamente después, **Then** la prueba reintenta dentro de un tiempo límite razonable antes de reportar fallo, en vez de fallar por una carrera que no refleja un despliegue realmente roto.
4. **Given** que la prueba E2E falló, **When** se revisan los logs/artefactos del job en CI, **Then** el motivo del fallo es diagnosticable (código de estado, tiempo de espera agotado, cuerpo inesperado) sin exponer secretos ni credenciales.

---

### Edge Cases

- ¿Qué pasa si el runner self-hosted no tiene salida de red hacia la URL pública donde se desplegó apps/web (preview o producción)? La prueba debe fallar con un error de red diagnosticable, no quedarse colgada indefinidamente.
- ¿Qué pasa si `/health` queda capturado por la reescritura `vercel.json` (`/(.*)` → `/index.html`) y termina devolviendo el shell de la SPA en vez de una señal dedicada? Debe tratarse como requisito explícito a resolver en `/speckit-plan`, no como un detalle de implementación menor — hoy esa regla captura cualquier ruta no listada antes.
- ¿Qué pasa si alguien agrega sesión/guard de Refine (`accessControlProvider`) a futuro de forma genérica para todas las rutas? `/health` debe quedar explícitamente excluido para no convertirse en un falso negativo del monitor de salud.
- ¿Qué pasa si la prueba E2E corre contra un entorno que todavía no tiene URL pública asignada (por ejemplo, un preview que Vercel no terminó de generar)? Debe fallar con un mensaje claro de "no se pudo resolver la URL del entorno", no interpretarse como que `/health` respondió mal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer una ruta pública `/health` en apps/web, accesible sin autenticación ni contexto de organización activa.
- **FR-002**: La respuesta de `/health` DEBE ser exitosa y determinística de forma independiente a que el bundle de JavaScript de la SPA cargue o se ejecute correctamente en el navegador.
- **FR-003**: La respuesta de `/health` DEBE incluir un identificador verificable del build/versión desplegado actualmente, para distinguir una respuesta "viva pero vieja" de un despliegue nuevo exitoso. [NEEDS CLARIFICATION: ¿qué identificador debe llevar — commit SHA del deploy, versión semántica del `package.json`, timestamp de build, o el ID de deployment de Vercel? La elección determina qué pipeline o paso de build debe inyectar ese valor.]
- **FR-004**: El sistema DEBE ejecutar automáticamente una prueba E2E (Playwright) que consulte `/health` contra el entorno real desplegado, dentro del pipeline de CI y en el runner self-hosted ya usado por el resto del proyecto (no en runners alojados por GitHub). [NEEDS CLARIFICATION: ¿contra qué entorno(s) corre esta prueba — el Preview de Vercel de cada Pull Request, el entorno de staging post-deploy, producción post-promoción, o varios de estos? Cambia el disparador del workflow (`pull_request` vs `deployment_status` vs `workflow_dispatch`) y qué URL debe resolver la prueba en cada caso.]
- **FR-005**: La prueba E2E DEBE hacer fallar el job de CI correspondiente (visible en la pestaña de Actions) cuando `/health` no responda con la señal de éxito esperada dentro de un tiempo límite definido, sin bloquear silenciosamente otros jobs del pipeline que no dependen de apps/web.
- **FR-006**: La prueba E2E DEBE tolerar la propagación asíncrona de un despliegue reciente (reintentos acotados dentro de un tiempo límite) antes de reportar un fallo, para no confundir una condición de carrera del propio pipeline con un despliegue realmente roto.
- **FR-007**: El sistema NO DEBE requerir credenciales de Supabase, Kestra, Superset ni ningún otro servicio para que `/health` responda exitosamente — la señal de vida de apps/web debe ser independiente de la disponibilidad de sus dependencias downstream.
- **FR-008**: El diagnóstico de un fallo de la prueba E2E (logs/artefactos del job) DEBE ser legible por un operador sin exponer secretos ni credenciales, consistente con la convención ya vigente del proyecto para otros mecanismos de CI.

### Key Entities

- **Señal de salud (`/health`)**: respuesta pública y determinística de apps/web; atributos relevantes: código de estado, identificador de build/versión (ver FR-003), tiempo de respuesta.
- **Ejecución de prueba E2E**: corrida del job de Playwright contra un entorno real; atributos relevantes: entorno objetivo (ver FR-004), resultado (éxito/fallo), motivo de fallo cuando aplica, timestamp.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cualquier persona u monitor externo puede confirmar que apps/web está activo consultando una única URL pública, sin iniciar sesión, con respuesta en menos de 2 segundos en condiciones normales.
- **SC-002**: El 100% de los despliegues de apps/web cubiertos por esta spec quedan validados automáticamente por la prueba E2E antes de considerarse exitosos, sin ningún paso manual de verificación.
- **SC-003**: Un despliegue roto de apps/web (build corrupto o sitio sin responder) queda reflejado como fallo visible en el pipeline de CI sin que ningún usuario final tenga que reportarlo primero.
- **SC-004**: En una ventana de al menos 10 ejecuciones consecutivas de la prueba E2E contra despliegues sanos, cero fallos son atribuibles a condiciones de carrera del propio pipeline (consultar antes de que el despliegue esté listo).

## Assumptions

- apps/web continúa siendo una SPA estática (Vite) sin backend propio; esta spec no introduce un servidor persistente nuevo — `/health` se resuelve con el mecanismo más simple posible compatible con Vercel (decisión de implementación para `/speckit-plan`).
- La verificación de `/health` es de disponibilidad superficial ("el sitio responde"), no una verificación profunda de dependencias downstream (Supabase, Kestra, Superset) — así lo fija explícitamente FR-007, consistente con el principio de simplicidad operativa de la constitución del proyecto.
- El runner self-hosted (`infra/runner/`) que ya ejecuta el resto del CI del proyecto tiene salida de red saliente hacia las URLs públicas de Vercel (preview y producción). Si esa salida no existe, `/speckit-plan` debe investigarlo igual que lo hizo la spec `20261003-105444-cicd-staging-produccion` para la conectividad hacia el VPS.
- Esta spec no reemplaza ni modifica el gate manual staging→producción ya definido en `specs/20261003-105444-cicd-staging-produccion/`; se integra como una verificación adicional de apps/web, no como un nuevo mecanismo de promoción entre entornos.
- `/health` no requiere autenticación y su cuerpo no debe filtrar información sensible (URLs internas, nombres de servicios downstream, secretos) — solo una señal de vida y un identificador de build no sensible.
- El único Playwright existente hoy en el repositorio (`infra/playwright/`) es un servidor de navegador remoto para automatización de IA, no una suite de pruebas E2E; esta spec es la primera en introducir una suite Playwright E2E real para apps/web, por lo que `/speckit-plan` parte sin un arnés de pruebas E2E previo que reutilizar.

## Trazabilidad Jira ↔ Historias de usuario ↔ Tareas (borrador, pendiente de confirmación)

> Las tareas (`T0xx`) todavía no existen — `tasks.md` depende de `plan.md`, y `plan.md` depende de resolver las preguntas de clarificación de abajo. Esta tabla muestra la relación **prevista** (1 epic : N historias; cada historia : N tareas) para que quede visible desde ahora, no una matriz final.

| Jira | Relación | Historia de usuario | Relación | Tareas previstas |
|---|---|---|---|---|
| MSF-5 (epic) | 1:N | US1 — Confirmar que apps/web está activo (P1) | 1:N | Pendiente de `/speckit-plan` + `/speckit-tasks` |
| MSF-5 (epic) | 1:N | US2 — Bloquear el pipeline ante un despliegue roto (P2) | 1:N | Pendiente de `/speckit-plan` + `/speckit-tasks` |
| **NEEDS_INFO** — sin sub-tarea Jira confirmada bajo MSF-5 | N/A | (ambas historias podrían mapear a una sola sub-tarea Jira, o a una por historia — N:1 o 1:1 según cómo se descomponga en Jira) | N/A | N/A |

## Open Questions (bloquean `/speckit-plan` y `/speckit-tasks`)

1. **[Jira] ¿Existen ya sub-tareas/historias de Jira creadas bajo el epic MSF-5?** No tengo acceso a Jira en esta sesión (conector no autorizado) y no encontré ninguna referencia a `MSF-` en el repositorio. Sin esto, la matriz de trazabilidad Jira↔US↔tareas no puede completarse con claves reales — necesito o bien las claves existentes, o confirmación de que debo proponerlas yo (y en qué sistema quedan registradas).
2. **[Alcance] ¿Contra qué entorno(s) corre la prueba E2E (FR-004)?** Preview de cada PR, staging post-deploy, producción post-promoción, o varios — determina el disparador del workflow y si hace falta resolver una URL de preview dinámica vía API de Vercel/GitHub.
3. **[Contrato de respuesta] ¿Qué identificador de build debe llevar `/health` (FR-003)?** Commit SHA, versión semántica, timestamp de build o deployment ID de Vercel — determina qué paso de build lo inyecta y el formato exacto de la respuesta.
4. **[Mecanismo] ¿`/health` debe ser un archivo estático servido directamente (sin pasar por el shell de React) o alcanza con una ruta de React Router que renderice un cuerpo fijo?** Afecta si hace falta ajustar la reescritura de `vercel.json` (hoy `/(.*)` → `/index.html` captura todo) y si la señal depende de que el bundle de JS cargue.
5. **[CI] ¿Esta prueba E2E debe integrarse al mismo mecanismo de gate staging→producción de `specs/20261003-105444-cicd-staging-produccion/` (bloquea promoción si falla) o es una verificación independiente que solo reporta/alerta sin bloquear otros despliegues?**

**NEEDS_INFO**
