# Bug Assessment: [Lote L36] Higiene de código y referencias internas (3 bugs consolidados)

- **Slug**: msf-895
- **Created**: 2026-11-14
- **Source**: pasted text (tracker MSF-895) — sólo el título del lote; el cuerpo del plan no vino en el payload. Sin URL ⇒ no aplica la URL Trust Policy (no hubo fetch).
- **Verdict**: valid
- **Severity**: low

## Report (verbatim)

> [Lote L36] Higiene de código y referencias internas (3 bugs consolidados) (It's a Plan MSF-895) slug=msf-895

El payload del tracker trae **únicamente el título** del lote: no incluye la lista de los tres hallazgos originales, ni pasos de reproducción, ni archivos. Por eso los tres defectos de este assessment fueron **reconstruidos contra el estado del repo** de la rama `fix/bug-MSF-895` (HEAD `f5d8f4a5`, base `origin/dokploy@1ad0fd2e`) y cada uno se apoya en evidencia reproducible (comando local + CI real). El mapeo 1:1 con los tres hallazgos del plan no pudo verificarse (ver **Open Questions**).

Los tres defectos consolidados que sostienen el título:

| # | Defecto | Evidencia |
|---|---------|-----------|
| B1 | `docs/manifest.json` graba el SHA del **merge efímero** ⇒ el guard «inventario y manifest al día» no puede dar verde en un PR | `scripts/docs-manifest.mjs:67` vs. `:12` |
| B2 | 25 enlaces internos de `docs/` apuntan **fuera de `docs/`** (a `../specs/…`) ⇒ `docs-check` rojo | `scripts/docs-check.mjs:129-131` |
| B3 | El guard de arquitectura (`dependency-cruiser`) **no analiza el front**: 0 módulos ⇒ «arquitectura: ok» sin señal (higiene de código) | `scripts/calidad.mjs:76` |

## Symptom

B1: el workflow `docs` falla en el paso «inventario y manifest al día» de **todo** PR que toque una página documentada, aunque el manifest commiteado sea correcto, porque al regenerarlo en el checkout de merge del CI el campo `sourceAt` de 13 páginas se recalcula contra el commit efímero de auto-merge (`ea32db73`) en lugar del commit real del PR (`a6412c5d`). B2: `node scripts/docs-check.mjs` termina con exit 1 y 25 errores «(fuera de docs/)» en 16 páginas del sitio. B3: `pnpm calidad` (y el job `quality`, que es check **requerido**) reporta «dependency-cruiser (arquitectura): ok» después de cruzar **0 módulos y 0 dependencias**: las tres reglas de arquitectura nunca se evaluaron sobre `apps/web/src`.

## Reproduction

### B1 — manifest inestable en el checkout de merge (CI rojo en el paso 6)

1. `git fetch origin && git worktree add --detach /tmp/wt983 ea32db73` (merge commit de PR #983: `f1987054` + `a6412c5d`, el árbol que prueba el CI).
2. En `/tmp/wt983`: `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`.
3. `git status --short docs/_generated docs/manifest.json` → `M docs/manifest.json` (26 inserciones / 26 eliminaciones: `sourceAt`, `sourceHash` y `commit` de 13 páginas, p. ej. `docs/acceso-soporte.md`, `docs/actividad.md`, `docs/operar-superset.md`, `docs/permisos-por-rol.md`).
4. `git diff --exit-code docs/_generated docs/manifest.json` → **exit 1** ⇒ el paso «inventario y manifest al día» de `.github/workflows/docs.yml:30-34` falla.
5. Contraste: en el commit base `f1987054` (sin merge) los mismos dos comandos dejan el árbol **limpio** ⇒ la inestabilidad la introduce el merge, no el contenido de las páginas.
6. CI real: run `43625243985` (PR #983, head `a6412c5d`, base `dokploy@f1987054`) y run `43624365589` → job `build`, **paso 6 «inventario y manifest al día» = failure** y paso 7 (`docs-check`) = `skipped`.

### B2 — enlaces internos fuera de `docs/`

1. `node scripts/docs-check.mjs` (o `pnpm docs:wiki:check`).
2. Salida: `✅ nav: 180 páginas`, `✅ links internos: 1811`, `❌ docs/api-publica.md → ../specs/20270203-100000-api-e-asistente-con-ia/spec.md (fuera de docs/)`, … y al final **`25 problema(s) de documentación`** (exit 1).
3. Distribución: 25 enlaces en 16 páginas — `docs/api-publica.md` (1), `asistente-catalogo.md` (2), `consultas.md` (2), `contactos.md` (1), `documentos-ia.md` (1), `dolar-y-recalculo.md` (2), `migracion-inicial-de-datos.md` (1), `precios-masivos.md` (1), `precios.md` (3), `promociones-precio.md` (1), `rentabilidad.md` (3), `reportes-inventario.md` (2), `service-repuestos-devolucion.md` (1), `service-repuestos-pendiente.md` (1), `tienda-contacto.md` (1), `ventas-reportes.md` (2).
4. Contraste: en `origin/dokploy@f1987054` (PR #974, MSF-862) el mismo script dice **«Documentación OK»** ⇒ los 25 enlaces ya fueron corregidos aguas arriba y esta rama (base `dokploy@1ad0fd2e`, anterior a ese merge) los arrastra.

### B3 — guard de arquitectura con cobertura 0

1. `pnpm calidad:code` (o `pnpm calidad`).
2. Salida: `== dependency-cruiser (arquitectura): ok` → `✔ no dependency violations found (0 modules, 0 dependencies cruised)` + `‼ missing-tsc-transpiler: … Install typescript to get better results`.
3. El mismo binario sobre código JS sí funciona: `pnpm dlx --package=dependency-cruiser@18.7.2 depcruise --config .dependency-cruiser.cjs scripts` → `62 modules, 141 dependencies cruised` y 2 avisos `no-orphans` (`scripts/verificar-superset-embebido.mjs`, `scripts/verificar-salida-correo.mjs`).
4. Sobre un proyecto TypeScript mínimo (2 archivos) también da 0 módulos; agregar `typescript@5.9.3` al `dlx` no lo corrige.
5. `knip` (el guard de código muerto) **sí** analiza TypeScript (probe: marca `src/huerfano.ts` como archivo sin uso) ⇒ el «código muerto: ok» es un verde real; el hueco es específico de `dependency-cruiser`.

## Suspected Code Paths

- `scripts/docs-manifest.mjs:12` — `headRef()` = `git rev-parse --short HEAD`; en el checkout de merge del CI devuelve el commit **efímero** de auto-merge.
- `scripts/docs-manifest.mjs:67` — `const sourceAt = sources.length ? (reusar ? old.sourceAt : headRef()) : null;` ⇒ `sourceAt` se graba contra HEAD; es el valor que difiere del manifest commiteado.
- `scripts/docs-manifest.mjs:68-72` — el propio script ya documenta el defecto para el campo `commit` («en el checkout de merge del CI `git log` devuelve el commit efímero de auto-merge (imposible de pre-commitear) y el check nunca puede dar verde en un PR que toque una página con sources») y lo esquiva con `--no-merges`. `sourceAt` quedó con el mismo defecto ⇒ la mitad del arreglo no llegó.
- `.github/workflows/docs.yml:30-34` — paso «inventario y manifest al día»: `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs && git diff --exit-code docs/_generated docs/manifest.json`.
- `.github/workflows/docs.yml:36` — paso «links, nav e inventario» (`node scripts/docs-check.mjs`).
- `scripts/docs-check.mjs:129-131` — `fueraDeDocs()` + error «(fuera de docs/)»; la lista de páginas `exclude_docs` está en `mkdocs.yml:11-14` (`/roadmap-template.md`, `/skills.md`, `/desenar-conector.md`).
- `scripts/calidad.mjs:76` — `pnpm dlx --package=dependency-cruiser@18.7.2 depcruise --config .dependency-cruiser.cjs apps/web/src packages` (sandbox sin compilador de TypeScript).
- `.dependency-cruiser.cjs:16-30` (`no-orphans`), `.dependency-cruiser.cjs:31-40` (`not-to-dev-dep`), `.dependency-cruiser.cjs:42-48` (`options.tsPreCompilationDeps: true` + `exclude`) — las reglas que nunca corrieron sobre el front.
- `.github/workflows/quality.yml:35-41` — job `quality` (check **requerido**) que corre `pnpm calidad` y se apoya en ese «ok».

## Root Cause Hypothesis

Los tres defectos son la misma clase de error: **guards de higiene que se ejecutan en un entorno distinto del que asumen**, y por eso dan un veredicto que no corresponde al código bajo prueba. (B1) El manifest guarda dos referencias a git —`sourceAt` y `commit`— y sólo la segunda se volvió estable entre el PR y su merge; `sourceAt` quedó atada a `HEAD`, que en CI es el commit efímero de merge ⇒ el propio paso que valida el manifest lo invalida. (B2) Las páginas del sitio enlazan a las specs como «fuera de `docs/`», forma que el guard de enlaces y el build estricto de MkDocs rechazan; el arreglo ya existe aguas arriba (MSF-862) y esta rama va atrasada. (B3) El guard de arquitectura corre la herramienta en un sandbox `pnpm dlx` sin compilador de TypeScript, así que la herramienta descarta los `.ts/.tsx` y devuelve «ok» sobre cero módulos: el falso verde más peligroso de los tres, porque es el único que se presenta como cobertura completa. Confianza: **alta** para B1 y B3 (reproducidos localmente y contrastados con CI real); **media-alta** para B2 (reproducido, pero su mapeo con el hallazgo original del plan no pudo confirmarse).

## Proposed Remediation

**Preferido** (un commit por defecto, sin tocar migraciones, RLS ni esquema):

1. **B1** — hacer estable `sourceAt` igual que `commit`: calcularlo con `git log -1 --no-merges --format=%h -- <fuentes…>` en vez de `headRef()`, de modo que el manifest commiteado y el regenerado en el checkout de merge coincidan. Mantener la semántica que el drift espera (`sourceAt` = commit contra el que se calculó `sourceHash`; `scripts/docs-drift.mjs:25-32` usa `git ls-tree` sobre ese commit). Alternativa: que el paso de CI regenere el manifest y compare **sólo** los campos estables (`pageHash`, `sourceHash`, `sources`, `owner`) e ignore `sourceAt`/`commit` — peor: esconde el valor y deja el drift menos preciso.
2. **B2** — traer el merge de MSF-862: rebasar la rama sobre `origin/dokploy` (que ya tiene `docs-check` en verde) en lugar de reescribir 25 links a mano. Si el destino final es `main`, además hay que llevar el arreglo de MSF-862 a `main` (hoy `main` sólo tiene `docs/roadmap-template.md` con esos enlaces, y esa página está en `exclude_docs`, así que `docs-check` pasa en `main`).
3. **B3** — que `dependency-cruiser` pueda resolver el compilador de TypeScript: instalar `dependency-cruiser` (y `typescript`) como `devDependencies` del root y correr el binario local (`pnpm exec depcruise …`) en vez del sandbox `pnpm dlx`, o pasar `--ts-config apps/web/tsconfig.json` con TypeScript resoluble. Con eso el guard pasa a cruzar los ~430 módulos de `apps/web/src` y las reglas `no-circular`, `no-orphans` y `not-to-dev-dep` empiezan a tener valor real — **hay que esperar hallazgos nuevos** (huérfanos, ciclos, deps de desarrollo) y decidir con criterio cuáles se corrigen y cuáles se documentan como excepciones.

**Alternativas**:
- B3 alternativo: cambiar el criterio de «ok» por «cobertura» — hacer que `scripts/calidad.mjs` falle si `dependency-cruiser` cruza 0 módulos (señal explícita de «no se revisó nada»), aunque la herramienta no se pueda arreglar de inmediato.
- B1 alternativo: que el workflow haga el checkout del **head** del PR en vez del merge para el paso del manifest (`ref: ${{ github.event.pull_request.head.sha }}`) — rápido, pero pierde la verificación del resultado del merge.

**Files likely to change**:
- `scripts/docs-manifest.mjs` (B1: `sourceAt` estable).
- `scripts/calidad.mjs` y/o `package.json` (B3: invocación local de `dependency-cruiser` + `typescript` como devDependency) y `pnpm-lock.yaml`.
- `scripts/docs-check.test.mjs` (B2/B1: test del guard).
- `docs/**` y `docs/manifest.json` sólo si B1 exige regenerar el manifest commiteado (cambio mecánico, sin contenido nuevo).
- `.github/workflows/docs.yml` (B1: ajuste del paso, si se elige la alternativa del checkout del head).

**Tests to add or update**:
- Test de regresión de `docs-manifest.mjs`: generar el manifest en un repo temporal con un commit de merge y comprobar que `sourceAt` **no** cambia respecto del commit real (hoy no hay ningún test del manifest: `scripts/` sólo tiene `docs-check.test.mjs` y `docs-yaml.test.mjs`).
- Test del guard de enlaces: que `docs-check` rechace un link a `../specs/…` desde `docs/` (el comportamiento ya existe en `scripts/docs-check.test.mjs`; conviene que cubra una página real del conjunto de 16).
- Test del guard de arquitectura: que `scripts/calidad.mjs` falle (o avise) cuando `dependency-cruiser` cruza 0 módulos, para que un falso verde no vuelva a pasar inadvertido.
- Test de no-regresión de `pnpm docs:wiki:check` completo en verde sobre la rama.

## Hallazgos adyacentes (fuera de los tres consolidados; no bloquean este lote)

- **A1 — referencias a migraciones con el nombre viejo** (renumeradas): 12 en `docs/` — `docs/tecnico/tienda-dominio-y-publicacion.md:35-37` (hoy `20270205110000_tienda_dominio_verificacion.sql`, `20270205110100_tienda_borrador_publicacion.sql`, `20270205110200_tienda_versiones.sql`), `docs/service-cobro.md:28-32`, `docs/tecnico/tienda-whatsapp-y-contacto.md:36-37`, `docs/tecnico/cuenta-web-cliente.md:29`, `docs/tecnico/listados.md:214` — y 9 en `.specify/bugs/`: `msf-724/fix.md:4-6`, `msf-528/fix.md:7`, `msf-524/fix.md:8`, `msf-642/assessment.md:31,34,36,64,65`, `msf-524/assessment.md:31`.
- **A2 — drift de documentación**: `node scripts/docs-drift.mjs` → exit 1, **174 páginas** con la fuente cambiada. Deuda ya anotada en `.github/workflows/docs.yml:3-6`.
- **A3 — warnings de `oxlint`**: ~40 avisos de `react-hooks`/`react` (p. ej. `apps/web/src/hooks/useEmpresaActiva.ts:42` — dependencia innecesaria `organizacionId`; `apps/web/src/pages/stock/NuevoMovimientoDialog.tsx:113` — dependencia faltante `productoId`). El job `quality` sólo falla con errores, así que hoy no bloquean.

## Risks & Considerations

- **Sin impacto funcional ni de datos**: los tres defectos son de proceso/higiene. No tocan migraciones, RLS, esquemas ni runtime ⇒ el riesgo de regresión funcional es bajo (coherente con la severidad `low` del repo para «higiene de proceso»).
- **No bloquea merges hoy**: los checks requeridos de `main` son sólo `build` (`gh api …/branches/main/protection` → `contexts: ["build"]`); `docs` y `quality` no son checks requeridos. `docs` corre en PRs a `main`, push a `main` y manual (`.github/workflows/docs.yml:7-12`).
- **B3 puede destapar deuda real**: al habilitar `dependency-cruiser` sobre `apps/web/src` van a aparecer huérfanos, ciclos o imports de devDependencies que hoy nadie ve. Conviene habilitarlo en modo *warn* yendo a *error* por etapas, con excepciones documentadas, para no romper el job `quality` (requerido) de golpe.
- **B1 puede cambiar el manifest commiteado**: al hacer estable `sourceAt` va a haber que regenerar `docs/manifest.json` una vez; ese commit toca 13+ páginas del manifest y es puramente mecánico (no altera contenido de docs). `docs/_generated/inventory.json` e `inventory.md` no deberían cambiar (en la reproducción sólo cambió `docs/manifest.json`).
- **B2 depende de la integración dokploy→main**: corregir los links a mano en esta rama y luego mergear MSF-862 al revés genera conflictos en 16 páginas. Preferible rebasar sobre `origin/dokploy`.
- **Orden de ejecución**: B3 depende de agregar dependencias al root (`pnpm-lock.yaml`); B1 depende de decidir si el guard del CI sigue validando el manifest en el checkout de merge.

## Open Questions

- [NEEDS CLARIFICATION: el payload del tracker sólo trae el título del lote («3 bugs consolidados»); no llegaron los tres hallazgos originales, sus archivos ni sus pasos de reproducción. ¿Cuáles eran exactamente? La reconstrucción de este assessment (B1/B2/B3) puede no coincidir con el plan.]
- [NEEDS CLARIFICATION: ¿el lote se arregla sobre `dokploy` (la base de esta rama, donde ya está MSF-862) o sobre `main` (donde corre el workflow `docs` y donde `docs-check` hoy pasa porque `roadmap-template.md` está en `exclude_docs`)?]
- [NEEDS CLARIFICATION: ¿el guard de arquitectura debe pasar a `error` cuando cruce 0 módulos (B3), o alcanza con que avise? Afecta al check requerido `quality`.]
- [NEEDS CLARIFICATION: ¿los 174 páginas de drift (A2) entran en este lote o quedan como deuda ya anotada en `docs.yml:3-6`?]
