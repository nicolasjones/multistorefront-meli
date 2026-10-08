# Bug Assessment: El seguimiento depende de una etiqueta inexistente

- **Slug**: seguimiento-sin-etiqueta
- **Created**: 2026-09-25
- **Source**: incidente reproducido en la ejecución 36091336725 de `sync-template.yml`
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

La primera ejecución en un producto sin `TEMPLATE_READ_TOKEN` no logra abrir la issue que explica cómo configurarlo. El workflow intenta crear una etiqueta, pero falla silenciosamente y luego `gh issue create --label template-sync` aborta porque la etiqueta no existe.

## Symptom

Cuando falta el secreto de lectura, se espera crear o actualizar una issue con instrucciones y fallar explícitamente el job. En cambio, no se crea la issue y el job termina por el error de etiqueta inexistente. La misma dependencia afecta seguimiento de adopción y cierre de issues.

## Reproduction

1. Ejecutar `sync-template.yml` en un producto sin `TEMPLATE_READ_TOKEN` ni etiqueta `template-sync`.
2. El paso `Comprobar secreto de lectura` intenta crear la etiqueta con `gh label create ... || true`.
3. La creación de issue con `--label template-sync` falla porque la etiqueta no existe.

## Suspected Code Paths

- `.github/workflows/sync-template.yml` — los pasos de credencial, adopción y cierre filtran/crean issues usando la etiqueta opcional.

## Root Cause Hypothesis

El flujo trata como garantizada una etiqueta del repositorio que no es aprovisionada de manera fiable: su creación se ignora incluso si falla, pero los comandos posteriores la exigen. Confianza: alta; el run reproducido emitió `could not add label: 'template-sync' not found`.

## Proposed Remediation

**Preferred**: Quitar la dependencia de la etiqueta y buscar las issues abiertas por título exacto; crear, editar y cerrar las issues sin `--label`. Así el primer uso funciona con los permisos existentes (`Issues: write`) sin configuración previa.

**Files likely to change**:
- `.github/workflows/sync-template.yml`
- `template-capabilities.json` (bump semver de `template-capability-sync`)
- `template-adoption.json` (versión publicada por el template)
- `scripts/verificar-adopcion-template.test.mjs`

## Tests to add or update

- Verificar estáticamente que el workflow no exige `template-sync` para buscar o crear issues.
- Ejecutar los tests del verificador de capacidades/adopción y las comprobaciones de CI del template.
- Repetir workflow manual en un producto sin el secreto y confirmar que la issue se crea antes del error explícito por secreto faltante.

## Risks & Considerations

- Búsqueda por título requiere mantener títulos únicos; actualmente los títulos son fijos y distintos.
- El cambio del workflow publicado requiere bump de versión y adopción selectiva en los productos.

## Open Questions

- Ninguna para la corrección; la lectura real del repositorio privado requiere configurar posteriormente el secreto del producto.
