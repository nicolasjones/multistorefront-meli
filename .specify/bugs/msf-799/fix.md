# Fix: msf-799

- **Causa**: los PRs #696 y #715 (solo documentación) tocan `mkdocs.yml` en la raíz. El job `changes` de `validate.yml` solo apaga `web` si TODOS los archivos caen en dirs conocidos; un archivo de raíz lo prende y dispara el e2e `acceso-publico.e2e.ts` (y `code`). No es una regresión del acceso/login.
- **Cambios**: `.github/workflows/validate.yml` excluye `mkdocs.yml` de `code` y `web`; `docs/deployment.md` lo documenta.
- **Sin tocar**: flujo de acceso ni timeouts del e2e (decisión del orquestador).
- **Seguimiento**: MSF-687 cubre la clasificación general de PRs de solo docs.
