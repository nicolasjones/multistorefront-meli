import { Tab, Tabs } from '@mui/material'
import { Link, useLocation } from 'react-router'

type Pestana = { etiqueta: string; to: string }

// Pestañas de pantalla del prototipo (`.tabs`/`.tab`): navegan entre rutas
// hermanas ya existentes. No agregan secciones, sólo su acceso como el diseño.
export function PestanasPagina({ pestanas, etiqueta }: { pestanas: Pestana[]; etiqueta?: string }) {
  const { pathname } = useLocation()
  const activa = pestanas.findIndex((pestana) => pathname === pestana.to || pathname.startsWith(`${pestana.to}/`))

  return (
    <Tabs
      value={activa === -1 ? false : activa}
      aria-label={etiqueta}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
    >
      {pestanas.map((pestana) => (
        <Tab key={pestana.to} component={Link} to={pestana.to} label={pestana.etiqueta} />
      ))}
    </Tabs>
  )
}
