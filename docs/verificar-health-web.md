# Verificar `/health` de apps/web

`apps/web` expone `GET /health`: una señal de vida pública, sin sesión y
sin depender de React, Supabase, Kestra ni Superset (spec
`20261011-163223-endpoint-health-e2e`, US1).

## Respuesta

```json
{"status":"ok","commit":"<sha>"}
```

`commit` sale de `VERCEL_GIT_COMMIT_SHA`, luego `GITHUB_SHA`, y `dev` si
ninguna existe. El cuerpo no incluye nada más.

## Cómo se sirve

- Build: el plugin `apps/web/vite-plugin-health.ts` emite `dist/health.json`.
- Vercel: `apps/web/vercel.json` reescribe `/health` → `/health.json` antes
  del catch-all a `index.html` y fija `Cache-Control: no-store`.
- Local: el mismo plugin responde `/health` en `vite` y `vite preview`.
  Prueba: `pnpm --filter @platform/web build && pnpm --filter @platform/web preview`
  y `curl localhost:4300/health`.

Como se resuelve antes de que cargue la SPA, el guard de Refine no lo
alcanza; no lo muevas detrás de `accessControlProvider`.

La validación E2E contra staging (US2) se documenta aquí cuando se entregue.
