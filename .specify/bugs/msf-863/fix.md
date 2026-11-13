# Bug Fix: fila «Empresa activa» en la matriz de la spec 023 (CI `application` rojo)

- **Slug**: msf-863
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se completó la matriz `## Matriz pantalla↔criterios` de `specs/023-visor-componentes/spec.md` con la fila «Empresa activa», declarada como **no aplica** con su motivo: el visor de componentes es una pantalla interna de desarrollo que sólo lee el manifiesto de cobertura E2E, sin datos de empresa. Con eso el gate `pnpm matriz:check` del job `application` deja de fallar y el PR #929 puede mergearse a `dokploy`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `specs/023-visor-componentes/spec.md` | modified | Una fila nueva en `## Matriz pantalla↔criterios`: «Fila **Empresa activa**» con el motivo del «no aplica» |
| `.specify/bugs/msf-863/assessment.md` | added | Evaluación del bug (síntoma, reproducción, causa, remediación) |
| `.specify/bugs/msf-863/fix.md` | added | Este informe |
| `.specify/bugs/msf-863/test.md` | added | Verificación del arreglo |

No se tocó código, migraciones, workflows ni el resto del merge de #929.

## Diff Highlights

```diff
 | Bloque "Ítems sin E2E" | FR-002 (progreso) |
 | Vacío con instrucciones | FR-005, US3 |
+| Fila **Empresa activa** | **No aplica** (motivo): el visor es una pantalla interna de desarrollo y su única fuente de datos es el manifiesto de cobertura E2E (`cobertura-e2e.json`, del bucket o local); no lee ni escribe datos de ninguna empresa y no muestra selector, columna ni texto de empresa, así que no hay empresa activa que respetar ni consultas que recargar al cambiarla (Principio VIII) | FR-005 (fuente de datos) |
```

## Tests Added or Updated

- No se agregó ningún test: la regla ya está cubierta por `scripts/verificar-matriz-pantalla.test.mjs` («acepta «no aplica» con motivo» y «acepta la fila de empresa activa»), que no depende del contenido de la spec 023.
- La verificación de esta historia es el propio gate (`pnpm matriz:check`), que se ejecutó contra la base real del PR (`origin/dokploy`) antes y después del arreglo.

## Local Verification

- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (antes del arreglo) → exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa» … - specs/023-visor-componentes/spec.md` (mismo mensaje que el CI, run 43482415728).
- `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` (después del arreglo) → exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas)`.
- `pnpm test:matriz:pantalla` → 10/10 en verde.
- `GITHUB_BASE_REF=dokploy pnpm docs:check` → `Documentación de cambios: OK (596 archivos comparados contra origin/dokploy).` · `Migraciones OK: 644 archivo(s), 1 nuevo(s) contra origin/dokploy.`
- `pnpm prototipo:check` → `Inventario del prototipo: OK (120 pantallas al día).`
- `pnpm lint` → exit 0 (sólo warnings de oxlint preexistentes del PR #929).
- `pnpm build` → `✓ built`.

## Deviations from Assessment

Ninguna. La fila se agregó dentro de la sección `## Matriz pantalla↔criterios` y con las dos columnas de la tabla existente.

## Follow-ups

- El job `quality` (knip) del PR #929 sigue en rojo por el tooling de evidencia E2E que trae de `main` sin actualizar la configuración de knip; no bloquea el merge (no está en el `needs` de `validacion`, decisión MSF-683/PR #737) y queda fuera del alcance de esta historia.
