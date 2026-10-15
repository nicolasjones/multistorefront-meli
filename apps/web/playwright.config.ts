import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// Suite E2E de la app (MSF-499). Corre contra una web ya servida
// (`E2E_BASE_URL`) o, por defecto, levanta `vite preview` sobre el build.
// Los recorridos con sesión necesitan el stack local de Supabase
// (`pnpm dev:supabase`); ver docs/e2e-app.md. Los archivos usan el sufijo
// `.e2e.ts` para que Vitest (`pnpm test`) nunca los recoja.
const webPort = Number(process.env.WEB_PORT) || 4300
if (!process.env.E2E_BASE_URL && !existsSync(new URL('./dist/index.html', import.meta.url))) {
  throw new Error('Falta apps/web/dist: corré `pnpm build` antes de `pnpm test:e2e` (o definí E2E_BASE_URL).')
}
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm preview', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
