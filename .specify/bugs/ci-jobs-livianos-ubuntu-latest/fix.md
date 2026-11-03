# Fix MSF-752 — jobs livianos del CI en ubuntu-latest

- `quality` (`.github/workflows/quality.yml`) y `validacion` (`validate.yml`) pasan a `ubuntu-latest`; gitleaks se instala en `$RUNNER_TEMP/bin` y se agrega a `GITHUB_PATH`.
- Se documenta la excepción en `CLAUDE.md` y `docs/control-ci.md` (sección «Jobs en runners de GitHub»).
- Conflicto con `dokploy` en `docs/control-ci.md`: se conservaron ambas secciones (autoactualización del runner + esta).
- Origen: PR #581 (commit e51ed685), reaplicado sobre `origin/dokploy` actual.
- Revertir: volver `runs-on` a `[self-hosted, platform-local]` en ambos jobs.
