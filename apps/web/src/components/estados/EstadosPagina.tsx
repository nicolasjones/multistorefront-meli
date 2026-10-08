import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export function EstadoCargaPagina({ lineas = 3 }: { lineas?: number }) {
  return (
    <Stack aria-busy="true" aria-label="Cargando contenido" spacing={1.5} role="status">
      {Array.from({ length: lineas }, (_, indice) => <Skeleton key={indice} height={40} variant="rounded" />)}
    </Stack>
  )
}

type EstadoInformativoProps = { titulo: string; descripcion?: string; accion?: ReactNode }

export function EstadoVacio({ titulo, descripcion, accion }: EstadoInformativoProps) {
  return <EstadoInformativo severidad="info" titulo={titulo} descripcion={descripcion} accion={accion} />
}

export function EstadoExito({ titulo, descripcion, accion }: EstadoInformativoProps) {
  return <EstadoInformativo severidad="success" titulo={titulo} descripcion={descripcion} accion={accion} />
}

type EstadoErrorProps = Omit<EstadoInformativoProps, 'titulo'> & { titulo?: string; reintentar?: () => void }

export function EstadoError({ titulo = 'No pudimos cargar esta información.', descripcion, reintentar }: EstadoErrorProps) {
  return <EstadoInformativo severidad="error" titulo={titulo} descripcion={descripcion} accion={reintentar ? <Button color="inherit" onClick={reintentar}>Reintentar</Button> : undefined} />
}

function EstadoInformativo({ severidad, titulo, descripcion, accion }: EstadoInformativoProps & { severidad: 'error' | 'info' | 'success' }) {
  return (
    <Alert severity={severidad} action={accion}>
      <Typography component="p" fontWeight={600}>{titulo}</Typography>
      {descripcion ? <Box component="span">{descripcion}</Box> : null}
    </Alert>
  )
}
