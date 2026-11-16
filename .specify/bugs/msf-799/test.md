# Test: msf-799

- Clasificación reproducida con la misma tubería de `grep` del job `changes`:
  - `mkdocs.yml` + `docs/a.md` → `web` vacío (false).
  - `mkdocs.yml` + `apps/web/src/a.ts` → `web` = `apps/web/src/a.ts` (true).
- El e2e en sí no se corrió localmente: el rojo se evita al no dispararse en PRs de solo docs; lo valida el CI de este PR.
