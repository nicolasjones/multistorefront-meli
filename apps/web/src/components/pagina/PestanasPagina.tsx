import { Tab, Tabs } from '@mui/material'
import { Link as RouterLink, useInRouterContext, useLocation } from 'react-router'

type Pestana = { etiqueta: string; to: string }
type Props = { pestanas: Pestana[]; etiqueta?: string }

// Pestaña activa: gana la coincidencia MÁS específica. La primera pestaña suele ser la ruta base (p. ej. `/rentabilidad`),
// que es prefijo de todas las demás; con la primera coincidencia quedaba siempre marcada como activa.
function indiceActivo(pathname: string, pestanas: Pestana[]): number {
  return pestanas.reduce((mejor, pestana, indice) => {
    const coincide = pathname === pestana.to || pathname.startsWith(`${pestana.to}/`)
    if (!coincide) return mejor
    return mejor === -1 || pestana.to.length > pestanas[mejor].to.length ? indice : mejor
  }, -1)
}

function Vista({ pestanas, etiqueta, pathname, enRouter }: Props & { pathname: string; enRouter: boolean }) {
  const activa = indiceActivo(pathname, pestanas)
  return (
    <Tabs
      value={activa === -1 ? false : activa}
      aria-label={etiqueta}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
    >
      {pestanas.map((pestana) =>
        enRouter ? (
          // Navegación interna: no recarga la aplicación, solo cambia el contenido de la pantalla.
          <Tab key={pestana.to} component={RouterLink} to={pestana.to} label={pestana.etiqueta} />
        ) : (
          <Tab key={pestana.to} component="a" href={pestana.to} label={pestana.etiqueta} />
        ),
      )}
    </Tabs>
  )
}

function PestanasConRouter(props: Props) {
  const { pathname } = useLocation()
  return <Vista {...props} pathname={pathname} enRouter />
}

// Pestañas de pantalla del prototipo (`.tabs`/`.tab`): enlaces entre rutas hermanas ya existentes, como los `<a href>` del
// diseño. No agregan secciones. Dentro del router de la app se navega sin recargar la página (se conservan el menú, la barra
// superior y el estado de la aplicación); fuera de un router (p. ej. en pruebas aisladas) son enlaces comunes.
export function PestanasPagina(props: Props) {
  const enRouter = useInRouterContext()
  if (enRouter) return <PestanasConRouter {...props} />
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  return <Vista {...props} pathname={pathname} enRouter={false} />
}
