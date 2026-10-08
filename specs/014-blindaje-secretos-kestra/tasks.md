---

description: "Tareas de implementación para blindar secretos en Kestra"
---

# Tareas: Blindaje de secretos en la orquestación

**Input**: Artefactos de diseño en `/specs/014-blindaje-secretos-kestra/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/ejecucion-segura.md` y `quickstart.md`.

**Tests**: Se incluyen porque FR-008 exige demostrar con una credencial
centinela que no persiste en los canales operativos.

**Organización**: Las tareas se agrupan por historia para implementar y validar
un incremento completo antes de avanzar.

## Formato: `[ID] [P?] [Historia] Descripción`

- **[P]**: puede ejecutarse en paralelo si no modifica los mismos archivos.
- **[USn]**: historia de usuario a la que aporta la tarea.
- Cada tarea contiene la ruta exacta del archivo afectado.

## Fase 1: Preparación

**Propósito**: Preparar los artefactos de prueba y configuración segura sin
introducir valores secretos versionados.

- [X] T001 [P] Crear el arnés de regresión de flows con centinela y variantes literal/URL/Base64 en `infra/kestra/test-secretos-orquestacion.ps1`.
- [X] T002 [P] Documentar el placeholder sin valor real `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` y su codificación Base64 en `.env.example`.

**Checkpoint**: El arnés y la configuración de ejemplo existen, no contienen
secretos reales y la prueba falla contra las plantillas vulnerables actuales.

---

## Fase 2: Fundacional — acceso efímero y mínimo privilegio

**Propósito**: Crear el único canal por el que un worker puede obtener la
credencial de su propia organización, sin exponerla a Kestra.

**⚠️ CRÍTICO**: No iniciar trabajo de historias hasta completar esta fase.

- [X] T003 Crear una migración aditiva con reversión explícita para el rol de grupo `workers_orquestacion`, membresía de cada `worker_<organizacion_id>` y `private.obtener_credencial_para_worker(uuid)` en `supabase/migrations/<timestamp>_blindaje_secretos_orquestacion.sql`.
- [X] T004 Ajustar `public.aprovisionar_servidor_organizacion` en `supabase/migrations/<timestamp>_blindaje_secretos_orquestacion.sql` para agregar el rol dinámico de cada worker a `workers_orquestacion` sin otorgar acceso a Kestra.
- [X] T005 Extender las pruebas pgTAP de permisos, pertenencia y aislamiento cruzado de `private.obtener_credencial_para_worker(uuid)` en `supabase/tests/database/orquestacion_multi_organizacion.test.sql`.

**Checkpoint**: `pnpm test:db` demuestra que únicamente el worker propietario
puede recuperar su conexión; `kestra_orquestacion`, `anon`, `authenticated` y
otro worker quedan rechazados y sin `SELECT` directo a Vault o conexiones.

---

## Fase 3: User Story 1 — ejecutar sin persistir secretos (Prioridad: P1) 🎯 MVP

**Objetivo**: Despachar workers sin credenciales en outputs, comandos
renderizados, logs ni archivos temporales de Kestra.

**Prueba independiente**: Ejecutar ambas plantillas con una credencial
centinela y verificar cero ocurrencias de su valor literal, URL-encoded y
Base64 en los artefactos accesibles de Kestra.

- [X] T006 [P] [US1] Añadir aserciones que detecten tareas de obtención de credencial, interpolaciones `CREDENCIAL` y referencias a outputs sensibles en `infra/kestra/test-secretos-orquestacion.ps1`.
- [X] T007 [US1] Reemplazar las tareas `obtener_credencial_*`, la contraseña SSH dinámica y `-e CREDENCIAL` por el despacho no sensible y `secret('ORQUESTACION_SSH_PRIVATE_KEY')` en `infra/kestra/flows/plantilla-generico.yml`.
- [X] T008 [P] [US1] Aplicar el mismo despacho no sensible y autenticación SSH por secreto estático en `infra/kestra/flows/plantilla-dedicado.yml`.
- [X] T009 [US1] Exponer `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` al proceso Kestra mediante el prefijo `ENV_` sin valores reales en `infra/kestra/compose.yaml`.
  - Desvío: la descripción de esta tarea decía prefijo `ENV_`, pero es
    incorrecto — `secret()` de Kestra lee directo `SECRET_*` sin ese prefijo
    (a diferencia de `envs.*`, que sí lo necesita). La implementación en
    `compose.yaml` quedó bien desde el principio; el error era solo de este
    enunciado, no del código.
- [X] T010 [US1] Actualizar el contrato de workers para obtener la credencial por `private.obtener_credencial_para_worker(CONEXION_ID)`, descartarla tras su uso y redactor literal/URL/Base64 antes de stdout/stderr en `workers/README.md`.
- [X] T011 [US1] Ejecutar la regresión de plantillas y corregir sus fixtures en `infra/kestra/test-secretos-orquestacion.ps1` hasta que ambas plantillas no tengan canales de secreto persistible.

**Checkpoint**: US1 funciona de forma independiente: el worker recibe la
credencial solo en su proceso y los flows genérico y dedicado no la resuelven
ni la registran en Kestra.

---

## Fase 4: User Story 2 — conservar diagnóstico sanitizado (Prioridad: P2)

**Objetivo**: Clasificar fallas técnicas y de credencial con contexto útil, sin
reenviar `errorLogs()` ni valores secretos a alertas o a la base de datos.

**Prueba independiente**: Provocar una falla técnica y una de credencial;
verificar organización, conexión, intento, tipo y motivo sanitizado en el
historial y en `alertas`, con cero ocurrencias del centinela y sus variantes.

