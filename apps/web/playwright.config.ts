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
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e-report.json' }]]
    : 'list',
  use: {
    baseURL,
    // Grabaciones para control directo: en CI se conservan las que fallan; con E2E_VIDEO=on/E2E_TRACE=on
    // se graba todo (video + traza) en test-results/.
    trace: process.env.E2E_TRACE === 'on' ? 'on' : 'retain-on-failure',
    video: process.env.E2E_VIDEO === 'on' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // verificar-dist.mjs falla con mensaje claro si falta el build (no al importar la config: `--list` y `codegen` no lo necesitan).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node e2e/verificar-dist.mjs && pnpm preview', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
