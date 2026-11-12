import { Box } from '@mui/material'
import { useFuenteTienda } from '../../../lib/fuenteTienda'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import { useIdentidadTienda } from '../layout/IdentidadTiendaContexto'
import type { PropsSeccionTienda } from '../PaginaTienda'

// F-TDA-02 (FR-030) / MSF-841: banner de la portada. La identidad (colores, tipografías, variables `--tienda-*`
// y tema MUI) la carga el layout para TODA la tienda (`layout/IdentidadTiendaContexto`); acá solo se muestra el banner
// con su variante móvil. El logo vive en el encabezado y el pie de la tienda; solo en la vista previa del panel
// (sin esos bloques) se sigue mostrando acá.

// Antes de las secciones de contenido y catálogo.
export const orden = 10

export default function TemaTienda({ tienda }: PropsSeccionTienda) {
  const enVistaPrevia = useFuenteTienda() !== null
  const identidad = useIdentidadTienda()
  if (!identidad) return null
  const logo = enVistaPrevia ? urlPublica(identidad.logoRuta) : null
  const banner = urlPublica(identidad.bannerRuta)
  const bannerMovil = urlPublica(identidad.bannerMovilRuta)

  return (
    <Box data-testid="tema-tienda" sx={{ mb: 2 }}>
      {logo ? <Box component="img" src={logo} alt={`Logo de ${tienda.empresaNombre}`} sx={{ display: 'block', height: (tema) => tema.spacing(6), maxWidth: '100%', objectFit: 'contain', mb: 2 }} /> : null}
      {banner ? (
        <Box component="picture" sx={{ display: 'block' }}>
          {bannerMovil ? <source media="(max-width: 600px)" srcSet={bannerMovil} /> : null}
          <Box component="img" src={banner} alt="" sx={{ display: 'block', width: '100%', height: 'auto', borderRadius: (tema) => tema.shape.borderRadius }} />
        </Box>
      ) : null}
    </Box>
  )
}
