import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
// `vitest/config` re-exports Vite's defineConfig with the `test` key typed,
// so build and tests share this one file instead of two configs to keep in sync.
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

// Puerto configurable (spec 015, contracts/variables-puerto.md) — este
// archivo corre en Node al arrancar, no en el bundle del navegador, así que
// process.env está disponible directo (sin el prefijo VITE_, que es solo
// para variables expuestas al código de cliente). Fallback al puerto actual
// para que un checkout sin WEB_PORT definido arranque igual que hoy (FR-009).
const webPort = Number(process.env.WEB_PORT) || 4300

const raiz = fileURLToPath(new URL('.', import.meta.url))

// La API y el Storage de la tienda están en otro origen: sin conexión previa, el DNS y el TLS de
// ese origen caen dentro del camino crítico del LCP (FR-047 / SC-009). El enlace se inyecta en el
// build y no en `index.html` con `%VITE_SUPABASE_URL%` porque, sin la variable en el entorno, Vite
// deja el marcador literal en el HTML y el navegador pediría esa dirección inexistente.
export function preconnectSupabase(url: string) {
  return {
    name: 'preconnect-supabase',
    transformIndexHtml(html: string) {
      if (!url) return html
      return {
        html,
        tags: [{ tag: 'link', attrs: { rel: 'preconnect', href: url, crossorigin: '' }, injectTo: 'head-prepend' }],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, raiz, 'VITE_')
  return {
    plugins: [react(), preconnectSupabase(env.VITE_SUPABASE_URL ?? '')],
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
      // El default de vitest (5s) es corto para el runner compartido: con la suite cargada
      // un test lento falla por timeout aunque la lógica esté bien (MSF-189:
      // CuentaCobroDialog, 874/875 tests OK, 1 timeout de 5s). 15s sigue acotando un
      // cuelgue real, pero elimina el falso rojo que obligaba a re-ejecutar el shard.
      testTimeout: 15000,
      // Con 149 archivos aislados (un worker cada uno) y runners lentos, un `console.*` emitido justo cuando
      // el worker se cierra deja pendiente el RPC `onUserConsoleLog` y vitest termina con
      // `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` AUNQUE todos los tests
      // pasen (exit 1, falso rojo que obligaba a relanzar el shard). Sin interceptar la consola, el log sale
      // directo a la salida estándar y no hay RPC que cortar. Se pierde solo la atribución de cada línea al
      // test que la emitió.
      disableConsoleIntercept: true,
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
      // ("useLocation() may be used only in a <Router>").
      // Ver App.test.tsx.
      server: {
        deps: {
          inline: [/@refinedev\//, /@mui\//, /react-router/],
        },
      },
    },
  }
})
