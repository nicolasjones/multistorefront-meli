import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaTienda } from '../PaginaTienda'

// Home de la tienda (`/`): las secciones de `secciones/*.tsx` (identidad, contenido y destacados).
export default function RutaInicio() {
  const { tienda, host } = useContextoTienda()
  return <PaginaTienda tienda={tienda} host={host} />
}
