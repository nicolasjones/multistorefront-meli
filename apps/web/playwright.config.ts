import { defineConfig, devices } from '@playwright/test'

// Suite E2E de la app (MSF-499). Corre contra una web ya servida
// (`E2E_BASE_URL`) o, por defecto, levanta `vite preview` sobre el build.
// Los recorridos con sesión necesitan el stack local de Supabase
// (`pnpm dev:supabase`); ver docs/e2e-app.md. Los archivos usan el sufijo
// `.e2e.ts` para que Vitest (`pnpm test`) nunca los recoja.
const webPort = Number(process.env.WEB_PORT) || 4300
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`

// Recorrido visible (E2E_VISIBLE=1, p. ej. con E2E_VIDEO=on): viewport HD,
// cámara lenta y video a resolución completa para que se siga por pantalla.
// Va a nivel de proyecto (máxima precedencia sobre el device).
const VISIBLE = process.env.E2E_VISIBLE === '1'
if (VISIBLE) console.log('[e2e] modo visible: 1920x1080, slowMo 350ms')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // El reporte JSON lo lee `pnpm e2e:omitidos:check` (job `e2e-tienda`): cuenta los tests omitidos.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'resultado-e2e.json' }]] : 'list',
  // 5 s por defecto; en el CI la máquina (runners self-hosted) corre cargada y fichas/listados que consultan la base
  // tardaban más que eso en el primer render (falso rojo). Es solo el tope de espera de `expect`: no alarga lo que pasa.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // Tope por test: 30 s en local; en el CI 60 s porque la siembra por REST + dos tiendas con el runner cargado
  // puede superar los 30 s sin que haya un fallo. Los recorridos largos fijan su propio `test.setTimeout`.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: {
    baseURL,
    // Grabaciones para control directo: en CI se conservan las que fallan; con E2E_VIDEO=on/E2E_TRACE=on
    // se graba todo (video + traza) en test-results/.
    trace: process.env.E2E_TRACE === 'on' ? 'on' : 'retain-on-failure',
    video: process.env.E2E_VIDEO === 'on' ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(VISIBLE
        ? {
            viewport: { width: 1920, height: 1080 },
            // Chromium completo (no headless-shell): el shell capa la ventana
            // en 800x600 e ignora el viewport pedido.
            launchOptions: {
              slowMo: 350,
              channel: 'chromium',
              args: ['--window-size=1920,1080', '--force-device-scale-factor=1'],
            },
            recordVideo: { dir: 'test-results', size: { width: 1920, height: 1080 } },
          }
        : {}),
    },
  }],
  // verificar-dist.mjs falla con mensaje claro si falta el build (no al importar la config: `--list` y `codegen` no lo necesitan).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node e2e/verificar-dist.mjs && pnpm preview', url: baseURL, reuseExistingServer: !process.env.CI, timeout: process.env.CI ? 120_000 : 60_000 },
})
