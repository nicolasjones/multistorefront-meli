# Bug Assessment: una conexión en credencial_invalida o error queda trabada para siempre

- **Slug**: conexion-invalida-trabada
- **Created**: 2026-09-25
- **Source**: pasted text + caso real del producto
  `estudio-contable-automation/.specify/bugs/flow-xubio-no-publicado/test.md`
  ("Hallazgo (FR-013 de la spec 013 inalcanzable)"), lectura local sin URL
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> La spec 013 (FR-013) prevé que una conexión en `credencial_invalida` o
> `error` vuelva sola a `activa` en la próxima ejecución exitosa. Pero desde la
> migración del ciclo de ejecuciones, `iniciar_ejecucion_worker` rechaza las
> conexiones que no están `activa`, y el programado solo recorre las `activa`:
> una conexión marcada queda trabada para siempre (hoy solo se destraba con
> `private.marcar_conexion_activa` a mano).

Caso real (producto, 2026-09-25 14:59): el administrador recargó la
credencial correcta, pero la conexión seguía en `credencial_invalida`; hubo
que reactivarla con `private.marcar_conexion_activa` por SQL.

## Symptom

Una vez marcada `credencial_invalida` (o `error`), ninguna ejecución vuelve a
correr contra esa conexión por los caminos de la aplicación, así que la
"próxima ejecución exitosa" que limpiaría el estado nunca ocurre. Ni siquiera
actualizar la credencial la destraba. Esperado (FR-013): el estado se limpia
solo en la próxima ejecución exitosa, sin acción manual adicional.

## Reproduction

1. Conexión con capacidad habilitada; marcarla `credencial_invalida` (lo hace
   `procesar_falla_orquestacion` ante una falla de credencial).
2. Como administrador: `actualizar_credencial_conexion(...)` → la conexión
   sigue `credencial_invalida`.
3. `iniciar_ejecucion_worker(conexion, capacidad, 'manual', actor)` →
   `CAPACIDAD_NO_HABILITADA`.
4. `private.organizaciones_activas_para_conector(sistema)` no devuelve la
   organización → el flow genérico no la despacha.
5. Igual con `estado = 'error'`, que según `data-model.md` "no bloquea que
   una ejecución posterior vuelva a activa".

## Suspected Code Paths

- `supabase/migrations/20260923172738_iniciar_ejecucion_outbox.sql`
  (`iniciar_ejecucion_worker`, cuerpo vigente): `v_conexion.estado <>
  'activa'` → `CAPACIDAD_NO_HABILITADA`. Introducido en
  `20260920000000_ciclo_ejecuciones_workers.sql`.
- `supabase/migrations/20260914150000_orquestacion_multi_organizacion.sql`
  (`organizaciones_activas_para_conector`): `c.estado = 'activa'`.
- Misma migración (`actualizar_credencial_conexion`): rota el secreto "sin
  cambiar su id ni su estado".
- `specs/013-orquestacion-multi-organizacion/data-model.md` (transiciones
  R9) y `spec.md` FR-013: el contrato que hoy es inalcanzable.

## Root Cause Hypothesis

La spec 016 agregó el chequeo `estado = 'activa'` como parte de "capacidad
habilitada" sin contemplar las transiciones de salida de FR-013, y el
recorrido del genérico ya filtraba `activa`. Ningún camino puede producir la
ejecución exitosa que limpia el estado. Confianza: alta (lectura directa y
caso real).

## Proposed Remediation

**Preferred** (respeta FR-013 sin reabrir los reintentos del bug
`reintentos-credencial-invalida`):

1. **`error` no bloquea** (como dice `data-model.md`): `iniciar_ejecucion_worker`
   acepta `activa` y `error` para cualquier origen y
   `organizaciones_activas_para_conector` recorre `activa` y `error`. Una
   falla técnica no hace login con una credencial mala.
2. **`credencial_invalida` no se reintenta sola**: el programado la sigue
   salteando (cada corrida programada repetiría un login rechazado: bloqueo de
   cuenta, anti-bot). Sale por dos caminos explícitos, cada uno con un único
   intento:
   - **Actualizar la credencial** (`actualizar_credencial_conexion`) la
     devuelve a `activa`: una credencial nueva se presume válida igual que al
     crear la conexión (`crear_conexion` inserta `activa`). La próxima
     ejecución (programada o manual) la prueba; si vuelve a fallar, el flow la
     marca otra vez `credencial_invalida` y el programado deja de intentarlo.
   - **Disparo manual de un administrador**: `iniciar_ejecucion_worker` con
     origen `manual` desde una sesión `authenticated` que es administradora
     acepta `credencial_invalida` (caso Xubio: la credencial era buena y el
     rechazo fue un falso positivo). Los orígenes `programada`/`kestra` y los
     llamantes worker/kestra siguen rechazados con un error propio
     `CONEXION_CREDENCIAL_INVALIDA`.
   En ambos casos la ejecución exitosa pasa por
   `resolver_resultado_despacho`/`marcar_conexion_activa` y limpia el estado
   (FR-013). Sin el bug 1 mergeado, cada uno de esos intentos todavía podría
   reintentarse 3 veces: este PR depende de que el de
   `reintentos-credencial-invalida` se mergee antes.
3. Migración aditiva con `create or replace` de las tres funciones; la
   reversión restaura los cuerpos anteriores (documentado en la migración).

**Alternatives**:
- Aceptar `credencial_invalida` en todos los orígenes: el programado volvería
  a intentar el login en cada corrida → reabre el problema del bug 1.
- Estado nuevo `pendiente_verificacion` al actualizar la credencial: cambia el
  check constraint y la UI (`apps/web/src/pages/conexiones/list.tsx`) sin
  ganar nada frente a `activa`, que ya significa "sin evidencia de falla".

**Files likely to change**:
- `supabase/migrations/<nuevo>_destrabar_conexion_invalida.sql`
- `supabase/tests/database/conexion_invalida_trabada.test.sql`
- `infra/kestra/validar-conexion-trabada-e2e.mjs` (validación real)
- `specs/013-orquestacion-multi-organizacion/data-model.md` (transiciones),
  `docs/adoptar-ciclo-ejecuciones.md`
- `template-capabilities.json`, `template-adoption.json`
  (`worker-execution-cycle` 1.3.0)

**Tests to add or update**:
- pgTAP (falla antes): manual de admin sobre `credencial_invalida` se
  acepta; programada/kestra se rechazan con `CONEXION_CREDENCIAL_INVALIDA`;
  `error` se acepta en todos los orígenes; `actualizar_credencial_conexion`
  pasa `credencial_invalida` → `activa` y no toca `error`/`activa`;
  `organizaciones_activas_para_conector` incluye `error` y excluye
  `credencial_invalida`.
- E2E real en el Kestra del template: conexión `error` → el genérico la
  despacha y queda `activa`; `credencial_invalida` → el genérico no la
  despacha; disparo manual del admin (RPC) + dedicado con `ejecucion_id` →
  éxito y `activa`; actualizar la credencial → `activa` → el genérico la
  vuelve a despachar.

## Risks & Considerations

- Cambia la semántica de `CAPACIDAD_NO_HABILITADA`: ya no cubre el estado de
  la conexión `error`; `credencial_invalida` fuera del manual usa un error
  nuevo. Refine y los workers que interpreten el mensaje deben conocerlo.
- Un administrador podría disparar a mano una y otra vez con una credencial
  mala; cada disparo es un login y es una acción humana explícita. No se
  agrega límite ahora.
- `error` no lo escribe ninguna función del template; el cambio igual evita
  que un producto que lo use quede trabado.

## Open Questions

- Ninguna bloqueante.
