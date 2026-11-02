import { Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { TarjetaBase } from '../../components/base/TarjetaBase'

type Props = {
  titulo: string
  cargando: boolean
  hayError: boolean
  onReintentar?: () => void
  children: ReactNode
}

// Marco común de las tarjetas de Inicio: carga, error propio («No pudimos cargar este dato», FR-008) y
// contenido. Una tarjeta que falla no tumba a las demás (SC-005).
export function TarjetaInicio({ titulo, cargando, hayError, onReintentar, children }: Props) {
  return (
    <TarjetaBase titulo={titulo}>
      {cargando ? (
        <Box role="status" aria-label="Cargando contenido" aria-busy="true"><Skeleton variant="rounded" height={48} /></Box>
      ) : hayError ? (
        <Stack spacing={1} alignItems="flex-start" role="alert">
          <Typography>No pudimos cargar este dato</Typography>
          {onReintentar ? <Button size="small" variant="outlined" onClick={onReintentar}>Reintentar</Button> : null}
        </Stack>
      ) : children}
    </TarjetaBase>
  )
}
