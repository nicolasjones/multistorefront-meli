# Verificación: MSF-499

- `pnpm build`: OK. `pnpm --filter @platform/web lint`: OK (solo warnings previos). `pnpm --filter @platform/web test` (Vitest): OK, no recoge `e2e/`.
- `pnpm test:e2e` (chromium, vite preview): 4/4 pasan.
- `pnpm docs:check`: OK.
- No verificado: recorridos con sesión y CI (sin Docker/Supabase en el entorno).
