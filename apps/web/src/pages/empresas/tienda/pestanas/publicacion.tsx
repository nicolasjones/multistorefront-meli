import { Box, Stack } from '@mui/material'
import type { ComponentType } from 'react'
import type { PropsPestanaTienda } from '../pestanas'

// F-TDA-05 (FR-001): pestaña «Dominio y publicación». Compone sus secciones desde `publicacion/*.tsx`,
// ordenadas por el `orden` que exporta cada una: F-TDA-06 y F-TDA-07 suman su archivo sin editar el de otra
// historia. Los tests (`*.test.tsx`) quedan fuera. La pestaña entera ya se carga de forma diferida.
type Seccion = { default: ComponentType<PropsPestanaTienda>; orden: number }

const MODULOS = import.meta.glob<Seccion>(['./publicacion/*.tsx', '!./publicacion/*.test.tsx'], { eager: true })

const SECCIONES = Object.entries(MODULOS)
  .sort(([rutaA, a], [rutaB, b]) => a.orden - b.orden || rutaA.localeCompare(rutaB))
  .map(([ruta, modulo]) => ({ ruta, Componente: modulo.default }))

export default function PestanaPublicacion(props: PropsPestanaTienda) {
  return (
    <Stack spacing={2}>
      {SECCIONES.map(({ ruta, Componente }) => (
        <Box key={ruta}>
          <Componente {...props} />
        </Box>
      ))}
    </Stack>
  )
}
