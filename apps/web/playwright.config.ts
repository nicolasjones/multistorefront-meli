import { defineConfig, devices } from '@playwright/test'

// Suite E2E de la app (MSF-499). Corre contra una web ya servida
// (`E2E_BASE_URL`) o, por defecto, levanta `vite preview` sobre el build.
// Los recorridos con sesión necesitan el stack local de Supabase
// (`pnpm dev:supabase`); ver docs/e2e-app.md. Los archivos usan el sufijo
// `.e2e.ts` para que Vitest (`pnpm test`) nunca los recoja.
const webPort = Number(process.env.WEB_PORT) || 4300
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // 5 s por defecto; en el CI la máquina (runners self-hosted) corre cargada y fichas/listados que consultan la base
  // tardaban más que eso en el primer render (falso rojo). Es solo el tope de espera de `expect`: no alarga lo que pasa.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // Tope por test: 30 s en local; en el CI 60 s porque la siembra por REST + dos tiendas con el runner cargado
  // puede superar los 30 s sin que haya un fallo. Los recorridos largos fijan su propio `test.setTimeout`.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // verificar-dist.mjs falla con mensaje claro si falta el build (no al importar la config: `--list` y `codegen` no lo necesitan).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node e2e/verificar-dist.mjs && pnpm preview', url: baseURL, reuseExistingServer: !process.env.CI, timeout: process.env.CI ? 120_000 : 60_000 },
})
