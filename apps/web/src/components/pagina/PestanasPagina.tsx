import { Tab, Tabs } from '@mui/material'

type Pestana = { etiqueta: string; to: string }

// Pestañas de pantalla del prototipo (`.tabs`/`.tab`): enlaces entre rutas
// hermanas ya existentes, como los `<a href>` del diseño. No agregan secciones.
export function PestanasPagina({ pestanas, etiqueta }: { pestanas: Pestana[]; etiqueta?: string }) {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
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
        <Tab key={pestana.to} component="a" href={pestana.to} label={pestana.etiqueta} />
      ))}
    </Tabs>
  )
}
