---
owner: tecnico
sources:
  - specs
---

# Documentación obligatoria de cambios

La documentación es parte del contrato de cada cambio. Cualquier modificación
en `apps/`, `workers/`, `supabase/`, `infra/`, `scripts/`, `packages/` o
`.github/` debe actualizar en el mismo cambio una spec, una guía en `docs/`,
`AGENTS.md`, `CLAUDE.md` o la constitución. En una corrección de bug cuenta también
el registro del flujo oficial en `.specify/bugs/<slug>/` (`assessment.md`,
`fix.md`, `test.md`) y la constitución en `.specify/memory/`; el resto de `.specify/`
(plantillas, scripts, extensiones) no cuenta como documentación.

El control `pnpm docs:check` compara la rama con su base Git y falla si detecta
código o infraestructura sin una actualización documental. En un pull request
el workflow obtiene el historial completo y usa `GITHUB_BASE_REF`; en local se
puede indicar otra base con `DOCUMENTATION_CHECK_BASE`.

La documentación debe registrar la decisión, el contrato afectado, los riesgos,
la validación ejecutada y cualquier limitación pendiente. Los archivos generados
(por ejemplo `docs/schema.html`) no reemplazan la documentación fuente.

## Dueños (`owner`) y fuentes (`sources`) de cada página

Cada página de `docs/` declara en su front matter un `owner` y una lista `sources`
(`pnpm docs:wiki:check` falla si falta alguno; `sources: []` es válido solo para páginas
estáticas, como un índice). El validador acepta cualquier texto no vacío como `owner`; la
convención vigente usa cinco valores, según **quién responde por la exactitud de la página**:

| `owner` | Qué páginas |
|---|---|
| `producto` | Guías de uso y funcionales para quien opera el panel (`docs/producto/`, el índice `docs/README.md`, `guia-funcional.md`, `ayuda-en-panel.md`). |
| `tecnico` | Referencia de ingeniería de una funcionalidad: modelo de datos, RPC, RLS, migraciones, decisiones (`docs/tecnico/` y las guías planas `docs/<tema>.md`). Es el valor por defecto. |
| `plataforma` | CI, guardas de migraciones, pruebas, adopción de plantillas, revisiones de seguridad y acceso de soporte auditado. |
| `operacion` | Runbooks y procedimientos de operación: copias y restauración, simulacro, operar y entregar el sistema, pasos manuales en VPS2, monitoreo. |
| `datos` | Analítica y reportes (Superset, tableros y reportes de ventas, inventario, servicio y rentabilidad). |

Las fuentes (`sources`) son rutas que **existen** en el repo y que la propia página cita o
documenta: primero las carpetas `specs/<épica>` mencionadas en el texto, después `infra/`,
`workers/`, `scripts/`, `apps/`, `design/` y, por último, las migraciones o pruebas SQL que la
página nombra. Se usa la ruta más específica (no `specs` entero) para que el *drift* avise solo
cuando cambia algo que la página realmente documenta. Una página sin fuente verificable se
declara estática (`sources: []`); no se inventan fuentes.

Las guías planas `docs/<tema>.md` que tienen una versión reorganizada en `docs/tecnico/<tema>.md`
o `docs/producto/<tema>.md` no se borran: llevan un aviso cruzado con enlaces en ambos sentidos y
figuran en la sección «Guías de referencia» del menú, porque conservan detalle (contratos, RPC,
migraciones) que las versiones reorganizadas no siempre repiten. Los enlaces a `specs/` desde
`docs/` se escriben como ruta entre comillas invertidas, no como enlace Markdown, porque el sitio
solo publica `docs/` (`mkdocs build --strict` aborta con enlaces que salen del árbol). Las anclas
`#...` de MkDocs van sin tildes (`#reversion`, no `#reversión`).

## Control del wiki en `dokploy` y en el Release

`docs.yml` corre solo en PR hacia `main` y en push a `main`. Muchas páginas declaran como fuente un
directorio entero (`specs`, `supabase/migrations`, `apps/web/src`), así que el control de drift
(`node scripts/docs-drift.mjs`) salta con cualquier PR a `dokploy`. Antes del Release (MSF-858): revisar
las páginas que lista el drift y regenerar con `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`
en el PR `dokploy` → `main`. Acotar las fuentes de cada página a su spec o archivo concreto permitiría
volver a correr el control en cada PR.

