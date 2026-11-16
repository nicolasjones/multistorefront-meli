# Verificación MSF-687

- Filtro `web` simulado con la misma expresión del workflow: `docs/a.md mkdocs.yml CLAUDE.md .specify/bugs/x/fix.md` → web vacío (false); `docs/a.md apps/web/src/x.ts` → web true. Filtro `code` con `mkdocs.yml .specify/x.json docs/a.md` → vacío.
- YAML de `validate.yml` y `nightly.yml` parsea; `node --check scripts/calidad.mjs` OK.
- Nightly: no se corrió localmente (necesita runner y build); queda a la primera ejecución `workflow_dispatch`. Puede salir rojo el primer día si hoy hay violaciones: es el efecto buscado.
