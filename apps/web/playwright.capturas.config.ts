import { defineConfig, devices } from '@playwright/test'

// Capturas para la documentación de usuario (`pnpm docs:capturas`). Config aparte de
// `playwright.config.ts` a propósito: estos specs escriben PNG en `docs/img/` y no deben correr
// con `pnpm test:e2e` ni en el CI público. Necesitan el stack local de Supabase y la web servida
// (`E2E_BASE_URL`) o el build para `vite preview`; ver docs/capturas-documentacion.md.
const webPort = Number(process.env.WEB_PORT) || 4300
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e/capturas',
  testMatch: '**/*.capturas.ts',
  // Un solo worker: comparten el mismo Supabase local y los PNG deben salir siempre iguales.
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node e2e/verificar-dist.mjs && pnpm preview', url: baseURL, reuseExistingServer: true, timeout: 60_000 },
})
