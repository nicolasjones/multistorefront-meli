import type { ComponentType } from 'react'
import { Box, Typography } from '@mui/material'
import type { TiendaPublica } from '../../lib/tienda'

export type PropsSeccionTienda = { tienda: TiendaPublica; host: string }

// Contrato de cada archivo de `secciones/`: exporta por defecto el componente y, opcional, `orden`
// (menor primero). Cada historia de la épica (identidad, contenido, catálogo) aporta la suya sin
// tocar un archivo común.
export type ModuloSeccionTienda = { default: ComponentType<PropsSeccionTienda>; orden?: number }

const ORDEN_POR_DEFECTO = 100

const MODULOS_SECCIONES = import.meta.glob<ModuloSeccionTienda>('./secciones/*.tsx', { eager: true })

export type SeccionTienda = { clave: string; Componente: ComponentType<PropsSeccionTienda>; orden: number }

export function ordenarSecciones(modulos: Record<string, ModuloSeccionTienda>): SeccionTienda[] {
  return Object.entries(modulos)
    .map(([ruta, modulo]) => ({ clave: ruta, Componente: modulo.default, orden: modulo.orden ?? ORDEN_POR_DEFECTO }))
    .sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave))
}

// Front público mínimo (FR-007): nombre comercial de la empresa y las secciones registradas.
// Sin catálogo navegable, ficha ni búsqueda (MSF-167).
export function PaginaTienda({
  tienda,
  host,
  modulos = MODULOS_SECCIONES,
}: {
  tienda: TiendaPublica
  host: string
  modulos?: Record<string, ModuloSeccionTienda>
}) {
  const secciones = ordenarSecciones(modulos)
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <Box component="header" sx={{ px: 2, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography component="h1" variant="h5">{tienda.empresaNombre}</Typography>
      </Box>
      <Box component="main" sx={{ px: 2, py: 2 }}>
        {secciones.map(({ clave, Componente }) => (
          <Componente key={clave} tienda={tienda} host={host} />
        ))}
      </Box>
    </Box>
  )
}
