# Bug Test: MSF-672

- **Slug**: msf-672
- **Result**: pass

`node --test scripts/verificar-migraciones.test.mjs` → 7/7 pasan: aviso (no error) fuera de PR; error con `--estricto`,
con `GITHUB_BASE_REF=dokploy` y con base de épica; versión mayor limpia; duplicada y modificada siguen en error.
`node scripts/verificar-migraciones.mjs` sobre el repo real: OK.
