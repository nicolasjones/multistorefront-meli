# Bug Fix: una conexión en credencial_invalida o error queda trabada para siempre

- **Slug**: conexion-invalida-trabada
- **Fixed**: 2026-09-26
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`error` deja de bloquear (cualquier origen y el recorrido del genérico) y
`credencial_invalida` tiene dos salidas explícitas de un único intento:
actualizar la credencial (vuelve a `activa`) o un disparo manual de un
administrador autenticado. El programado sigue sin reintentar logins con una
credencial rechazada. La ejecución exitosa limpia el estado como prevé
FR-013.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20260925210000_destrabar_conexion_invalida.sql` | added | Aditiva: `create or replace` de `iniciar_ejecucion_worker` (error nuevo `CONEXION_CREDENCIAL_INVALIDA`), `organizaciones_activas_para_conector` (`activa` y `error`) y `actualizar_credencial_conexion` (`credencial_invalida` → `activa`). Reversión documentada en el archivo. |
| `supabase/tests/database/conexion_invalida_trabada.test.sql` | added test | pgTAP, 16 pruebas. |
| `supabase/tests/database/ciclo_ejecuciones_workers.test.sql` | modified test | Fijaba el comportamiento del bug ("una conexión no activa se rechaza" con `error`); ahora usa `credencial_invalida` y espera `CONEXION_CREDENCIAL_INVALIDA`. |
| `infra/kestra/validar-conexion-trabada-e2e.mjs` | added test | Validación real en el Kestra del template. |
| `package.json` | modified | `test:kestra:conexion-trabada:e2e`. |
| `specs/013-orquestacion-multi-organizacion/data-model.md` | modified | Cómo se llega a la "próxima ejecución" de FR-013. |
| `specs/016-ciclo-ejecuciones-workers/contracts/ciclo-ejecuciones.md` | modified | Error `CONEXION_CREDENCIAL_INVALIDA`; `CAPACIDAD_NO_HABILITADA` ya no cubre el estado de la conexión. |
| `docs/adoptar-ciclo-ejecuciones.md` | modified | Sección 3.4 (`worker-execution-cycle` 1.3.0). |
| `template-capabilities.json`, `template-adoption.json` | modified | `worker-execution-cycle` 1.3.0 (+ ruta de la migración). |

## Tests Added or Updated

- `conexion_invalida_trabada.test.sql` — el genérico recorre `error` y
  saltea `credencial_invalida`; `programada`/`kestra` rechazados con
  `CONEXION_CREDENCIAL_INVALIDA`; manual del administrador aceptado (con su
  orden de despacho) y sin cambiar el estado; manual sin sesión
  `authenticated` rechazado; `error` corre en programado y manual;
  actualizar la credencial rota el secreto, devuelve `activa` y vuelve al
  recorrido; en `error` no cambia el estado.
- `validar-conexion-trabada-e2e.mjs` — ver `test.md`.

## Local Verification

- Antes (base sin la migración): pgTAP nuevo `not ok 1–5, 7`; la prueba del
  ciclo ajustada `not ok 18`; E2E `Error: el genérico no la despachó
  (SUCCESS, 0 despachos)`.
- Después: pgTAP nuevo 16/16; `ciclo_ejecuciones_workers` 62/62; E2E y suite
  completa en `test.md`.
- `template:capabilities:check --base origin/main`, `template:adoption:check`,
  `docs:check` OK.

## Deviations from Assessment

- La prueba existente del ciclo que fijaba el rechazo de `error` se ajustó
  (ampliación de alcance menor, prevista en Risks).
- El pgTAP nuevo usaba el mismo administrador en dos organizaciones; la PK de
  `usuarios_organizacion` es `user_id` (ver commit 75f22e0).

## Follow-ups

- Refine: mostrar `CONEXION_CREDENCIAL_INVALIDA` como "actualizá la
  credencial o iniciá la ejecución a mano" y ofrecer el disparo manual desde
  una conexión en `credencial_invalida`.
- Productos que redefinieron alguna de las tres funciones deben portar la
  regla en vez de aplicar la migración a ciegas (sección 3.4).
- Al mergear después de #60, integrar `main`: conflicto esperado solo en la
  línea de versión/rutas de `worker-execution-cycle` del catálogo y en
  `template-adoption.json` (quedan 1.3.0 con ambas migraciones).
