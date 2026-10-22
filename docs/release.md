# Release automático (F4)

A partir de los **commits conventional** en `main`, **release-please** mantiene un **PR de release** que:
- sube la versión en `package.json` (SemVer),
- actualiza `CHANGELOG.md`,
- al mergearlo, crea el **tag** y el **GitHub Release**.

Config: `release-please-config.json` + `.release-please-manifest.json` · workflow `.github/workflows/release-please.yml`.

## Requisito
Los commits deben ser **conventional** (`feat:`, `fix:`, `perf:`, …) — lo valida **commitlint** en el job
`quality` (ver `docs/calidad.md`). Sin eso, no hay changelog ni versión automática.

## Qué queda afuera (a definir)
- **Preview envs por PR** (Dokploy).
- **Feature flags** (Unleash) para desacoplar deploy de release.
