# Fix MSF-687 — higiene de CI

**Cambios**
- `validate.yml` (job `changes`): `web` y `code` ignoran `mkdocs.yml`, `*.md` de la raíz y `.specify/**`, además de `docs/`. Un PR de solo documentación no corre la suite web ni el e2e.
- `scripts/calidad.mjs`: `knip@6.44.1`, `jscpd@5.4.2`, `dependency-cruiser@18.7.2` (vía `--package`, `depcruise` no es el nombre del paquete) y `@commitlint/cli@21.2.4`.
- `nightly.yml`: `@lhci/cli@0.16.0` y `@axe-core/cli@4.14.0`; se quitan `continue-on-error` y `|| true`; axe guarda en `reports/axe/axe.json`; el preview usa el `vite` del workspace y se mata al salir. `.lighthouserc.json`: aserciones `warn` → `error`, para que el nightly pueda fallar.

**Fuera de alcance (a pedido del orquestador)**: `scripts/migrar-supabase-cloud.mjs` (URL con contraseña en `argv`). Toca credenciales; va en rama aparte con aviso previo.

**Reversión**: `git revert` del commit.
