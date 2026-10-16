import { existsSync } from 'node:fs'

// Corre antes de `pnpm preview` (Playwright levanta el webServer antes que
// globalSetup, por eso la verificación vive en el comando y no allí).
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('Falta apps/web/dist: corré `pnpm build` antes de `pnpm test:e2e` (o definí E2E_BASE_URL).')
  process.exit(1)
}
