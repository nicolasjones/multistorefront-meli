import react from '@vitejs/plugin-react'
// `vitest/config` re-exports Vite's defineConfig with the `test` key typed,
// so build and tests share this one file instead of two configs to keep in sync.
import { defineConfig } from 'vitest/config'
import { healthPlugin } from './vite-plugin-health.ts'

// Puerto configurable (spec 015, contracts/variables-puerto.md) — este
// archivo corre en Node al arrancar, no en el bundle del navegador, así que
// process.env está disponible directo (sin el prefijo VITE_, que es solo
// para variables expuestas al código de cliente). Fallback al puerto actual
// para que un checkout sin WEB_PORT definido arranque igual que hoy (FR-009).
const webPort = Number(process.env.WEB_PORT) || 4300

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), healthPlugin()],
  server: {
    host: '0.0.0.0',
    port: webPort,
  },
  preview: {
    host: '0.0.0.0',
    port: webPort,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Limita la presión de procesos en Windows y evita crear un proceso fork
    // por archivo. Se conserva el aislamiento para que mocks y DOM no se
    // filtren entre pruebas.
    pool: 'threads',
    maxWorkers: 1,
    // Sin "inline", vitest externaliza estos paquetes (los carga con el
    // resolutor ESM nativo de Node en vez de con el de Vite): @mui/material
    // reexporta subpaths sin extensión que Node no soporta como import de
    // directorio, y react-router terminaba cargado dos veces (una copia
    // externa, otra vía Vite en App.tsx) con contextos de React distintos
    // ("useLocation() may be used only in the context of a <Router>").
    // Ver App.test.tsx.
    server: {
      deps: {
        inline: [/@refinedev\//, /@mui\//, /react-router/],
      },
    },
  },
})
