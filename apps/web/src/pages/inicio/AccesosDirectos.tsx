import { Link as RouterLink } from 'react-router'
import { Button, Stack } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { puedeEditar } from '../../lib/inicio'

// Accesos directos (FR-002): cada uno exige edición en SU sección (ventas, stock, productos); con solo
// lectura el acceso no existe. La base valida igual al escribir. «Registrar movimiento» lleva a Stock,
// donde está «Nuevo movimiento».
const ACCESOS = [
  { seccion: 'ventas', etiqueta: 'Nuevo comprobante', ruta: '/ventas/comprobantes/nuevo' },
  { seccion: 'stock', etiqueta: 'Registrar movimiento', ruta: '/stock' },
  { seccion: 'productos', etiqueta: 'Nuevo producto', ruta: '/productos/create' },
] as const

function Acceso({ seccion, etiqueta, ruta }: (typeof ACCESOS)[number]) {
  const { nivel } = useNivelSeccion(seccion)
  if (!puedeEditar(nivel)) return null
  return <Button component={RouterLink} to={ruta} variant="outlined">{etiqueta}</Button>
}

export function AccesosDirectos() {
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="group" aria-label="Accesos directos">
      {ACCESOS.map((acceso) => <Acceso key={acceso.seccion} {...acceso} />)}
    </Stack>
  )
}
