---
owner: plataforma
sources:
  - scripts/tests-afectados.mjs
  - apps/web/src/components
  - apps/web/src/pages
  - apps/web/vite.config.ts
  - design/pantallas
---

# Pruebas: qué corre según el cambio (determinista)

No se elige “a ojo”: el plan de pruebas sale del **diff**. La misma lista de
archivos produce siempre el mismo conjunto de suites, en el mismo orden.

```bash
pnpm test:afectados                     # plan contra origin/dokploy...HEAD
pnpm test:afectados --base origin/main  # otra base
pnpm test:afectados --archivos a.ts,b.sql
pnpm test:afectados --ejecutar          # corre el plan en orden (corta al fallar)
pnpm test:afectados --json              # plan como JSON (para CI/scripts)
```

Implementación: `scripts/tests-afectados.mjs` (`SUITES` + `seleccionarSuites`).
Tests: `scripts/tests-afectados.test.mjs`.

## Matriz

Además de **`lint`** y **`docs:check`** (siempre), según los archivos tocados:

| Archivos | Suites |
|---|---|
| `apps/web/**` | `web` (Vitest) |
| `apps/web/src/pages/**` | `web` + `e2e` (Playwright público) + `estilos` |
| `apps/web/src/components/**` | `web` + `e2e` |
| `supabase/migrations/**` | `db` (pgTAP) + `db:aditivas` |
| `supabase/tests/**` | `db` |
| `supabase/functions/**` | `edge` (3 funciones) |
| `packages/**` | `ia` |
| `scripts/**`, `.github/**` | `tooling` (`node --test scripts/*.test.mjs`) |
| `infra/**` | `infra:config` + `tooling` |
| `design/pantallas/**` | `prototipo` |
| `specs/**` | `matriz` |
| `docs/**`, `*.md` | (sólo `lint` + `docs`) |

## Qué comando ejecuta cada suite

| id | Comando |
|---|---|
| `lint` | `pnpm lint` |
| `docs` | `pnpm docs:check` |
| `web` | `pnpm --filter @platform/web test` |
| `estilos` | `pnpm estilos:check && pnpm test:estilos:sueltos` |
| `e2e` | `pnpm test:e2e -- acceso-publico.e2e.ts` |
| `db` | `pnpm test:db` |
| `db:aditivas` | `pnpm test:db:validar-aditivas` |
| `edge` | `pnpm test:edge:invitar-miembro && …invitar-cliente && …solicitar-acceso && …crear-organizacion && …cotizacion-sugerida` |
| `ia` | `pnpm test:ia` |
| `tooling` | `node --test scripts/*.test.mjs` |
| `infra:config` | `pnpm infra:config` |
| `prototipo` | `pnpm prototipo:check && pnpm test:prototipo:inventario` |
| `matriz` | `pnpm matriz:check && pnpm test:matriz:pantalla` |

## Límites

- Es una selección **suficiente y determinista**, no “la mínima posible”: si
  tocás una página, corre toda la suite web (no sólo ese archivo).
- El **gate del PR** sigue corriendo todo en CI. Este plan es para iterar y para
  saber de antemano qué va a validar el PR.
- Los E2E con sesión (`permisos-por-empresa`, `stock-movimientos`) no entran acá:
  necesitan Supabase local (ver `docs/e2e-app.md`).
- Para agregar una suite: sumarla a `SUITES` y a `seleccionarSuites` **y** a la
  tabla de arriba. El test `tests-afectados.test.mjs` fija el contrato.
- **Tests de integración de pantalla** (varios campos + RPC + esperas, p. ej.
  `pages/productos/edit.test.tsx`): con la suite **shardeada** el timeout default
  de 5 s queda justo y da **falsos rojos** en PRs ajenos. Se sube el timeout del
  archivo (`vi.setConfig({ testTimeout })`) y las lecturas que dependen de datos
  async usan `findBy*`.
- **Falso rojo por `EnvironmentTeardownError`**: si todos los tests pasan pero vitest
  sale con `Closing rpc while "onUserConsoleLog" was pending` (atribuido a
  archivos como `RutaCatalogo.test.tsx` o `SiderPanel.test.tsx`), era una carrera
  de cierre de workers: un `console.*` emitido justo al terminar el archivo dejaba
  pendiente el RPC de logs. `apps/web/vite.config.ts` fija
  `disableConsoleIntercept: true` para que la consola salga directo a la salida
  estándar sin pasar por RPC (se pierde solo la atribución de cada línea al test).
  Si reaparece, no relanzar sin mirar: revisar qué test escribe a consola después
  de terminar.
