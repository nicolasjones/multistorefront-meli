# Bug Assessment: Rendimiento móvil del catálogo y la ficha sin medir (MSF-167 · T071 / SC-010)

- **Slug**: msf-552 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — «[Seguimiento MSF-167] Medir rendimiento móvil del catálogo y la ficha (T071 / SC-010) (It's a Plan MSF-552) slug=msf-552» (sin URL; no se consultó Jira)
- **Verdict**: valid (la medición nunca se ejecutó: T071/SC-010 de la épica MSF-167 quedó cerrado como cumplido sin cifras, y el repo no tiene hoy una forma reproducible de obtenerlas)
- **Severity**: medium

## Report (verbatim or summarized)

> «[Seguimiento MSF-167] Medir rendimiento móvil del catálogo y la ficha (T071 / SC-010) (It's a Plan MSF-552) slug=msf-552»

Reporte en texto plano, **sin URL**: no hay nada que traer ni a que aplicar la política de confianza de URLs (no se clasificó ningún host). No se consultó Jira ni el tracker: el estado del ticket MSF-552 y su alcance exacto no se pudieron verificar desde este entorno.

Contexto verificado en el repo (el seguimiento ya está sembrado en la documentación):

- `docs/tiendas-online.md:662-671` — sección «Rendimiento en celular (T071, SC-010)»: «**No medido todavía.** El entorno donde se cerró la épica no tenía acceso a Docker, así que no hubo stack local con el seed y no hay cifras que registrar (no se inventan). La medición queda trazada en **MSF-552** (seguimiento)», con un protocolo de 4 pasos.
- `docs/tecnico/tienda-catalogo-y-ficha.md:344-347` — «**Rendimiento móvil no medido.** […] Queda trazado en **MSF-552** (seguimiento)».
- `docs/tiendas-online.md:728` — cierre de la épica MSF-191: «Lighthouse en celular (trazado en MSF-552); no hay cifras inventadas».

## Symptom

La tarea **T071** («Medición de rendimiento en celular del catálogo y la ficha») de la épica MSF-167 —el criterio de cierre **SC-010**— nunca se ejecutó: no hay ni una cifra de Lighthouse en perfil móvil sobre `/catalogo` y `/producto/:id` de las dos tiendas del seed, ni medición de `publico.catalogo_pagina_por_dominio` con un catálogo grande. Peor: el criterio quedó **cerrado como cumplido sin evidencia** (la reconciliación de BUG-143 marcó `- [x] T071` en `specs/20261023-120000-tienda-catalogo-y-ficha/tasks/CIERRE.md:7`, mientras `tasks.md:121` sigue con `- [ ] T071`), de modo que hoy nadie puede saber por el estado del repo si el rendimiento móvil del catálogo y la ficha cumple.

Esperado: cifras reales y reproducibles registradas en `docs/tiendas-online.md` («Rendimiento en celular (T071, SC-010)»), con el entorno de medición explícito, y —si el tamaño de página 24 (D3) o la consulta por precio no cumplen— el ajuste anotado, tal como pide la propia T071.

## Reproduction

### A. Observar el hueco (estático, sin Docker)

1. `grep -n "T071" specs/20261023-120000-tienda-catalogo-y-ficha/tasks.md` → línea 121: `- [ ] T071 [CIERRE] Medición de rendimiento en celular del catálogo y la ficha […]`.
2. `grep -n "T071" specs/20261023-120000-tienda-catalogo-y-ficha/tasks/CIERRE.md` → `- [x] T071` («reconciliado, BUG-143») ⇒ **mismo hecho, dos estados contradictorios**.
3. `sed -n '662,671p' docs/tiendas-online.md` → «No medido todavía» + el protocolo pendiente.
4. `grep -rn "sin medir" docs/tienda-movil.md` → LCP de Home, Catálogo y Ficha «sin medir (MSF-560)»: la **misma medición** está trazada por otro seguimiento (MSF-560, épica MSF-191) ⇒ dos tickets, un solo número.
5. `grep -n "url\|formFactor\|startServerCommand" .lighthouserc.json` → la única config de Lighthouse del repo no declara `url`, ni `formFactor`, ni `screenEmulation`, ni `throttlingMethod`, ni `startServerCommand`: `staticDistDir: ./apps/web/dist`, `numberOfRuns: 1` ⇒ el único Lighthouse existente mide la **raíz del panel** sobre el dist estático, no las rutas de la tienda.

### B. Ejecutar la medición (requiere Docker; **no** ejecutada en este entorno)

1. `pnpm dev:supabase` (migraciones + `supabase/seed.sql`: deja las tiendas `mundojc.localhost` y `sanjavucho.localhost` — `supabase/seed.sql:248-251`, `supabase/config.toml:74-79`).
2. Build de la web con **`VITE_PANEL_HOSTS=localhost,127.0.0.1`**: sin esa variable, `vite build` (PROD) **falla seguro** y `mundojc.localhost` sirve el panel en vez de la tienda (`apps/web/src/lib/tienda.ts:24-31`, `apps/web/src/main.tsx:27-46`).
3. Servir el build en un puerto y medir con Lighthouse en perfil móvil (emulación móvil + throttling devtools, como ya pide `docs/tienda-movil.md:33`) sobre `http://mundojc.localhost:<puerto>/catalogo` y `/producto/<id>` de **las dos** tiendas.
4. Medir `publico.catalogo_pagina_por_dominio` con un catálogo de cientos de productos (el seed no llega a eso): hay un precedente reusable, `scripts/medir-tienda-favoritos.sql` (N productos sintéticos, `ROLLBACK`, `NOTICE` con milisegundos).
5. Registrar las cifras reales en `docs/tiendas-online.md` y anotar el ajuste de D3 si el tamaño 24 no cumple.

## Suspected Code Paths

**Estado del criterio (la contradicción de fondo)**

- `specs/20261023-120000-tienda-catalogo-y-ficha/tasks.md:121` — T071 sin marcar (`- [ ]`), con el texto completo de la medición pedida (dos tiendas del seed, perfil móvil, registro en la guía, ajuste de D3).
- `specs/20261023-120000-tienda-catalogo-y-ficha/tasks/CIERRE.md:7` — `- [x] T071` (reconciliación BUG-143): el criterio se dio por hecho **sin evidencia**.
- `specs/20261023-120000-tienda-catalogo-y-ficha/spec.md:351` — definición de SC-010: «medición de rendimiento en celular del catálogo y la ficha, anotada en `docs/tiendas-online.md`».

**Documentación que declara la deuda**

- `docs/tiendas-online.md:662-671` — «Rendimiento en celular (T071, SC-010)»: «No medido todavía» + protocolo de 4 pasos.
- `docs/tecnico/tienda-catalogo-y-ficha.md:344-347` — «Rendimiento móvil no medido» (misma deuda en la guía técnica) + protocolo equivalente.
- `docs/tienda-movil.md:32-40` — «LCP medido: pendiente» con tabla Home/Catálogo/Ficha «sin medir (MSF-560)» ⇒ solapa con esta medición.

**Tooling que hoy no puede producir las cifras**

- `.lighthouserc.json:1-22` — único LHCI del repo: `staticDistDir: ./apps/web/dist`, sin `url`, sin `startServerCommand`, sin `formFactor`/`screenEmulation`/`throttlingMethod`, `numberOfRuns: 1`, aserciones `error` (perf ≥ 0.6). Mide el panel, no la tienda.
- `.github/workflows/nightly.yml:34-37` — `pnpm dlx @lhci/cli@0.16.0 autorun` sobre el dist estático (raíz del panel).
- `docs/profundidad.md:13` — tabla que documenta ese único check de performance.

**Qué hay que medir (superficie de código)**

- `apps/web/src/lib/tiendaListado.ts:10` — `export const TAMANO_PAGINA = 24`: el valor de **D3** que T071 debe validar.
- `apps/web/src/hooks/useCatalogoPublico.ts` — carga infinita: una llamada RPC por tanda (24) + firmado en lote de imágenes de esa tanda; `cargarMas`/`hayMas`/`errorMas`.
- `apps/web/src/lib/tiendaListado.ts` (`leerPaginaCatalogo`) — cliente de la RPC pública del catálogo.
- `apps/web/src/hooks/useFichaProducto.ts` + `apps/web/src/lib/tiendaFicha.ts` — la ficha (`leerFichaProducto` + firmado en lote).
- `apps/web/src/lib/imagenProducto.ts:19` — `urlsImagenesProducto`: una llamada de firmado por tanda (bucket privado, URLs firmadas de una hora).
- `apps/web/src/pages/tienda-publica/rutas/catalogo.tsx` y `rutas/producto.tsx` — rutas `/catalogo` y `/producto/:productoId` (carga diferida en la ficha: `Relacionados` con `lazy`).
- `supabase/migrations/20261023150200_tienda_catalogo_publico.sql:141` — `publico.catalogo_pagina_por_dominio`.
- `supabase/migrations/20270228300400_tienda_publica_rendimiento_y_categorias.sql` — **MSF-825**: con 2.204 productos por tienda, la RPC tardaba 44 s (timeout bajo `anon`) y las categorías 2,5 s; ya está optimizada. Es la línea de base más cercana que hay en el repo.
- `scripts/medir-tienda-favoritos.sql:1-12` — precedente de script de medición con catálogo sintético (N productos, `ROLLBACK`, `NOTICE` con milisegundos), explícitamente «SOLO en una base LOCAL o de pruebas».

**Entorno y precedentes de ejecución**

- `supabase/seed.sql:248-251` — las dos tiendas del seed (`mundojc.localhost`, `sanjavucho.localhost`); `supabase/config.toml:74-79` — el seed corre en `db reset`.
- `apps/web/e2e/tienda-catalogo.e2e.ts` — precedente de servir la app por host en `localhost:<puerto>` y sembrar productos masivos (`MASIVOS = 26`) desde Node con la service-role.
- `.github/workflows/validate.yml:416+` (job `e2e-tienda`) — **el único job que ya tiene lo que la medición necesita**: stack de Supabase con seed (`mundojc.localhost`/`sanjavucho.localhost` verificados), build con `VITE_PANEL_HOSTS=localhost,127.0.0.1` y web servida.

## Root Cause Hypothesis

Dos causas encadenadas, no una sola:

1. **Causa original, ambiental**: la medición exige Docker (stack local con el seed) y un build servido por host; el entorno de cierre de MSF-167 no tenía Docker, así que no hubo cifras. El cierre lo dejó asentado con honestidad («No medido todavía», «no se inventan», commit `63b95a2e`) y abrió el seguimiento MSF-552. Ese comportamiento es el correcto y no hay nada que corregir en él.

2. **Causa de fondo, de proceso**: la deuda quedó sin dueño ejecutable. La épica se cerró, la reconciliación de BUG-143 marcó T071 como `[x]` en `tasks/CIERRE.md` **sin evidencia**, mientras `tasks.md` la dejó en `[ ]`; y el repo no quedó con ninguna forma reproducible de obtener las cifras — el único Lighthouse (`.lighthouserc.json`) mide la raíz del panel sobre el dist estático, y el paso 3 del protocolo (medir la RPC con un catálogo de cientos de productos) no tiene script: el seed no tiene ese volumen y la única precedente (`scripts/medir-tienda-favoritos.sql`) es de otra RPC. Mientras no exista medición repetible, el criterio puede volver a cerrarse «sin medir» en cualquier cierre de épica.

Confianza: **alta** en «no se midió» (documentado en dos guías, en el commit de cierre y en las tareas de CIERRE); **media** en el resto (no hay acceso a Jira para confirmar el estado/ alcance de MSF-552 ni si el seguimiento debía reconciliar además `tasks.md`).

## Proposed Remediation

**Preferred**: (a) medir de verdad y registrar las cifras; (b) dejar la medición repetible en el repo, para que SC-010 no pueda volver a cerrarse sin evidencia.

1. **Medición (una vez, con el stack local)**
   - Build con `VITE_PANEL_HOSTS=localhost,127.0.0.1` y preview en un puerto; Lighthouse en perfil móvil (emulación móvil + throttling devtools, no preset desktop) sobre `/catalogo` y `/producto/:id` de `mundojc.localhost` **y** `sanjavucho.localhost`.
   - RPC con catálogo grande: crear `scripts/medir-tienda-catalogo.sql` copiando el patrón de `scripts/medir-tienda-favoritos.sql` (N productos sintéticos, `ROLLBACK`, `NOTICE` con milisegundos por llamada y por modo de orden/filtro).
   - Registrar las cifras reales —con su entorno (Postgres local, seed o catálogo sintético, nº de productos, nº de corridas)— en `docs/tiendas-online.md` («Rendimiento en celular (T071, SC-010)»), en `docs/tecnico/tienda-catalogo-y-ficha.md` («Límites y deuda») y en la tabla LCP de `docs/tienda-movil.md`. **Una sola medición, tres documentos**: MSF-560 espera los mismos LCP desde la épica móvil y no puede quedar con números distintos.
   - Si el tamaño 24 (D3) o la consulta por precio no cumplen, anotar el ajuste, como pide T071.

2. **Repetibilidad (para que no se repita el hueco)**
   - Config LHCI propia de la tienda (p. ej. `.lighthouserc.tienda.json`) con `url` para las 4 rutas (2 tiendas × 2 rutas), `settings.formFactor: mobile`, `screenEmulation` y `throttlingMethod: devtools`, `numberOfRuns: 3` y el arranque del build. **No** tocar `.lighthouserc.json`: hoy el `nightly` falla (assert `error`) si baja del umbral y el panel se vería afectado.
   - Enganchar la medición al job `e2e-tienda` de `.github/workflows/validate.yml` (ya tiene stack con seed + build con `VITE_PANEL_HOSTS` + web servida) o al `nightly` (que ya instala `@lhci/cli`), guardando el reporte en `reports/lighthouse/` (queda en el runner; no se sube como artefacto). El paso de build **debe** definir `VITE_PANEL_HOSTS`, si no mide el panel.
   - Un script npm nuevo (`medir:tienda` / `test:medir:tienda`) para que el protocolo sea un comando y no una receta prosea.

**Alternatives**

- **Medir contra la demo con datos reales** (2.204 productos por tienda, los mismos de MSF-825) en vez del seed: cifras mucho más representativas del techo de diseño, a costa de reproducibilidad (depende de ese entorno). Se puede combinar: seed para Lighthouse + catálogo sintético para la RPC.
- **Cerrar el seguimiento sin medir** (marcar la deuda como «fuera de alcance»): **no cumple** T071/SC-010 ni la regla del repo de que ninguna tarea de `tasks.md` queda `[ ]`. Sólo sería aceptable si se cambia explícitamente SC-010 en la spec, con evidencia y decisión registrada.

**Files likely to change**

- `docs/tiendas-online.md` — sección «Rendimiento en celular (T071, SC-010)»: cifras reales (reemplaza «No medido todavía»).
- `docs/tecnico/tienda-catalogo-y-ficha.md` — «Límites y deuda»: la misma medición.
- `docs/tienda-movil.md` — tabla de LCP (Home/Catálogo/Ficha): pasa de «sin medir (MSF-560)» a los valores medidos (o nota de que MSF-560 queda cubierto por MSF-552).
- `specs/20261023-120000-tienda-catalogo-y-ficha/tasks.md:121` — cerrar T071 con la evidencia (commit, reporte) o con la nota de desvío que corresponda; y `specs/20261023-120000-tienda-catalogo-y-ficha/tasks/CIERRE.md:7` — reconciliar la marca `[x]` sin evidencia.
- `scripts/medir-tienda-catalogo.sql` (nuevo) — medición de `publico.catalogo_pagina_por_dominio` con catálogo grande, siguiendo el patrón de `scripts/medir-tienda-favoritos.sql`.
- `.lighthouserc.tienda.json` (nuevo) — medición Lighthouse móvil de la tienda; `.lighthouserc.json` intacto.
- `.github/workflows/validate.yml` (job `e2e-tienda`) o `.github/workflows/nightly.yml` — paso de medición + resumen del job (no se sube artefacto).
- `package.json` — script `medir:tienda` (y su test).

**Tests to add or update**

- Check documental que falle si la sección de rendimiento vuelve a decir «No medido todavía» / «sin medir» o si trae cifras sin entorno declarado: `scripts/verificar-medicion-tienda.mjs` + test en `scripts/*.test.mjs` (al estilo de `scripts/verificar-documentacion-cambios.mjs`, que ya corre en `pnpm docs:check`). Es el test que convierte el aprendizaje «cifras sin fuente» en algo verificable.
- Test de humo del script SQL de medición: correr con N chico y exigir que imprima las `NOTICE` con milisegundos (y que haga `ROLLBACK`: no deja datos).
- Test de la config LHCI de la tienda: que declare `url` para las 4 rutas y `formFactor: mobile` (evita un «Lighthouse móvil» que en realidad mide el panel).
- No hacen falta E2E nuevos de UI: ya existen `apps/web/e2e/tienda-catalogo.e2e.ts` y `tienda-ficha.e2e.ts`; sí hay que asegurar que el build del job que mide siga definiendo `VITE_PANEL_HOSTS` (mismo requisito que usa `E2E_TIENDA_CI`).

## Risks & Considerations

- **Cifras sin fuente / inventadas**: el aprendizaje del repo (`cifras_sin_fuente`) exige que todo número venga de su fuente citada. Si no se puede medir, **no** se escribe un número: se mantiene «no medido» con su motivo y la tarea queda trazada. El protocolo no admite estimaciones.
- **Cifras no comparables**: el número depende del entorno (Postgres local vs dev, seed vs 2.204 productos, CPU y red). Registrar siempre el entorno y aclarar que una medición local es estimación de órdenes de magnitud, no un SLA (mismo criterio que `scripts/medir-tienda-favoritos.sql`).
- **Solape con MSF-560**: `docs/tienda-movil.md` espera los LCP de home/catálogo/ficha bajo MSF-560. Dos mediciones independientes darían dos números contradictorios en la documentación ⇒ medir una vez y actualizar los tres documentos.
- **No romper el `nightly`**: `.lighthouserc.json` usa `assert` en `error` y corre en el nightly; tocarlo (agregar URLs de la tienda o cambiar el `staticDistDir`) puede ponerlo rojo y sin la app de la tienda servida ⇒ config aparte y job aparte.
- **Minutos de CI**: el CI corre en runners self-hosted (`infra/runner/`); un paso de Lighthouse con navegador es caro ⇒ medir en el `nightly` (no bloqueante) o en un job scheduled, no en el camino crítico del PR.
- **Ajuste de D3 con efecto en la UI**: si el tamaño 24 no cumple, cambiar `TAMANO_PAGINA` (`apps/web/src/lib/tiendaListado.ts:10`) y el tamaño de tanda de la RPC altera la carga infinita (tarjetas por tanda) ⇒ es un cambio de producto: entra por spec (no en el paquete de bug), con sus pruebas.
- **Sin Docker en este entorno**: la medición no puede ejecutarse desde el nodo de ejecución; hay que dejar el procedimiento exacto (comandos, variables, URLs) para quien tenga el stack, o correrlo en el CI.
- **No tocar el `seed.sql` con datos de medición**: los productos sintéticos van en el script con `ROLLBACK` (o en un script de siembra aparte), nunca en el seed que corre en el CI.
- **Reconciliación de estados**: cerrar T071 implica que `tasks.md` y `tasks/CIERRE.md` digan lo mismo; si queda `[ ]` en `tasks.md`, la regla del repo («ninguna tarea queda `[ ]`») sigue incumplida.

## Open Questions

- [NEEDS CLARIFICATION: ¿MSF-552 existe como ticket en el tracker con ese alcance (catálogo + ficha de MSF-167) o también cubre la home de MSF-191 (que hoy espera MSF-560)? No hay acceso a Jira desde este entorno.]
- [NEEDS CLARIFICATION: ¿las cifras se miden contra el seed local (pocos productos) o contra la demo con 2.204 productos por tienda? El protocolo de `docs/tiendas-online.md:668` pide «un catálogo de cientos de productos», que el seed no tiene.]
- [NEEDS CLARIFICATION: ¿el seguimiento debe cerrar además T071 en `tasks.md` y reconciliar `tasks/CIERRE.md` (que hoy dice `[x]` sin evidencia), o alcanza con registrar las cifras en la guía?]
- [NEEDS CLARIFICATION: ¿el umbral de aceptación (LCP < 3 s con «4G lento» y CPU ×4, el que menciona `docs/tienda-movil.md:33`) aplica igual a catálogo y ficha, o hay que definirlo?]
- [NEEDS CLARIFICATION: ¿la medición tiene que quedar en el CI (job `e2e-tienda` o `nightly`) como entregable, o basta con el script reproducible y las cifras registradas en la guía?]
