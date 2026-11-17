# Bug Assessment: MSF-782 — job `web` rojo en `formulario-cuenta-web.test.tsx`

- **Slug**: msf-782
- **Created**: 2026-11-17
- **Source**: descripción del tracker (MSF-782) + verificación local en este repo
- **Verdict**: valid
- **Severity**: medium

## Report (resumido)

El job `web` del workflow `Validate` (shard 2/3) falla en
`apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx` con
`TestingLibraryElementError: Unable to find an element with the text: Cliente creado · no se pudo crear la cuenta web en 2 tiendas`.
El archivo no está en el diff de MSF-726: viene de la base (`dokploy`). Aislado y en local el archivo pasa 5/5.
Es el mismo tipo de rojo de base ya cerrado en MSF-754 (`show.reparaciones.test.tsx`).

## Symptom

Con la CPU del runner saturada (3 shards en paralelo), el mensaje «Cliente creado · no se pudo crear la cuenta web en 2 tiendas»
aparece después del segundo 1 y `findByText` —que espera por defecto 1 s— aborta el test. El texto que produce
`apps/web/src/pages/clientes/create.tsx:83-85` es el esperado: el test falla por tiempo, no por lógica.

## Reproduction

1. `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx:160` espera el mensaje con `findByText` sin `timeout` explícito.
2. Con la cadena del alta lenta (crear cliente → guardar tiendas → cuenta web → ir a la ficha), el render del mensaje llega tarde.
3. `findByText` agota su espera de 1 s → `Unable to find an element with the text: …`.

Reproducido localmente de forma determinista: con el mock de la cuenta web respondiendo 1,5 s después (en vez de resolver al
instante) el archivo falla con el error exacto del CI; en local, sin retraso, la cadena del alta tarda ~174 ms.

## Suspected Code Paths

- `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx:160` — el assert que reportó el rojo; espera con el timeout por defecto de Testing Library (1 s).
- `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx:116,131,147` — misma carrera en las demás esperas del archivo (`waitFor` y `findByText` con 1 s).
- `apps/web/src/pages/clientes/create.tsx:83-85` — origen del mensaje; **no se toca** (el texto y el comportamiento del producto se mantienen).
- `apps/web/src/test/setup.ts` — no define timeout global; `apps/web/vite.config.ts` define `testTimeout: 15000` (por test), no `asyncUtilTimeout` (por espera).

## Root Cause Hypothesis

Confianza alta. El archivo espera con `findByText`/`waitFor` sin `timeout` explícito, así que cada espera tiene el presupuesto
por defecto de Testing Library (1 s). La cadena asíncrona del alta necesita tres esperas encadenadas (`mutateAsync` → `guardar` →
`aplicarCuentaWebEnTiendas`) más la navegación a la ficha y el render; con el runner compartido ese tiempo supera 1 s con
facilidad (en local son ~174 ms; el archivo tardó 12,3 s en el shard del CI) y el test falla por tiempo.

## Proposed Remediation

**Preferred**: subir el presupuesto de espera de las consultas de este archivo con una constante `ESPERA = { timeout: 5000 }`
pasada a cada `findByText`/`waitFor` (firma de 3 argumentos: `findByText(texto, undefined, ESPERA)`), como ya se hace en
`apps/web/src/pages/service-tecnico/reparacion.comprobante.test.tsx` y en `apps/web/src/pages/clientes/show.reparaciones.test.tsx` (MSF-754).
Los asserts siguen siendo estrictos (mismo texto, mismo comportamiento).

**Alternatives**:
- `configure({ asyncUtilTimeout: 10000 })` en `beforeAll`/`afterAll` (precedente de MSF-754): sube el presupuesto de todas las
  esperas del archivo, pero afecta también a las que no hacen falta y hay que restaurarlo.
- Quitar la carrera del mock: no aplica — los mocks no tienen retraso artificial; el retraso es del runner.

**Files likely to change**:
- `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx`

**Tests to add or update**:
- Actualizar el test existente «si una tienda falla, lo informa sin perder el cliente creado» para esperar con presupuesto explícito.
- Aplicar el mismo presupuesto a las demás esperas del archivo, que tienen la misma carrera.

## Risks & Considerations

- Ningún cambio de producto: no se toca `create.tsx`, ni el texto del mensaje, ni los datos.
- Ampliar la espera no vuelve verde un assert roto: el texto se sigue comparando exacto.
- El tope por test (`testTimeout: 15000`) sigue acotando un cuelgue real: como el archivo tiene como máximo dos esperas por
  test, el peor caso (2 × 5 s) queda por debajo de ese tope.

## Open Questions

- Ninguno.
