# Fix MSF-801: paso «avisar el link del visor en el PR» falla con `gh: command not found`

- Causa: el runner self-hosted no tiene `gh`; el paso (solo en `main`, commit 45f8da27) sale con 127 y tumba `application`.
- Cambios: `continue-on-error: true` en `.github/workflows/validate.yml`; instalación de `gh` (apt oficial) en `infra/runner/Dockerfile`; nota en `docs/adoptar-runners-locales.md`.
- Base: rama rebasada sobre `origin/main` (el paso no existe en `dokploy`); PR contra `main`.
