import { Card, CardContent, Typography } from '@mui/material'
import type { ReactNode } from 'react'

type TarjetaBaseProps = { titulo?: string; children: ReactNode }

// Tarjeta base del sistema de diseño (DS-02): contorno y esquinas salen del
// tema, así que las pantallas no repiten bordes ni radios.
export function TarjetaBase({ titulo, children }: TarjetaBaseProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        {titulo ? <Typography component="h2" variant="h6" sx={{ mb: 1 }}>{titulo}</Typography> : null}
        {children}
      </CardContent>
    </Card>
  )
}
