# Fix: msf-683

- **Fecha**: 2026-11-06
- **Causa**: `pnpm calidad` moría a mitad de camino en CI (tras «oxlint (SAST): ok», sin `RESUMEN`) sin dejar diagnóstico: el script no atrapaba errores de las herramientas ni guardaba su salida completa. Además `quality.yml` decía «REQUERIDO» y las docs «no bloqueante (`continue-on-error`)`, pero el ruleset 25358575 exige solo `validacion` y el workflow no usa `continue-on-error`.

## Cambios
- `scripts/calidad.mjs`: cada check va dentro de `check()` (try/catch → `hallazgos` con la causa); timeout de 10 min y `maxBuffer` de 256 MB por herramienta; el hijo corre sin `GITHUB_ACTIONS` ni color (oxlint con `--format=default`, sin anotaciones `::warning`); handlers de `uncaughtException`/`unhandledRejection`/EPIPE; salida completa en `reports/calidad.log` y colas de los checks fallidos en `reports/calidad.md`.
- `.github/workflows/quality.yml`: el artefacto `calidad-reporte` sube también `calidad.log`; comentarios alineados con la realidad.
- `docs/calidad.md`, `docs/pruebas.md`: decisión documentada — `quality` falla ante hallazgos pero NO bloquea el merge; para bloquear hay que agregarlo al ruleset (acción de administración, fuera del repo).

## Desvío respecto de la evaluación
No se pudo reproducir el crash localmente (el entorno no tiene el runner de CI); la causa exacta del corte queda sin confirmar, pero el script ya no puede morir sin diagnóstico. Si reaparece, `calidad.log` y el stderr del hijo lo mostrarán. No se tocó el ruleset.

## Reversión
Revertir el commit; sin migraciones ni cambios de datos.
