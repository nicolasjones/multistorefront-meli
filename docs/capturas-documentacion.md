---
owner: plataforma
sources:
  - apps/web/playwright.capturas.config.ts
  - apps/web/e2e/capturas/lib.ts
  - apps/web/package.json
---

# Capturas del manual de usuario

Las imágenes de `docs/producto/img/<página>/` se generan con specs de Playwright, no a mano.

## Comando

```bash
pnpm docs:capturas              # todos los specs de apps/web/e2e/capturas
pnpm docs:capturas 20-ventas    # solo uno
```

La raíz delega en `pnpm --filter @platform/web docs:capturas`, que corre
`playwright test -c playwright.capturas.config.ts` (`package.json` raíz y `apps/web/package.json`). La config es aparte de
`playwright.config.ts` a propósito: estos specs escriben PNG y no corren con `pnpm test:e2e` ni en el CI público.

## Requisitos

- Stack local de Supabase con el dataset demo: `pnpm demo:dataset -- --reset` (ver [Dataset demo](dataset-demo.md)).
- La web servida (`E2E_BASE_URL`) o el build para `vite preview`.
- Variables `SUPABASE_URL` y `SUPABASE_ANON_KEY`; opcionales `CAPTURAS_DESTINO` (por defecto `docs/producto/img`) y
  `DEMO_SUFIJO` (`apps/web/e2e/capturas/lib.ts`).
- Las capturas son de solo lectura: abren y completan formularios y diálogos, pero nunca los confirman.

## Regla de proceso (MSF-644)

Todo PR que cambia una pantalla rehace las capturas del manual que esa pantalla ilustra, o declara en su descripción por
qué no corresponde. La regla y el estado (MSF-877) están en
[Documentación y control de cambios](documentacion-cambios.md#capturas-del-manual-regla-de-proceso-y-estado-msf-644-msf-877).
