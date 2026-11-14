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
