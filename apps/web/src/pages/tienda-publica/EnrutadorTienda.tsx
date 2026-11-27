import { useMemo } from 'react'
import { createBrowserRouter, RouterProvider, useRouteError, type RouteObject } from 'react-router'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import type { TiendaPublica } from '../../lib/tienda'
import { LayoutTienda } from './layout/LayoutTienda'
import { PaginaNoEncontrada } from './PaginaNoEncontrada'
import { PantallaError } from './PantallaError'

type ModuloRuta = { default: React.ComponentType }
type CargadorRuta = () => Promise<ModuloRuta>

// Rutas registradas por archivo (F-TDA-11, FR-003): `rutas/*.tsx`, cargadas de forma diferida.
const CARGADORES_RUTAS = import.meta.glob<ModuloRuta>(['./rutas/*.tsx', '!./rutas/*.test.tsx']) as Record<string, CargadorRuta>

// Ruta del archivo → paths (ver rutas/LEEME.md): `inicio` es la home; el resto responde en
// `/<nombre>` y `/<nombre>/:<nombre>Id`. Un nombre con puntos (`newsletter.confirmar.tsx`) es una ruta de varios tramos con un
// único parámetro final: `/newsletter/confirmar/:token`.
export function rutaDeArchivo(archivo: string): string[] {
  const nombre = archivo.replace(/^.*\//, '').replace(/\.tsx$/, '')
  if (nombre.includes('.')) return [`/${nombre.split('.').join('/')}/:token`]
  return nombre === 'inicio' ? ['/'] : [`/${nombre}`, `/${nombre}/:${nombre}Id`]
}

// ¿Este camino responde a este patrón de ruta? `:param` acepta un tramo no vacío (misma regla que las rutas de arriba).
export function coincideRuta(patron: string, camino: string): boolean {
  const a = patron.split('/').filter(Boolean)
  const b = camino.split('/').filter(Boolean)
  return a.length === b.length && a.every((tramo, i) => (tramo.startsWith(':') ? b[i].length > 0 : tramo === b[i]))
}

// MSF-1002: el chunk de la ruta (catálogo, ficha...) recién se pedía cuando terminaba de resolverse la tienda y se montaba el
// layout: una cascada de red (JS de entrada → tienda → chunk de la ruta → datos). Se lo pide desde el arranque, EN PARALELO con la
// resolución de la tienda; `import()` cachea el módulo, así que después `lazy` lo encuentra ya descargado. Mejor esfuerzo: un
// fallo se ignora (la ruta lo reintenta al navegar y muestra su pantalla de error).
export function precargarRutaActual(camino: string, cargadores: Record<string, CargadorRuta> = CARGADORES_RUTAS): void {
  const ruta = Object.entries(cargadores)
    .sort(([a], [b]) => a.localeCompare(b))
    .find(([archivo]) => rutaDeArchivo(archivo).some((patron) => coincideRuta(patron, camino)))
  if (ruta) void ruta[1]().catch(() => undefined)
}

function ErrorDeRuta() {
  const error = useRouteError()
  console.error('No se pudo cargar la página de la tienda', error instanceof Error ? error.message : error)
  return (
    <PantallaError dentroDeTienda alReintentar={() => window.location.reload()} />
  )
}

export function crearRutasTienda(
  tienda: TiendaPublica,
  host: string,
  cargadores: Record<string, CargadorRuta> = CARGADORES_RUTAS,
): RouteObject[] {
  const hijas: RouteObject[] = Object.entries(cargadores)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([archivo, cargar]) =>
      rutaDeArchivo(archivo).map((path): RouteObject => ({
        path,
        lazy: async () => ({ Component: (await cargar()).default }),
        ErrorBoundary: ErrorDeRuta,
      })),
    )
  return [
    {
      path: '/',
      element: <LayoutTienda tienda={tienda} host={host} />,
      HydrateFallback: () => <EstadoCargaPagina />,
      ErrorBoundary: ErrorDeRuta,
      children: [...hijas, { path: '*', element: <PaginaNoEncontrada /> }],
    },
  ]
}

type CrearRouter = (rutas: RouteObject[]) => ReturnType<typeof createBrowserRouter>

// Front público con enrutador (F-TDA-11, FR-003). `crearRouter` permite probarlo con un router en memoria.
export function EnrutadorTienda({
  tienda,
  host,
  cargadores,
  crearRouter = createBrowserRouter,
}: {
  tienda: TiendaPublica
  host: string
  cargadores?: Record<string, CargadorRuta>
  crearRouter?: CrearRouter
}) {
  const router = useMemo(
    () => crearRouter(crearRutasTienda(tienda, host, cargadores)),
    [tienda, host, cargadores, crearRouter],
  )
  return <RouterProvider router={router} />
}
