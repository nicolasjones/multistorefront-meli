import { existsSync } from 'node:fs'

// Sin build no hay nada que servir con `vite preview`. Con E2E_BASE_URL (web ya
// servida) o un servidor reutilizado en local no se exige dist/.
export default function globalSetup() {
  const sirveBuild = !process.env.E2E_BASE_URL && !existsSync(new URL('../dist/index.html', import.meta.url))
  if (sirveBuild && process.env.CI) {
    throw new Error('Falta apps/web/dist: corré `pnpm build` antes de `pnpm test:e2e` (o definí E2E_BASE_URL).')
  }
  if (sirveBuild) {
    console.warn('apps/web/dist no existe: solo funciona si ya hay un servidor en WEB_PORT (pnpm build si no).')
  }
}
