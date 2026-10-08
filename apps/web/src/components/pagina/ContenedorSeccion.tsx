import { Card, CardContent } from '@mui/material'
import type { ReactNode } from 'react'

// Contorno visual contenido (spec 018-kit-panel-operable): envuelve el
// contenido principal de una pantalla (tabla + sus estados de carga, vacío
// y error, o un historial debajo) en un único borde — sin esto el contenido
// de las pantallas con EncabezadoPagina queda flotando directo sobre el
// fondo de la app. No reemplaza EncabezadoPagina (que queda fuera, arriba)
// ni cambia datos/permisos — solo agrega el contorno.
export function ContenedorSeccion({ children }: { children: ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent>{children}</CardContent>
    </Card>
  )
}
