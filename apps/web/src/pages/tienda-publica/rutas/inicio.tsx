import { urlPublica } from '../../../lib/tiendaIdentidad'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaTienda } from '../PaginaTienda'
import { CabeceraSeo } from '../seo/CabeceraSeo'
import { organizacionJsonLd } from '../seo/datosEstructurados'

// Home de la tienda (`/`): las secciones de `secciones/*.tsx` (identidad, contenido y destacados). F-TDA-21
// suma los metadatos y el JSON-LD `Organization` (FR-021, FR-022).
export default function RutaInicio() {
  const { tienda, host } = useContextoTienda()
  return (
    <>
      <CabeceraSeo
        host={host}
        ruta="/"
        datosEstructurados={({ seo, url }) => [organizacionJsonLd({ nombre: seo.nombre, url, logo: urlPublica(seo.logoRuta) })]}
      />
      <PaginaTienda tienda={tienda} host={host} />
    </>
  )
}
