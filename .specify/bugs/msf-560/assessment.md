# Bug Assessment: MSF-560 — no hay medición de LCP móvil («4G lento») de home, catálogo y ficha, y el repo no tiene con qué producirla

- **Slug**: msf-560 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — "Seguimiento MSF-421: medir LCP móvil (4G lento) de home, catálogo y ficha (It's a Plan MSF-560) slug=msf-560". Sin URL: no hay nada que traer.
- **Verdict**: valid (la **falta de evidencia** es real y reproducible en el repo; el **desempeño en sí está sin medir**, así que cualquier corrección de performance queda condicionada a medir primero)
- **Severity**: medium

## Report (verbatim or summarized)

> Seguimiento MSF-421: medir LCP móvil (4G lento) de home, catálogo y ficha (It's a Plan MSF-560) slug=msf-560

Contexto del repo (no del reporte, verificado en el código y en la documentación):

- Es el seguimiento de **F-TDA-17 / MSF-421** (versión móvil de la tienda), épica **MSF-191**
  (`specs/20261024-120000-tienda-inicio-busqueda-movil/`). El criterio es **FR-047** y **SC-009**.
- **D9 (supuesto asumido en la spec)** — `specs/20261024-120000-tienda-inicio-busqueda-movil/spec.md:68`:
  «emulación móvil de Lighthouse con red "4G lento" y CPU ×4; criterio "contenido principal visible (LCP) en menos
  de 3 s" en home, catálogo y ficha».
- El sitio ya declara el pendiente: `docs/tienda-movil.md:32-40` — «**LCP medido: pendiente.** El entorno de la
  historia no tenía Docker (sin stack local) ni Lighthouse» y una tabla con `Home | sin medir (MSF-560)`,
  `Catálogo | sin medir (MSF-560)`, `Ficha | sin medir (MSF-560)`.
- `docs/tecnico/tienda-inicio-busqueda-movil.md:271-276` — «Pendiente de evidencia (no se inventa): … Medir el LCP de
  home, catálogo y ficha en emulación móvil "4G lento" (objetivo < 3 s). Dueño: seguimiento **MSF-560**».

## Symptom

El criterio de aceptación de rendimiento de la versión móvil (**FR-047 / SC-009: LCP < 3 s en home, catálogo y
ficha con emulación móvil «4G lento» y CPU ×4**) **nunca se midió**: las tres pantallas tienen la celda «sin medir
(MSF-560)» en la documentación y no existe evidencia de medición en ningún artefacto del repo.

Esperado: una medición reproducible, con cifras anotadas en `docs/tienda-movil.md`, que confirme o desmienta el
objetivo de 3 s.

Condición: hoy **no hay ninguna herramienta en el repo que pueda producir esa medición**: el único arnés de
Lighthouse existente (`nightly.yml` + `.lighthouserc.json`) audita el **panel** en **escritorio**, no el front
público de la tienda en móvil. Por eso el pendiente no se cerró en el cierre de MSF-421/MSF-191.

## Reproduction

El «bug» es la ausencia de la medición; se reproduce leyendo el repo y, en su forma ejecutable, corriendo la
herramienta disponible:

### A. La evidencia que falta (lectura de código y docs)

1. `docs/tienda-movil.md:36-40` → la tabla de LCP tiene `sin medir (MSF-560)` en las tres pantallas.
2. `docs/tecnico/tienda-inicio-busqueda-movil.md:271-276` → la medición figura como pendiente de evidencia con
   dueño MSF-560.
3. `grep -rn "LCP" apps/web/src apps/web/e2e` → **ningún** test, script ni E2E mide o afirma un LCP. Lo único que
   hay es un test de *atributos* (`apps/web/src/pages/tienda-publica/ImagenProducto.test.tsx:16-29`), que fija
   `loading="lazy"` en miniaturas y la ausencia de `loading` en la imagen principal de la ficha, sin medir nada.

### B. El arnés existente no sirve para esta medición

4. `.lighthouserc.json` → `collect.staticDistDir: "./apps/web/dist"`, `numberOfRuns: 1`, `settings` **sin**
   `preset`, **sin** `throttlingMethod` y **sin** `throttling`.
   - LHCI sirve el `dist` estático y audita la **raíz del panel**. El front público de la tienda **no** se puede
     auditar así: `apps/web/src/main.tsx:33,46` decide entre panel y tienda según el `Host`
     (`esHostDeTienda`, `apps/web/src/lib/tienda.ts:35-38`; en local, `VITE_PANEL_HOSTS=localhost,127.0.0.1`,
     `apps/web/.env.example:17`) → con el `Host` de localhost la app **no** monta la tienda, y sin `Host` de
     tienda publicada `/catalogo` y `/producto/:id` no existen.
   - Sin `preset: "mobile"` ni `throttlingMethod: "devtools"` LHCI corre el **preset de escritorio** con
     throttling simulado: **no** es la emulación «4G lento» + CPU ×4 que exige D9.
   - `numberOfRuns: 1` → una sola corrida ruidosa no es evidencia (el propio repo usa 3 corridas cuando el dato
     importa).
5. `grep -rn lighthouse package.json apps/web/package.json` → **Lighthouse no es dependencia** del repo: solo
   aparece como `pnpm dlx @lhci/cli@0.16.0` en `.github/workflows/nightly.yml:37`. No hay forma local, versionada
   y reproducible de medir.
6. La tienda necesita stack vivo con el seed (dos tiendas) para tener datos: sin `pnpm dev:supabase` no hay
   catálogo ni ficha que auditar. Es exactamente lo que faltó al cerrar la épica (`docs/tienda-movil.md:32-34`).

**Nota de método**: en esta corrida **no se ejecutó ninguna medición** (sin `node_modules`, sin Chrome, sin stack
local; y la consigna del turno es diagnóstico, sin correr tests ni el fix). Todo lo de abajo es **análisis
estático del código**; el número de LCP sigue sin medirse y hay que medirlo antes de afirmar cualquier
incumplimiento.

## Suspected Code Paths

### Por qué no hay medición (el «bug» reportado)

- `.lighthouserc.json:3-8` — `collect.staticDistDir` + `numberOfRuns: 1` + `settings` sin preset móvil ni
  `throttlingMethod: "devtools"`: el arnés no puede producir el dato de D9 sobre el front público.
- `.github/workflows/nightly.yml:36-37` — el único paso de Lighthouse del repo; corre contra el panel.
- `apps/web/src/main.tsx:33,46` + `apps/web/src/lib/tienda.ts:35-38` — la separación panel/tienda es **por `Host`
  en runtime**, no por bundle: la misma app sirve ambos y el routing decide en el cliente.
- `docs/tienda-movil.md:32-40` y `docs/tecnico/tienda-inicio-busqueda-movil.md:271-276` — el pendiente declarado.

### Mecanismos de código que probablemente empujan el LCP por encima de 3 s (a confirmar con la medición)

- `apps/web/src/main.tsx:6,13` — **la tienda pública y el panel comparten el mismo chunk de entrada**:
  `main.tsx` importa **estáticamente** `App.tsx` (el panel Refine: 55 imports estáticos de páginas del panel,
  `App.tsx:23-80`) **y** `pages/tienda-publica`. `apps/web/vite.config.ts` no define
  `build.rollupOptions.output.manualChunks` ni ningún límite dinámico entre las dos apps → todo el grafo
  estático del panel (Refine, MUI, `@mui/x-charts` vía `pages/inicio/tablero/GraficoVentasStock.tsx:5`,
  `@nangohq/frontend` vía `providers/nango/index.ts:1` ← `pages/conexiones-oauth/list.tsx:6` ← import
  estático en `App.tsx`) viaja en el bundle que descarga el visitante de la tienda. En 4G lento, esto es el término
  dominante del LCP.
- `apps/web/src/main.tsx:3-4` — `@fontsource-variable/sora` y `instrument-sans` en el entry: las tipografías de la
  tienda (la del héroe) se descargan con el bundle de entrada.
- `apps/web/src/pages/tienda-publica/index.tsx:61,93` — `resolverTienda(host)` **bloquea el montaje del router**:
  hasta que la RPC no responde no se renderiza `EnrutadorTienda` → no hay ni encabezado ni contenido.
- `apps/web/src/lib/imagenProducto.ts:22` + `apps/web/src/lib/tiendaInicio.ts:56` + `apps/web/src/hooks/useFichaProducto.ts:31`
  — **cascada serial RPC → firmado → imagen**: el `src` de cada imagen es una URL firmada que recién existe
  después de `createSignedUrls` (POST a Storage). La descarga de la imagen **no puede empezar** antes de que
  terminen dos idas a Supabase, a dos hosts distintos (API y Storage).
- `apps/web/index.html:1-11` — **sin `preconnect`/`dns-prefetch`** a los orígenes de Supabase (API y Storage):
  en 4G lento, el handshake TLS de cada host entra dentro del LCP.
- `apps/web/src/pages/tienda-publica/catalogo/TarjetaProducto.tsx:42` — **todas** las imágenes de tarjeta llevan
  `loading="lazy"`, incluidas las de la primera fila visible. En `/catalogo` el elemento LCP esperado es la
  imagen de la primera tarjeta: `lazy` la posterga exactamente a la que debería bajarse primero.
- `apps/web/src/pages/tienda-publica/ficha/Galeria.tsx:47` — la imagen principal de la ficha es la única que
  **no** es lazy (correcto), pero no lleva `fetchpriority="high"` ni `width`/`height`, y su `src` depende del
  firmado (`useFichaProducto.ts:31`).
- `apps/web/src/pages/tienda-publica/secciones/CategoriasInicio.tsx:128` — fotos de categoría con
  `loading="lazy"`, y el bloque solo se pinta cuando resuelven `useCategoriasTienda` + `useInicioTienda`.
- `apps/web/src/pages/tienda-publica/secciones/BannerHome.tsx` — el héroe de la home es **texto** (h1 de 36–72 px,
  `BannerContenido`), sin imagen: el LCP de la home es muy probablemente un bloque de texto, así que lo manda la
  llegada de JS + datos + fuente, no una imagen.
- `apps/web/src/pages/tienda-publica/ImagenProducto.test.tsx:10-29` — test que **fija como correcto** el
  `loading="lazy"` de tarjetas y miniaturas (FR-047 «imágenes con carga diferida»): cambiarlo es un cambio de
  criterio, no un parche, y hay que actualizar la spec junto con el código.

## Root Cause Hypothesis

**Confianza: alta** para la causa de la falta de evidencia, **media** para los mecanismos de performance (hasta
medir no se puede afirmar que el LCP supere los 3 s).

La causa raíz de MSF-560 es una **brecha de tooling**, no un defecto de una pantalla: el criterio FR-047/SC-009
exige una medición de LCP móvil con «4G lento» y CPU ×4, pero el repo nunca tuvo un arnés capaz de producirla.
El único Lighthouse del repo (`.lighthouserc.json` + `nightly.yml`, introducidos en MSF-687) audita el **panel**
sobre el `dist` estático, en **escritorio**, con **una sola corrida**, y Lighthouse **no** es una dependencia
versionada del proyecto (solo `pnpm dlx`). Y el front público de la tienda no es auditable por esa vía porque la
separación panel/tienda es **por `Host` en runtime** (`main.tsx:33`): el `dist` estático servido por LHCI no
monta la tienda. Sumado a que la tienda necesita el stack local con el seed (sin Docker ni Lighthouse en el
entorno donde se cerró MSF-421), el resultado es la celda «sin medir (MSF-560)» que sigue abierta.

Sobre la performance en sí, el análisis estático muestra cuatro mecanismos que, sumados, hacen **plausible** que
el objetivo de 3 s no se cumpla en 4G lento: (a) el **chunk de entrada compartido** entre panel y tienda —el
visitante público descarga el JS del panel—; (b) la **cascada serial** resolver-tienda → RPC de página → firmado
de imágenes → descarga, con el `src` de cada imagen bloqueado por el firmado; (c) la ausencia de `preconnect` a
los dos hosts de Supabase; y (d) el hecho de que **todas** las imágenes del catálogo sean `lazy`, incluido el
candidato LCP de la primera fila. En la home, donde el LCP es texto (el h1 del héroe), pesan (a) y (b); en la
ficha, (b) y la falta de `fetchpriority="high"` en la imagen principal; en el catálogo, (d) y (b).

## Proposed Remediation

El seguimiento tiene **dos partes separables** y conviene cerrarlas en ese orden: primero **medir** (para tener
el número y no inventarlo, como ya marca la documentación), después **corregir** lo que la medición reprobare.

### Parte 1 — Preferred: hacer la medición reproducible y versionada

Agregar al repo un arnés de Lighthouse **para el front público de la tienda**, con la emulación que exige D9
(DevTools «Slow 4G»: RTT 150 ms, 1,6 Mbps, CPU ×4) y aserción de `largest-contentful-paint` ≤ 3000 ms:

- Un script nuevo `apps/web/scripts/lighthouse-tienda.mjs` (o `scripts/lighthouse-tienda.mjs` en la raíz, junto
  a los demás scripts de verificación) que:
  1. levante el front (`vite preview`) y apunte al **host de la tienda** del seed, no al del panel (el `Host` es
     lo que decide qué app monta: `main.tsx:33`);
  2. ejecute Lighthouse con `preset: 'mobile'`, `throttlingMethod: 'devtools'`, `throttling: { rttMs: 150,
     throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 }`, `onlyCategories: ['performance']`, `numberOfRuns: 3` y
     se quede con la **mediana**;
  3. mida `/`, `/catalogo` y `/producto/<id de la tienda>` de **las dos tiendas del seed**;
  4. escriba el informe en `reports/lighthouse-tienda/` y **falle** si el LCP mediano supera 3000 ms.
- Fijar la versión de la herramienta (precedente del repo: `@lhci/cli@0.16.0` y `@axe-core/cli@4.14.0` en
  `nightly.yml:37,47`): `pnpm dlx lighthouse@<versión>` o agregar `@lhci/cli` como devDependency.
- Cablearlo al `nightly.yml` (o a un workflow propio) **con el stack de la tienda levantado**, y anotar las cifras
  en la tabla de `docs/tienda-movil.md:36-40` (las tres filas existen: solo hay que llenarlas).
- Documentar el protocolo en `docs/tecnico/tienda-inicio-busqueda-movil.md` (reemplazar la línea «Pendiente de
  evidencia») y en `docs/tienda-movil.md:27-40`.

> Nota de alcance: **la medición es la parte 1; el fix de performance es la parte 2 y depende de lo que salga.**
> El repo tiene el precedente exacto para esto en `docs/tiendas-online.md:664-671`: el protocolo ya está escrito
> (stack local + Lighthouse sobre `/catalogo` y `/producto/:id` de ambas tiendas), solo falta ejecutarlo.

### Parte 2 — Preferred (condicionada a la medición): los tres cambios de mayor palanca

1. **Separar el bundle del panel del bundle de la tienda** (ataca (a), el término dominante):
   `apps/web/src/main.tsx` deja de importar `App.tsx` estáticamente y lo carga diferido
   (`const App = lazy(() => import('./App.tsx'))`), de modo que el visitante de la tienda no descargue Refine, X
   Charts, Nango ni las ~55 páginas del panel. Si la medición muestra que el chunk de entrada sigue grande,
   agregar `build.rollupOptions.output.manualChunks` en `apps/web/vite.config.ts` (o dos entradas separadas).
2. **Atacar la cascada serial y el握手 TLS** (ataca (b) y (c)):
   `preconnect`/`dns-prefetch` a los orígenes de la API y de Storage en `apps/web/index.html`; y evitar que el
   `src` de la imagen dependa del firmado en un segundo viaje — opciones, de menor a mayor alcance: (i) `preload`
   del `src` firmado apenas llega (no acorta el agua, solo la prioritization), (ii) devolver las URLs firmadas en
   la misma respuesta que los datos de la página (Edge Function o RPC que firme junto con los productos), (iii)
   servir el bucket por URL pública/CDN (cambia el supuesto D1 de FR-031 → decisión de producto y seguridad).
3. **Prioridad de la imagen que es LCP** (ataca (d)): en `catalogo/TarjetaProducto.tsx`, la imagen de la **primera
   fila visible** va con `loading="eager"` + `fetchpriority="high"` y el resto sigue con `lazy`; en
   `ficha/Galeria.tsx:47`, la imagen principal lleva `fetchpriority="high"`. Esto **cambia el criterio de FR-047**
   («imágenes con carga diferida»), así que exige actualizar la spec (`spec.md` D9/FR-047) y el test que lo fija
   (`ImagenProducto.test.tsx`) en el mismo cambio.

**Alternatives**:
- *Medir con Playwright + CDP en vez de Lighthouse*: `Network.emulateNetworkConditions` + `Emulation.setCPUThrottlingRate`
  sobre `apps/web/e2e/` da LCP por `PerformanceObserver` con control fino y sin la dependencia pesada de
  Lighthouse. Trade-off: no produce el informe estándar de Lighthouse (la spec D9 lo nombra explícitamente) y
  hay que escribir el harness; útil como **complemento** para medir el desglose (TTFB / carga de recursos /
  renderizado) que el LCP alone no explica.
- *Extender `.lighthouserc.json` con un segundo `collect` (URL de la tienda en DEV) en vez de un script propio*:
  menos código, pero LHCI con `staticDistDir` no puede Galejar un host distinto, y la medición quedaría atada al
  DEV remoto (ruido de red variable) — peor evidencia.
- *Medir sobre DEV (`https://dev.212-90-120-53.sslip.io`) en vez del stack local*: es el entorno real, pero mezcla
  la latencia del DEV con la emulación 4G; el spec pide emulación, no red real. Aceptable como verificación de
  contraste, no como cifra oficial.
- *No corregir performance y solo dejar la medición*: technically cierra SC-009, pero si la medición reprobra el
  objetivo el criterio sigue sin cumplirse; el seguimiento quedaría sin valor.

**Files likely to change** (parte 1 — medición):
- `apps/web/scripts/lighthouse-tienda.mjs` (nuevo) o `scripts/lighthouse-tienda.mjs` (nuevo)
- `.github/workflows/nightly.yml` (o un workflow nuevo) — correr la medición con el stack de la tienda
- `docs/tienda-movil.md` — llenar la tabla de LCP (líneas 36-40) y el protocolo
- `docs/tecnico/tienda-inicio-busqueda-movil.md` — reemplazar el «Pendiente de evidencia» (líneas 271-276)

**Files likely to change** (parte 2 — performance, si la medición lo pide):
- `apps/web/src/main.tsx` — import diferido del panel
- `apps/web/vite.config.ts` — `manualChunks` / entradas separadas, si hace falta
- `apps/web/index.html` — `preconnect` a Supabase API y Storage
- `apps/web/src/pages/tienda-publica/catalogo/TarjetaProducto.tsx` — primera fila eager + `fetchpriority`
- `apps/web/src/pages/tienda-publica/ficha/Galeria.tsx` — `fetchpriority="high"` en la imagen principal
- `apps/web/src/pages/tienda-publica/ImagenProducto.test.tsx` — actualizar el criterio de `loading`
- `specs/20261024-120000-tienda-inicio-busqueda-movil/spec.md` — D9/FR-047 si cambia el criterio de carga diferida

**Tests to add or update**:
- Vitest `ImagenProducto.test.tsx`: la imagen de la **primera** tarjeta de la grilla **no** es lazy (o lleva
  `fetchpriority="high"`) y las siguientes sí; la imagen principal de la ficha lleva `fetchpriority="high"`.
- Vitest/guard de regresión de bundle: un test que falle si `apps/web/src/main.tsx` vuelve a importar
  `App.tsx` de forma estática (o, si se acepta el test de build, un chequeo de tamaño del chunk de entrada).
- E2E/CI: el job de Lighthouse con aserción `largest-contentful-paint ≤ 3000` en `/`, `/catalogo` y
  `/producto/:id` de las dos tiendas del seed; con `numberOfRuns: 3` y mediana.
- pgTAP: **no aplica** — este seguimiento es de front/performance, no de esquema (sin migración).

## Risks & Considerations

- **No inventar cifras**: la repo lo dice explícitamente («no se inventan», `docs/tiendas-online.md:664`). Si la
  medición no puede correrse en el entorno, se deja «sin medir» con el motivo y se deja el arnés listo; **no** se
  escribe un LCP estimado.
- **Ruido de la medición**: un runner compartido con CPU ×4 emulado da corridas con desviación alta. Mitigación:
  `numberOfRuns: 3` + mediana, y los umbrales por categoría con margen. El repo ya tiene el precedente de que los
  checks de profundidad **fallan** el nightly (`nightly.yml:3-5`, MSF-687): un umbral nuevo que falle de más
  bloquearía el nightly → conviene empezar en `warn` y endurecerlo con cifras estables.
- **Romper el panel al partir el bundle**: `main.tsx` decide panel/tienda en runtime; un `lazy()` mal colocado
  puede mostrar un fallback o perder los providers (`authProvider`, `i18nProvider`, `accessControlProvider`).
  Verificar el panel completo, no solo la tienda.
- **Cambiar `loading="lazy"` es un cambio de criterio de producto**, no un ajuste de performance: FR-047 dice
  «imágenes con carga diferida» y `ImagenProducto.test.tsx` lo fija. Si se hace, la spec y el test se actualizan
  en el mismo cambio (regla del repo: documentación equivalente en el mismo cambio, `pnpm docs:check`).
- **Servir el bucket por URL pública** (alternativa (iii) de la parte 2) cambia el supuesto D1 de FR-031 y las
  políticas de Storage: es decisión de producto/seguridad, no un arreglo técnico. No debe colarse en este
  seguimiento sin el dueño.
- **Duplicación con MSF-552**: `docs/tiendas-online.md:664-671` y `:727-728` trazan la medición Lighthouse de
  `/catalogo` y `/producto/:id` (categoría performance) en **MSF-552**, mientras MSF-560 pide LCP móvil de home +
  catálogo + ficha. Hay solapamiento en catálogo y ficha → conviene un único protocolo y un único dueño.
- **Re-parenting**: MSF-560 fue re-parentado a **MSF-515** (épica de deuda) por decisión del tracker; la deuda es
  real y trazada, pero el entregable (la cifra) sigue siendo de MSF-191/MSF-421 → al cerrar, actualizar
  `docs/tienda-movil.md`, `docs/tecnico/tienda-inicio-busqueda-movil.md` y la fila de la épica en el roadmap.
- **El CI corre en runners self-hosted** (`infra/runner/`): el job de Lighthouse necesita **Chrome** instalado en
  ese runner (el `nightly` ya lo usa vía `@lhci/cli` → se asume que está; verificar antes de cablearlo).

## Open Questions

- [NEEDS CLARIFICATION: ¿Se mide contra el **stack local con el seed** (recomendado: es lo que exige la emulación
  «4G lento» de D9) o contra **DEV** (`https://dev.212-90-120-53.sslip.io`)? Contra DEV la cifra mezcla la latencia
  del DEV con la emulación; se puede hacer como contraste, no como cifra oficial.]
- [NEEDS CLARIFICATION: ¿Se unifican **MSF-552** y **MSF-560** en un solo protocolo y un solo dueño? Ambos miden
  Lighthouse sobre catálogo y ficha; MSF-560 agrega la home y la exigencia de móvil + LCP < 3 s.]
- [NEEDS CLARIFICATION: ¿La cifra que se publica es la **mediana de 3 corridas** por pantalla y por tienda, o el
  peor caso? Recomendación: mediana, y anotar el peor caso también.]
- [NEEDS CLARIFICATION: ¿Se acepta **partar el bundle** panel/tienda (cambio de build y de despliegue) como parte
  de este seguimiento, o queda como deuda aparte (MSF-515) si la medición lo reproba? Es la palanca de mayor
  impacto y la que más superficie de regresión tiene.]
- [NEEDS CLARIFICATION: ¿El bucket privado con URLs firmadas puede pasar a URL pública/CDN (supuesto D1 de
  FR-031)? Es el arreglo de fondo para la cascada RPC → firmado → imagen, pero cambia política de Storage y
  seguridad: decisión del dueño, no técnica.]
- [NEEDS CLARIFICATION: ¿El umbral `< 3 s` se aplica al **LCP del elemento principal** tal como lo define Chrome,
  y con qué tolerancia ante la variabilidad del runner (p. ej. 3,0 s duro vs 3,5 s con aviso)?]
