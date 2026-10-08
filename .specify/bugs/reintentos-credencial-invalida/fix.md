# Bug Fix: los flows plantilla reintentan un worker con credencial inválida

- **Slug**: reintentos-credencial-invalida
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Una falla no reintentable del worker (código `78`, o la marca
`CREDENCIAL_INVALIDA:` de workers anteriores al contrato) ya no dispara el
`retry` de `despacho_ssh`: el paso termina en `0` con el output
`no_reintentable` y la tarea JDBC siguiente falla con `<MOTIVO>:<conexion_id>`
en un solo intento. El worker puede verificar que su ejecución siga en curso
antes de abrir el navegador. Las fallas técnicas conservan sus 3 intentos.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `infra/kestra/flows/plantilla-generico.yml` | modified | Captura `WORKER_RC`/`WORKER_STDERR`, publica `no_reintentable`; `marcar_conexion_activa` → `resolver_resultado_despacho`; nota outbox (`agotar`). |
| `infra/kestra/flows/plantilla-dedicado.yml` | modified | Lo mismo, más input opcional `ejecucion_id` → `EJECUCION_ID`. |
| `supabase/migrations/20260925200000_ejecucion_en_curso_worker.sql` | added | Aditiva. `private.estado_ejecucion_vigente` (sin grants), `private.ejecucion_worker_en_curso` (grant `workers_orquestacion`) y `private.resolver_resultado_despacho` (grant `kestra_orquestacion`). Reversión documentada en el archivo. |
| `infra/kestra/fixtures/worker/entrypoint.sh` | modified | Verifica `en_curso` con `EJECUCION_ID`; credencial inválida sale `78`; caso `fixture-tecnica-cierra` (reproduce Xubio). |
| `infra/kestra/fixtures/worker-runtime/*`, `validar-workers-runtime.mjs` | modified | `invalid-credential` sale `78`. |
| `workers/CONTRATO.md` | modified | "Códigos de salida y reintentos" y "Ejecución en curso antes de actuar". |
| `docs/adoptar-ciclo-ejecuciones.md` | modified | Sección 3.3 de adopción (`worker-execution-cycle` 1.2.0). |
| `template-capabilities.json`, `template-adoption.json` | modified | `worker-execution-cycle` 1.2.0 (+ ruta de la migración), `worker-image-security` 1.0.2 (comparte `workers/CONTRATO.md`). |
| `package.json` | modified | `test:kestra:reintentos` y `test:kestra:reintentos:e2e`. |
| `infra/kestra/validar-reintentos-flows.test.mjs` | added test | Contrato estático. |
| `supabase/tests/database/ejecucion_en_curso_worker.test.sql` | added test | pgTAP, 21 pruebas. |
| `infra/kestra/validar-reintentos-e2e.mjs` | added test | Validación real en el Kestra del template. |

## Tests Added or Updated

- `validar-reintentos-flows.test.mjs` — retry técnico conservado; captura de
  código/stderr; 78 o marca → output y `exit 0`; motivos de lista cerrada;
  `resolver_resultado_despacho` sin retry y única tarea posterior a
  `despacho_ssh` (sin `Fail`/`Assert`); nota outbox `agotar`.
- `ejecucion_en_curso_worker.test.sql` — vigencia por estado y por
  `tiempo_max_seg`, solo lectura, rechazo de no-workers, grants exactos;
  `resolver_resultado_despacho` marca activa sin motivo, falla con la marca
  sin tocar la conexión y rechaza motivos fuera de lista.
- `validar-reintentos-e2e.mjs` — genérico y dedicado con credencial inválida
  (1 intento, 1 lanzamiento del worker); técnica que cierra su ejecución
  (reintento sin nuevo login); éxito con `EJECUCION_ID` en curso; worker de
  otra organización rechazado; técnica pura con 3 intentos.

## Local Verification

Stack de desarrollo del template (Kestra `:8082`, Supabase `:5434`), en
ventanas sin CI en ninguno de los dos repos.

- Antes del arreglo:
  - `node --test infra/kestra/validar-reintentos-flows.test.mjs` → 0/6.
  - pgTAP nuevo → `not ok 1..2` (funciones inexistentes).
  - `pnpm test:kestra:reintentos:e2e` con flows y fixture de `main` →
    `Genérico credencial: despacho_ssh tuvo 3 intentos` (ejecución
    `J6sucZlgFg1MMBVTPskcg`).
- Después:
  - Estáticos (reintentos + evidencia) → 11/11 al commit del arreglo.
  - pgTAP `ejecucion_en_curso_worker` → 21/21.
  - `validar-workers-runtime.mjs --execute` → 100 corridas OK;
    `test:kestra:deploy-flow` 4/4; `test-secretos-orquestacion` OK;
    `pnpm infra:config:kestra`, `template:*:check`, `docs:check` OK.
  - E2E: ver `test.md`.

## Deviations from Assessment

- **Sin tarea `Fail`** (ver commit 30aad4c). La evaluación proponía una tarea
  `io.kestra.plugin.core.execution.Fail` tras `despacho_ssh`. Publicar el
  genérico hace a veces que Kestra 1.3.35, después de responder el guardado
  (`POST /flows` en ~1 s), crezca de ~1,5 a ~8,5 GB de heap y termine en
  `OutOfMemoryError` y reinicio. Conteo de publicaciones en el Kestra de
  desarrollo: con una tarea más en la secuencia del `ForEach` (`Fail`,
  `Assert` o un `debug.Return` trivial) o con más referencias
  `outputs.<tarea>[parent.taskrun.value]`, **7 de 7** explotaron; con la
  estructura de `main` o la de este arreglo, **2 de 8** (una de cada una).
  El dedicado nunca lo sufrió. No se aisló la causa interna (los hilos
  virtuales de Kestra no salen en el thread dump). Se usó la tarea JDBC
  existente, renombrada `resolver_resultado_despacho`, que llama a una
  función que marca activa o falla con la marca: mismo número de tareas y
  referencias que en `main`.
- **Genérico sin clasificación verificable.** El E2E mostró que
  `clasificar_y_alertar` del genérico falla en runtime (`Unable to find
  value … outputs.detectar_tipo_falla.value`): dentro del `ForEach` ese
  output está indexado por iteración. Es preexistente (ningún E2E cubría una
  falla del genérico) y afecta toda falla, no solo credencial. La corrección
  natural (`outputs.detectar_tipo_falla[parent.taskrun.value]`) dispara el
  mismo agotamiento de heap incluso sobre el genérico de `main`. Queda fuera
  de este PR para poder revertirse por separado; el E2E del genérico valida
  un intento, un lanzamiento y que el handler recibe la marca, y la
  clasificación se valida con el dedicado.

## Follow-ups

- Bug propio: el genérico no clasifica ni alerta ninguna falla, y su
  secuencia dentro del `ForEach` está al borde del agotamiento de heap de
  Kestra 1.3.35 al guardarse (el genérico de `main` también cayó una vez).
  Posibles caminos: aplanar la secuencia, reemplazar `If` + dos `Subflow`
  por un `Subflow` con inputs calculados, o subir Kestra.
- Productos derivados: adoptar el contrato en cada worker (código `78`,
  `ejecucion_worker_en_curso` antes del navegador) y en los flows copiados
  (sección 3.3 de `docs/adoptar-ciclo-ejecuciones.md`); los flows con outbox
  deben `agotar` ante `no_reintentable`.
- Los tests estáticos de Kestra (`test:kestra:evidencia`,
  `test:kestra:reintentos`) no corren en CI; sumarlos es una mejora aparte.