- [X] T012 [P] [US2] Agregar casos pgTAP para el handler de fallo clasificado que preserven tipo y motivo sanitizado sin almacenar una credencial en `supabase/tests/database/orquestacion_multi_organizacion.test.sql`.
- [X] T013 [US2] Crear o actualizar el handler SQL con tipo explícito, motivo sanitizado y reversión documentada en `supabase/migrations/<timestamp>_blindaje_secretos_orquestacion.sql`.
- [X] T014 [US2] Sustituir el envío de `errorLogs()` por clasificación y motivo seguro explícitos en `infra/kestra/flows/plantilla-generico.yml`.
  - Desvío: la primera implementación llamaba `errorLogs()` directo en el
    `condition` de `clasificar_y_alertar` (un `If`, Flowable) — Kestra 1.3.35
    lo rechaza en runtime porque `errorLogs()` solo puede evaluarse en una
    tarea de Worker. Además `errorLogs() contains 'CREDENCIAL_INVALIDA:'`
    comparaba la marca contra una lista de objetos de log, no contra su
    texto, así que nunca clasificaba como `credencial`. Corregido con una
    tarea `Return` previa que concatena `log.message` y expone el resultado
    para que el `If` lo lea desde `outputs`.
- [X] T015 [US2] Sustituir el envío de `errorLogs()` por clasificación y motivo seguro explícitos en `infra/kestra/flows/plantilla-dedicado.yml`.
  - Desvío: mismo problema y mismo fix que T014.
- [X] T016 [US2] Adaptar el contrato de entrada de alertas para aceptar solamente motivo sanitizado y conservar tipo, organización y conexión en `infra/kestra/flows/alertas.yml`.
- [X] T017 [US2] Ejecutar los casos de clasificación y sanitización definidos en `supabase/tests/database/orquestacion_multi_organizacion.test.sql`.

**Checkpoint**: US1 y US2 funcionan: credencial inválida y falla técnica se
distinguen sin que Kestra, alertas o los logs persistan el secreto.

---

## Fase 5: Cierre y validación transversal

**Propósito**: Probar el recorrido completo, incluyendo reintentos y
concurrencia, y documentar evidencia reproducible.

- [X] T018 Ejecutar el recorrido local con centinela, éxito, falla técnica, falla de credencial, reintento y dos organizaciones según `specs/014-blindaje-secretos-kestra/quickstart.md`.
- [X] T019 Buscar el centinela y sus variantes en outputs, logs, errores, metadatos, archivos temporales e `alertas` y registrar el resultado cero apariciones en `specs/014-blindaje-secretos-kestra/quickstart.md`.
- [X] T020 Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config` y `pnpm test` conforme a `specs/014-blindaje-secretos-kestra/quickstart.md`.
- [X] T021 Verificar el diff de la migración, su camino de reversión y la ausencia de secretos con `git diff --check` para `supabase/migrations/<timestamp>_blindaje_secretos_orquestacion.sql`.

**Checkpoint**: Las validaciones requeridas pasan, no se versionó ningún
secreto y la evidencia cubre SC-001 a SC-004.

---

## Dependencias y orden de ejecución

```text
Fase 1 → Fase 2 → US1 (Fase 3) → US2 (Fase 4) → Fase 5
```

- **US1** depende del acceso efímero de la Fase 2.
- **US2** depende de US1: el flujo ya no debe transportar secretos antes de
  clasificar y persistir diagnósticos.
- **Fase 5** depende de ambas historias.

## Oportunidades de paralelismo

- T001 y T002 pueden ejecutarse en paralelo.
- T006 puede ejecutarse mientras termina la migración de Fase 2; sus aserciones
  iniciales deben fallar contra los flows existentes.
- Tras T003-T005, T008 y T010 pueden avanzar en paralelo con T007 porque
  modifican archivos distintos.
- T012 puede empezar antes de T013; T014 y T015 pueden hacerse en paralelo una
  vez definido el contrato de handler de T013.

## Estrategia de implementación

### MVP: US1

1. Completar Fases 1 y 2.
2. Completar T006-T011.
3. Detenerse en el checkpoint de US1 y ejecutar su prueba independiente.

### Entrega incremental

1. Añadir US2 con T012-T017 y validar la clasificación sanitizada.
2. Ejecutar el recorrido y quality gates de la Fase 5.
3. No iniciar otra fase con `$speckit-implement` sin pedirla explícitamente.

---

## Phase 6: Convergence

- [X] T022 Completar `infra/kestra/validar-secretos-e2e.ps1` para disparar las tres ejecuciones (éxito, falla técnica, falla de credencial con reintento) vía la API de Kestra, exportar sus outputs y logs a un directorio, e invocar `infra/kestra/test-secretos-orquestacion.ps1 -ArtifactDirectory` con `CREDENCIAL_CENTINELA` para demostrar de forma automatizada cero apariciones del centinela per FR-008 (partial)
  - Desvío: el script quedó bloqueado por varios problemas de entorno/Windows
    ajenos al gap original — `SECRET_ORQUESTACION_SSH_PRIVATE_KEY` nunca
    estaba en `infra/kestra/.env` (se agregó una clave de desarrollo local),
    `ssh-keygen` de Windows rechaza una clave con ACL heredada, y sobre todo
    un `return @(array)` de un solo elemento se "desenrolla" a escalar al
    cruzar el límite de una función de PowerShell — `[0]` indexaba caracteres
    de un string en vez de elementos de un array. Ver commit de esta tarea
    para el detalle de cada fix.
