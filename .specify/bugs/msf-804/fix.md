# Fix: msf-804

- **Causa**: el merge `Merge base de la épica en feat/story-MSF-423` (PR #711) no matchea el `ignores` de commitlint (solo `Merge (pull request|branch|remote-tracking|tag)`), dispara `type-empty`/`subject-empty`/`type-enum` y deja `quality` en rojo. Se repite en toda historia que sincroniza con su épica.
- **Cambios**: `commitlint.config.cjs` suma `/^Merge base de la épica en /` a `ignores`; `docs/calidad.md` lo documenta.
- **Sin tocar**: `rules` ni los otros `ignores`.
