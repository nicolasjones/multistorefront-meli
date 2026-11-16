import { Box, Typography } from '@mui/material'
import { useParams } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useContactoTienda } from '../../../hooks/useContactoTienda'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { DatosContacto } from '../contacto/DatosContacto'
import { FormularioContacto } from '../contacto/FormularioContacto'
import { useContextoTienda } from '../layout/LayoutTienda'
import { MigasTienda } from '../layout/MigasTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { ErrorConReintento } from '../ErrorConReintento'
import { CabeceraSeo } from '../seo/CabeceraSeo'

// `/contacto` (F-TDA-16, FR-009…FR-013): datos de contacto de ESTA tienda y el formulario «Escribinos».
// `/contacto/<algo>` no existe → la misma 404 amable. La bajada sale del texto de la tienda (F-TDA-03); sin
// texto no se muestra.
export default function RutaContacto() {
  const { host } = useContextoTienda()
  const { contactoId } = useParams()
  const contacto = useContactoTienda(host)
  const contenido = useContenidoPublico(host)

  if (contactoId) return <PaginaNoEncontrada />
  if (contacto.fase === 'cargando') return <Box sx={{ py: 2 }}><EstadoCargaPagina /></Box>
  if (contacto.fase === 'error') {
    return (
      <Box sx={{ py: 2 }}>
        <CabeceraSeo noindex pagina="No pudimos cargar los datos de contacto" />
        <ErrorConReintento titulo="No pudimos cargar los datos de contacto." alReintentar={contacto.reintentar} />
      </Box>
    )
  }
  if (contacto.fase === 'no-encontrada') return <PaginaNoEncontrada />

  const bajada = contenido?.pie.trim()
  return (
    <Box>
      <CabeceraSeo host={host} pagina="Contacto" ruta="/contacto" />
      <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: 'Contacto' }]} />
      {/* Prototipo (`MJC_Contacto`): columna de datos de 460 px, 64 px de separación y 8 px de aire arriba, 64 px abajo. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: '24px', md: '64px' }, pt: '8px', pb: { xs: '24px', md: '64px' } /* estilos-sueltos: ok */ }}>
        <Box sx={{ width: { md: 460 }, flexShrink: 0, minWidth: 0 }}>
          <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 30, md: 44 } /* estilos-sueltos: ok */ }}>Contacto</Typography>
          {bajada ? <Typography color="text.secondary" sx={{ fontSize: 17, m: '10px 0 8px', overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{bajada}</Typography> : null}
          <DatosContacto contacto={contacto.contacto} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FormularioContacto host={host} />
        </Box>
      </Box>
    </Box>
  )
}
