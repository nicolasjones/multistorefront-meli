# Bug Assessment: los flows plantilla reintentan un worker con credencial inválida

- **Slug**: reintentos-credencial-invalida
- **Created**: 2026-09-25
- **Source**: pasted text + caso real del producto
  `estudio-contable-automation/.specify/bugs/flow-xubio-no-publicado/test.md`
  (lectura local, sin URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> Los flows plantilla (`plantilla-generico.yml` y `plantilla-dedicado.yml`)
> reintentan el paso SSH hasta 3 veces aunque el worker haya fallado por
> credencial inválida. Cada reintento relanza el worker y abre otro navegador y
> otro login contra el sistema externo; con una credencial mala eso puede
> bloquear la cuenta, y en sistemas con sesión única cada reintento expulsa la
> sesión anterior y activa el anti-bot. Además, en modo manual el worker abre el
> navegador sin comprobar que la ejecución siga `en_curso`.

Caso real (producto, 2026-09-25, ejecución `42bc550e…`): "el `retry` del
`ssh.Command` (3 intentos) relanza el worker aunque haya fallado por
`CREDENCIAL_INVALIDA`. Hubo 3 navegaciones al login de Xubio en ~4 min; los
intentos 2 y 3 recién abortaron con `YA_CERRADA` después de navegar. Riesgo de
bloqueo de la cuenta en Visma Connect." En corridas posteriores hubo que matar
la ejecución de Kestra en `RETRYING` para garantizar un solo login.

## Symptom

Cuando el worker termina por credencial inválida, Kestra repite `despacho_ssh`
dos veces más (30 s y ~1 min después) y cada intento vuelve a lanzar el worker,
que abre el navegador y reintenta el login. Lo esperado: una falla no
reintentable corta en el primer intento, se clasifica como credencial y solo
las fallas técnicas transitorias se reintentan. Además, un reintento de una
ejecución manual ya cerrada no debería llegar a abrir el navegador.

## Reproduction

1. Stack de desarrollo del template (Supabase + Kestra) con el host SSH y el
   worker fixture de `infra/kestra/fixtures/`.
2. Conexión `fixture-credencial` en una organización de prueba.
3. Ejecutar `plantilla-dedicado` con `sistema_externo=fixture-credencial`
   (ya existe en `pnpm test:kestra:secretos:e2e`, "con reintento").
4. Observar en la ejecución de Kestra 3 intentos de `despacho_ssh` y 3 eventos
   `inicio/iniciada` del worker (uno por lanzamiento).

## Suspected Code Paths

- `infra/kestra/flows/plantilla-generico.yml` y `plantilla-dedicado.yml`,
  tarea `despacho_ssh`: `retry: exponential, maxAttempts: 3` sin distinguir el
  tipo de falla. Kestra 1.3.35 no ofrece reintento condicional (el esquema de
  `retry` solo tiene `behavior`, `interval`, `maxAttempts`, `maxDuration`,
  `maxInterval`, `delayFactor`, `warningOnRetry`; verificado contra
  `/api/v1/plugins/schemas/flow` del Kestra local).
- `workers/CONTRATO.md`: define la marca `CREDENCIAL_INVALIDA:<conexion_id>` en
  stderr, pero no un código de salida, ni qué fallas no se reintentan, ni que
  el worker verifique el estado de la ejecución antes de actuar.
- `infra/kestra/fixtures/worker/entrypoint.sh` (sale 42 en credencial) y
  `infra/kestra/fixtures/worker-runtime/` (43): códigos arbitrarios, no
  contractuales.
- Supabase: un rol `worker_*` no tiene `SELECT` sobre `ejecuciones_worker` ni
  una función para consultar el estado de su ejecución; solo puede enterarse
  al cerrar (`cerrar_ejecucion_worker` → `YA_CERRADA`), es decir, después de
  haber abierto el navegador.
- Comentario de contrato outbox en las plantillas: indica "un error transitorio
  lo libera", pero no dice qué hacer con uno no reintentable. Liberar la orden
  provocaría otro despacho (y otro login) en el siguiente reclamo.

## Root Cause Hypothesis

El reintento se configuró para absorber fallas técnicas transitorias (SSH,
Docker, red) y se aplica a cualquier código distinto de cero, porque el
contrato del worker no distingue fallas reintentables y Kestra no permite
condicionar el `retry`. El worker, a su vez, no tiene cómo comprobar antes de
abrir el navegador que su ejecución siga `en_curso`. Confianza: alta
(reproducido en el producto y visible en el YAML).

## Proposed Remediation

**Preferred**:

1. **Contrato** (`workers/CONTRATO.md`): código de salida `78` (`EX_CONFIG` de
   `sysexits.h`) = falla no reintentable, con un motivo sanitizado en stderr
   (`<MOTIVO>:<id>`). Fallas no reintentables evaluadas: credencial inválida
   (`CREDENCIAL_INVALIDA`), ejecución que ya no está en curso
   (`EJECUCION_NO_EN_CURSO`), otra ejecución activa (`YA_EN_CURSO`), capacidad
   o conexión no habilitada (`CAPACIDAD_NO_HABILITADA`) y configuración o
   entrada inválida del worker. Todas las demás son técnicas y reintentables.
2. **Flows**: el script SSH captura el código y el stderr del worker; si el
   código es 78 **o** el stderr trae la marca `CREDENCIAL_INVALIDA:` (compat.
   con workers ya publicados que salen con 1), re-emite el stderr, publica el
   output `no_reintentable` con el motivo (formato `::{"outputs":…}::`) y
   termina con 0 para que Kestra no reintente. Una tarea
   `io.kestra.plugin.core.execution.Fail` inmediatamente después corta la
   secuencia con `<MOTIVO>:<conexion_id>`, de modo que el handler `errors`
   existente la clasifica igual que hoy (credencial → `alertar_credencial`) y
   `marcar_conexion_activa` no corre. El `retry` queda solo para las fallas
   técnicas. El comentario de contrato outbox agrega: no reintentable →
   `agotar`, nunca `liberar`.
3. **Supabase**: función aditiva
   `private.ejecucion_worker_en_curso(p_ejecucion_id uuid) returns boolean`,
   `security definer`, solo para miembros de `workers_orquestacion` y solo
   sobre ejecuciones de su propia organización; devuelve falso si la ejecución
   no está `en_curso` o ya venció su `tiempo_max_seg`. El contrato exige
   llamarla antes de abrir el navegador o de cualquier efecto externo y salir
   con 78 / `EJECUCION_NO_EN_CURSO` si es falsa.
4. **Fixtures**: el worker fixture verifica `en_curso` cuando recibe
   `EJECUCION_ID`, sale 78 en credencial inválida y en ejecución cerrada.

**Alternatives**:
- Reintentar dentro del script SSH (loop de shell) y quitar el `retry` de
  Kestra: pierde el reintento de fallas de conexión SSH, justo el caso
  transitorio más común.
- Marca en el host para que el intento 2 no relance el worker: Kestra igual
  muestra reintentos y esperas; depende de estado en el host.

**Files likely to change**:
- `infra/kestra/flows/plantilla-generico.yml`, `plantilla-dedicado.yml`
- `infra/kestra/fixtures/worker/entrypoint.sh`, `fixtures/worker-runtime/*`,
  `infra/kestra/validar-workers-runtime.mjs`
- `supabase/migrations/<nuevo>_ejecucion_en_curso_worker.sql`
- `workers/CONTRATO.md`, `workers/README.md`, `docs/`
- `template-capabilities.json` (`worker-execution-cycle` → 1.2.0)

**Tests to add or update**:
- Estático (`node --test`): el script propaga 78/marca como output, la tarea
  `Fail` existe tras `despacho_ssh` con su condición y el `retry` sigue.
- pgTAP: la función devuelve verdadero/falso según estado y vencimiento,
  rechaza otra organización y roles que no son worker.
- E2E real (`infra/kestra/validar-reintentos-e2e.mjs`): credencial inválida →
  1 solo intento y 1 solo lanzamiento del worker, clasificada credencial y
  conexión `credencial_invalida`; ejecución manual ya cerrada → el worker sale
  78 sin llegar a la etapa de sesión; falla técnica → 3 intentos (el retry se
  conserva).

## Risks & Considerations

- Los productos derivados copian las plantillas: la compatibilidad por marca
  `CREDENCIAL_INVALIDA:` evita depender de que actualicen todos los workers.
- El stderr del worker se re-emite al final del paso (después de su stdout);
  el orden relativo cambia, pero los eventos por etapa van por stdout.
- La función nueva es de solo lectura y no amplía el acceso a la tabla.
- Kestra marca `despacho_ssh` en `WARNING` (stderr) en el caso no
  reintentable; la secuencia la corta `Fail`.

## Open Questions

- Ninguna bloqueante. El guard de red (`exit 64`) queda fuera: no lanza el
  worker ni contacta al sistema externo, así que su reintento no tiene el
  riesgo de este bug.