- **Falso rojo por `ReferenceError: window is not defined`**: si todos los tests pasan
  pero vitest sale con ese error atribuido a otro archivo (p. ej.
  `SiderPanel.test.tsx`), es un `setState` tardío de un hook cuya petición termina
  DESPUÉS de desmontar y de cerrar jsdom. `useEmpresasAccesibles` ya invalida la
  petición en vuelo al desmontar («última petición gana» incluye el desmontaje); un
  hook nuevo con carga asíncrona debe hacer lo mismo y cubrirlo con un test que
  rechace/resuelva después de `unmount()`. Un test que monta un componente con
  lecturas reales a la red (como la insignia de consultas dentro de `SiderPanel`)
  debe mockearlo o mockear `lib/supabase`: un `fetch` real que falla tarde produce
  el mismo error.

## Calidad determinista (`pnpm calidad`)
- `pnpm calidad` corre los checks **deterministas** del producto (gitleaks, semgrep, knip, jscpd,
  dependency-cruiser, syncpack, commitlint). `pnpm calidad:code` omite los que usan Docker.
- En CI corre el workflow **`quality`**: falla ante hallazgos pero **no bloquea el merge** (el ruleset 25358575, que aplica a `dokploy`,
  exige solo `validacion`, verificado con `gh api repos/{owner}/{repo}/rulesets/25358575`; no hay `continue-on-error`). Ver `docs/calidad.md`.
- El reporte queda en `reports/calidad.md` y la salida completa en `reports/calidad.log` (artifact `calidad-reporte`).
- **Baseline**: `knip` corre con `ignoreExportsUsedInFile` (no marca exports usados en el mismo archivo); `syncpack` ignora los paquetes locales `@platform/*` (`workspace:*`); `semgrep` usa reglas **vendorizadas** en `.semgrep/registry/` (packs `p/typescript`/`p/react`; los secretos los cubre `gitleaks`): corre **offline** (sin registry). Si igual sale != 0 sin salida, se considera error de herramienta (saltado).
- **Baseline**: `knip` corre con `ignoreExportsUsedInFile`; `syncpack` ignora los paquetes locales
  `@platform/*` y `@types/node`; el **SAST** usa **oxlint** con reglas de seguridad (`no-eval`,
  `no-new-func`, `no-implied-eval`, `no-script-url`), sin depender de docker ni PyPI.


- **gitleaks** corre con el **binario nativo** (el `-v` de Docker en runners containerizados puede
  escanear 0 bytes y dar falso verde). Docker queda como fallback local.

## Higiene de nombres de test: sin códigos MSF

`apps/web/src/higieneReferenciasInternas.test.ts` falla si el nombre de un `describe`, `it` o `test` cita un código del tracker (`MSF-123`). El código vive en el mensaje de commit y en el ticket, no en el nombre de la prueba. Al escribir un test para un ítem trazado, nombrá el comportamiento («avisa el formato del WhatsApp…»), no el ticket. Los nombres de seis tests que entraron con el aviso de WhatsApp, Documentos IA y la defensa de alta de clientes se corrigieron por este motivo, y lo mismo pasó con los de depósitos y toma de inventario (reparto de ids y carga de 1000 productos).

## Cobertura de módulos puros de `apps/web/src/lib`

Criterio de la deuda de cobertura: se prueba primero la lógica pura donde un error cuesta dinero o datos (validación de importes y porcentajes, tope de cobros y notas de crédito, totales de rendición, estados, fechas y cantidades de stock), no un porcentaje global. Cada módulo tiene su `<nombre>.test.ts` al lado y prueba comportamiento (límites, vacíos, tildes, redondeo a centavos, errores sin detalle técnico), no la implementación. El lote 12 sumó pruebas directas para `notaCredito`, `estadosComprobante`, `listasPrecios`, `costosAdicionales`, `lotes`, `traslados`, `tomaInventario`, `reparacionItems`, `busquedaTexto` y, en `lib/ventas/`, `cobros`, `enviosMoto`, `enviosMotoRendicion`, `formasEnvio`, `formasPago` y `transportes`, que antes solo se ejercitaban de forma indirecta desde las pantallas.

El lote 13 sumó pruebas directas para `diasInactivos`, `repartoIds`, `estadoRma`, `estadoOpinion`, `preciosPropios`, `asignacionesEmpresas`, `resumenSemanal`, `interesWhatsapp` y `ventasDespachoLista` (conteos y lectura del tablero de despacho). Además fijó tres comportamientos: un monto por unidad de un costo adicional muestra centavos (`$ 12,50 por unidad`) y un entero sigue sin decimales; `parsearAjuste` de listas de precios no acepta espacios dentro del número (los de los extremos y uno antes del `%` sí); y `definicionEstado` de comprobantes no toma un nombre heredado de `Object` (`constructor`) por un estado.

## Checks de trampas conocidas

