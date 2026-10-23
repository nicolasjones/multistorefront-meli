import { useMemo } from 'react'
import { createBrowserRouter, RouterProvider, useRouteError, type RouteObject } from 'react-router'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import type { TiendaPublica } from '../../lib/tienda'
import { LayoutTienda } from './layout/LayoutTienda'
import { PaginaNoEncontrada } from './PaginaNoEncontrada'

type ModuloRuta = { default: React.ComponentType }
type CargadorRuta = () => Promise<ModuloRuta>

// Rutas registradas por archivo (F-TDA-11, FR-003): `rutas/*.tsx`, cargadas de forma diferida.
const CARGADORES_RUTAS = import.meta.glob<ModuloRuta>('./rutas/*.tsx') as Record<string, CargadorRuta>

// Ruta del archivo → paths (ver rutas/LEEME.md): `inicio` es la home; el resto responde en
// `/<nombre>` y `/<nombre>/:<nombre>Id`.
export function rutaDeArchivo(archivo: string): string[] {
  const nombre = archivo.replace(/^.*\//, '').replace(/\.tsx$/, '')
  return nombre === 'inicio' ? ['/'] : [`/${nombre}`, `/${nombre}/:${nombre}Id`]
}

function ErrorDeRuta() {
  const error = useRouteError()
  console.error('No se pudo cargar la página de la tienda', error instanceof Error ? error.message : error)
  return (
    <EstadoError
      titulo="No pudimos cargar la página."
      descripcion="Revisá tu conexión e intentá de nuevo."
      reintentar={() => window.location.reload()}
    />
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
