import { Tab, Tabs } from '@mui/material'

type Pestana = { etiqueta: string; to: string }

// Pestañas de pantalla del prototipo (`.tabs`/`.tab`): enlaces entre rutas
// hermanas ya existentes, como los `<a href>` del diseño. No agregan secciones.
export function PestanasPagina({ pestanas, etiqueta }: { pestanas: Pestana[]; etiqueta?: string }) {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  // Gana la coincidencia MÁS específica: la primera pestaña suele ser la ruta base (p. ej. `/rentabilidad`), que es prefijo de
  // todas las demás; con `findIndex` quedaba siempre marcada como activa.
  const activa = pestanas.reduce((mejor, pestana, indice) => {
    const coincide = pathname === pestana.to || pathname.startsWith(`${pestana.to}/`)
    if (!coincide) return mejor
    return mejor === -1 || pestana.to.length > pestanas[mejor].to.length ? indice : mejor
  }, -1)

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