`scripts/verificar-trampas-conocidas.mjs` convierte en checks deterministas (sin red, sin secretos, segundos) errores que ya costaron vueltas de CI. Mira el diff contra `origin/dokploy` como `verificar-migraciones.mjs`; corre dentro de `pnpm docs:check` (job `application`) y en `pnpm prepush` cuando el diff toca migraciones, pgTAP o E2E. `--todo` revisa el árbol completo como si todo fuera nuevo (sirve para comprobar que no hay falsos positivos). Su prueba es `scripts/verificar-trampas-conocidas.test.mjs`, dentro de `pnpm test:docs:check`.

Requisitos y límites del check:

- `todasMigraciones` sale de `git ls-files` del árbol local, no de la base. Por eso `pnpm prepush` exige la rama rebasada o integrada con `origin/dokploy` (`git fetch origin && git merge origin/dokploy`): con la rama atrasada, T6 compara contra una versión vigente vieja y no ve filas que otra rama ya agregó.
- En CI el job `application` (el que corre `pnpm docs:check`) usa `actions/checkout@v4` con `fetch-depth: 0` y, al ser `pull_request`, el checkout por defecto es el merge ref (`refs/pull/N/merge`), es decir la rama ya integrada con la base; `origin/dokploy` existe por el historial completo. Verificado en `.github/workflows/validate.yml`.
- Si falta la base de comparación (`origin/dokploy` ausente): en CI (`CI` o `GITHUB_ACTIONS`) el script falla con un mensaje claro; en local solo avisa y sale 0.
- T6: si la función existe pero no se puede leer ninguna fila `('esquema', 'tabla')` (se aceptan casts `'x'::text`), falla en lugar de pasar. Con dos migraciones de la misma versión se ordena por versión y luego por nombre de archivo. La pérdida declarada exige un motivo no vacío: `-- exportacion-total: se quita <esquema>.<tabla> (motivo)`.

| Trampa | Falla cuando | Arreglo |
| --- | --- | --- |
| Grants de `service_role` | una migración crea `dominio.<x>` y el diff no trae `grant ... to service_role` para ella (`service_role_privilegios.test.sql`) | `grant select, insert, update, delete on dominio.<x> to service_role;` o declararla inalterable |
| Variables de psql en pgTAP | un `.test.sql` usa `:'nombre'` dentro de `$$ ... $$` (psql no interpola ahí) | `format('... %L ...', :'nombre')` |
| Exportación total | una tabla nueva con `organizacion_id` no figura en `conjuntos_exportacion_total()` ni en `exclusiones_exportacion_total()` del diff | redefinir la función sumando la tabla, o excluirla con motivo |
| Superconjunto de la exportación total | una migración nueva redefine `conjuntos_exportacion_total()` y su lista `values (...)` no contiene todas las filas de la versión vigente anterior (la de mayor versión menor a la suya, en la base o en el diff) | rebasar sobre esa versión (copiar su lista completa y sumar solo las filas propias); si quitar una fila es intencional, comentario `-- exportacion-total: se quita <esquema>.<tabla> (motivo)` en la migración. Al mergear una rama que toque la función, las demás pendientes rebasan su migración sobre la nueva versión |
| Estilos sueltos en pantallas | una pantalla de `apps/web/src/pages` usa `borderRadius` numérico, colores hex o `height`/`fontSize` fijos (`pnpm estilos:check`, `verificar-estilos-sueltos.mjs`; rompe el job `application`). `pnpm prepush` lo corre si el diff toca `apps/web/src/pages` | usar tokens del tema; para el radio, `(tema) => \`${tema.shape.borderRadius}px\`` |
| E2E con service key | un E2E escribe (`rest`/`borrar` con esquema `'dominio'`) en una tabla sin grant a `service_role` en ninguna migración | sumar el grant a la migración de la tabla |
| Fecha de Buenos Aires en pgTAP | un `.test.sql` inserta en `reparaciones` con `current_date` (UTC del CI: entre 00:00 y 03:00 UTC es «mañana» en Buenos Aires y la app rechaza «El ingreso no puede ser una fecha futura») | `(now() at time zone 'America/Argentina/Buenos_Aires')::date` |

Lección de #1053 (clientes pasó de `public` a `dominio`): un PR en vuelo que todavía nombra `public.clientes` (en funciones, tests, E2E o docs) **debe rebasar sobre #1053** y cambiar las referencias a `dominio.clientes`; si además redefine `conjuntos_exportacion_total()`, **copiar la lista vigente** (la de `20270418000401`, que ya trae `dominio.clientes`) y no la que tenía su rama. La prueba `clientes_busqueda_unificada.test.sql` falla si alguna función conserva `public.clientes`.

No se duplican: versiones de migración menores o iguales a la máxima de la base (`verificar-migraciones.mjs --estricto`) y nombres de test con códigos MSF (guardián `higieneReferenciasInternas.test.ts`, sección anterior).

El test de contrato del ranking de clientes (`rankingClientes.contrato.test.ts`) ubica la migración por patrón de nombre y no por versión fija, así que renumerar la migración no lo rompe.
