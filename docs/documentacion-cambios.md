# Documentación obligatoria de cambios

La documentación es parte del contrato de cada cambio. Cualquier modificación
en `apps/`, `workers/`, `supabase/`, `infra/`, `scripts/`, `packages/` o
`.github/` debe actualizar en el mismo cambio una spec, una guía en `docs/`,
`AGENTS.md`, `CLAUDE.md` o la constitución.

El control `pnpm docs:check` compara la rama con su base Git y falla si detecta
código o infraestructura sin una actualización documental. En un pull request
el workflow obtiene el historial completo y usa `GITHUB_BASE_REF`; en local se
puede indicar otra base con `DOCUMENTATION_CHECK_BASE`.

La documentación debe registrar la decisión, el contrato afectado, los riesgos,
la validación ejecutada y cualquier limitación pendiente. Los archivos generados
(por ejemplo `docs/schema.html`) no reemplazan la documentación fuente.
