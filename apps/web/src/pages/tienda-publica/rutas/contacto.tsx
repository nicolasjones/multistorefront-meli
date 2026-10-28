import { Box, Breadcrumbs, Typography } from '@mui/material'
import { Link as EnlaceRuta, useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useContactoTienda } from '../../../hooks/useContactoTienda'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { DatosContacto } from '../contacto/DatosContacto'
import { FormularioContacto } from '../contacto/FormularioContacto'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ErrorConReintento } from '../ErrorConReintento'

// `/contacto` (F-TDA-16, FR-009…FR-013): datos de contacto de ESTA tienda y el formulario «Escribinos».
// `/contacto/<algo>` no existe → la misma 404 amable. La bajada sale del texto de la tienda (F-TDA-03); sin
// texto no se muestra.
export default function RutaContacto() {
  const { host } = useContextoTienda()
  const { contactoId } = useParams()
  const contacto = useContactoTienda(host)
  const contenido = useContenidoPublico(host)

  if (contactoId) return <PaginaNoEncontrada />
  if (contacto.fase === 'cargando') return <EstadoCargaPagina />
  if (contacto.fase === 'error') return <ErrorConReintento titulo="No pudimos cargar los datos de contacto." alReintentar={contacto.reintentar} />
  if (contacto.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const bajada = contenido?.pie.trim()
  return (
    <Box>
      <Breadcrumbs aria-label="Migas de pan" sx={{ mb: 2 }}>
        <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit' }}>Inicio</Box>
        <Typography color="text.primary" aria-current="page">Contacto</Typography>
      </Breadcrumbs>
      <Typography component="h1" variant="h4" sx={{ typography: { xs: 'h5', md: 'h4' } }}>Contacto</Typography>
      {bajada ? <Typography color="text.secondary" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{bajada}</Typography> : null}
      <Box sx={{ display: 'grid', gap: { xs: 3, md: 6 }, mt: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        <DatosContacto contacto={contacto.contacto} />
        <FormularioContacto host={host} />
      </Box>
    </Box>
  )
}