## Capturas del manual: regla de proceso y estado (MSF-644, MSF-877)

**Regla (MSF-644).** Todo PR que cambia una pantalla rehace las capturas del manual de usuario que esa pantalla
ilustra. El comando es `pnpm docs:capturas` (raíz; delega en `pnpm --filter @platform/web docs:capturas`, que corre
`playwright test -c playwright.capturas.config.ts`, definido en `apps/web/package.json`). Para un solo spec:
`pnpm docs:capturas 20-ventas`. Los specs están en `apps/web/e2e/capturas/` (`10-primeros-pasos`, `20-ventas`,
`30-stock`, `40-catalogo-tiendas`, `50-service-consultas`, `pantallas`) y escriben en `docs/producto/img/<página>/`
(variable `CAPTURAS_DESTINO` para cambiar el destino). Si el PR no puede rehacerlas (p. ej. no hay stack), lo declara en
su descripción y la página queda anotada como pendiente de recaptura.

**Requisitos.** Stack local de Supabase con el dataset demo (`pnpm demo:dataset -- --reset`, ver `dataset-demo.md`) y la
web servida (`E2E_BASE_URL`) o el build para `vite preview`; variables `SUPABASE_URL` y `SUPABASE_ANON_KEY`. Las
capturas son de solo lectura (no confirman formularios). No corren con `pnpm test:e2e` ni en el CI público (config
aparte a propósito, `apps/web/playwright.capturas.config.ts`).

**Estado (MSF-877, 2026-11-17).** El repo tiene 262 imágenes versionadas bajo `docs/producto/img/`, en 44 carpetas.
Esta revisión de documentación **no regeneró imágenes**, porque hacerlo exige levantar el stack con el dataset demo.
Las capturas de pantallas cambiadas hoy (Productos con Margen, Empresas, Migración de datos con pestañas, Actividad,
Importaciones) quedan pendientes de recaptura con el comando de arriba. Además, el comentario de
`playwright.capturas.config.ts` remite a un `docs/capturas-documentacion.md` que no existe; la guía vigente es
`dataset-demo.md`.

## Ramas `main` y `dokploy`: estado y reconciliación de la documentación (MSF-590)

**Estado (medido el 2026-11-17 con `git rev-list --left-right --count origin/main...origin/dokploy`).** `main` tiene 16
commits que `dokploy` no tiene y `dokploy` tiene 4186 que `main` no tiene (ancestro común `54ea7b1b`). Los 16 de `main`
son de documentación salvo uno: manual de Inicio con capturas (`docs/producto/img/inicio/`), alineación de avisos de
faltantes (MSF-161), cierres documentales de MSF-176, MSF-265, MSF-467 y MSF-469, y el workflow
`.github/workflows/e2e-nocturno.yml` (llevado a `main` para que dispare el cron). Hay 51 archivos de `docs/` distintos
entre ambas ramas. La documentación de usuario quedó escrita en `main` sin el código que la respalda, que vive solo en
`dokploy`.

**Procedimiento de reconciliación (sin tocar `main` desde `dokploy`).**

1. La reconciliación ocurre en el PR `dokploy` → `main` (Release), no con cambios directos en `main`.
2. Antes del Release, en una rama desde `dokploy`: `git merge origin/main`. Los conflictos de `docs/` se resuelven a favor
   del contenido de `dokploy` (que refleja el código vigente) salvo los textos y capturas que solo existen en `main`
   (manual de Inicio), que se revisan contra el código de `dokploy` antes de conservarlos.
3. `docs/manifest.json` y `docs/_generated/` no se resuelven a mano: `git checkout --theirs` y regenerar con
   `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`.
4. Correr `node scripts/docs-drift.mjs` y `node scripts/docs-check.mjs`; revisar las páginas con deriva (MSF-858).
5. Recién entonces abrir el PR a `main`; `docs.yml` corre en PR hacia `main`.

Pendiente: este procedimiento no se ejecutó en este lote (no se tocó `main`); la integración de `origin/main` en `dokploy`
queda para quien prepare el Release.
