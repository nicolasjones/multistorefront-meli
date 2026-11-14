# Implementation Plan: Deuda técnica · Lote 2: higiene de código y documentación (MSF-515)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine` (solo comentarios/nombres de test) y código sin uso en `packages/ia-navegacion` y `supabase/functions/chat-ia-responder`. Sin migraciones.

## Enfoque técnico

Tres commits independientes, revertibles por separado. Esquema (Principio VII): no aplica, no hay tablas.

- **MSF-777**: script de una sola vez (no versionado) que quita `MSF-<n>[:T<m>]` del primer literal de los `describe/it/test` y limpia puntuación; edición manual de los seis comentarios «Etapa 2»; nuevo `apps/web/src/higieneReferenciasInternas.test.ts` con un analizador por archivo (`titulosConTicket`, probado con casos sintéticos) que vigila títulos y «Etapa N».
- **MSF-753**: mover el `describe` de «log sin PII» dentro del bloque con `afterEach(vi.restoreAllMocks)`.
- **MSF-745**: quitar el import `sanitizarDato`, la función `abrirInvocacion` y el tipo `InteraccionEnCurso` sin uso.
- **MSF-950**: `docs-manifest.mjs` usa `ultimoCommit(key)` (`git log -1 --no-merges`) para `sourceAt` y `commit`, y calcula `sourceHash` con el alcance de `sourceAt`; `scripts/docs-manifest.test.mjs` (repositorio temporal con HEAD distintos y un merge) y `pnpm test:docs:manifest` en la cadena `test`; se regenera `docs/manifest.json`.

## Validación

Vitest de los archivos tocados con un solo worker, suite de `@platform/ia-navegacion`, `tsc -b`, `oxlint src`, `vite build` y los guards del repo.

## Riesgos

Ninguno funcional: solo texto de títulos y código sin referencias. Un filtro de CI que seleccione tests por nombre con el código MSF dejaría de coincidir (no hay ninguno en el repo).
