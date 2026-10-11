import type { Connect, Plugin } from 'vite'

// Señal de vida de apps/web (spec 20261011-163223-endpoint-health-e2e). El
// cuerpo es deliberadamente mínimo: sin timestamps, URLs ni nombres de
// servicios downstream (FR-003, FR-007).
export function healthPayload() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'dev'
  return { status: 'ok', commit }
}

// vite dev/preview no leen vercel.json, así que replican el rewrite en un
// middleware para que `curl /health` y la suite E2E funcionen en local.
const middleware: Connect.NextHandleFunction = (req, res, next) => {
  const path = (req.url ?? '').split('?')[0]
  if (path !== '/health' && path !== '/health.json') return next()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(healthPayload()))
}

export function healthPlugin(): Plugin {
  return {
    name: 'platform-health',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'health.json',
        source: JSON.stringify(healthPayload()),
      })
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
