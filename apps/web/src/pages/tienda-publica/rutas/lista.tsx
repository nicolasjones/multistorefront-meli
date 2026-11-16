import { PantallaLista } from '../lista/PantallaLista'
import { useContextoTienda } from '../layout/LayoutTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { useParams } from 'react-router'

// `/lista` (MSF-176, B1, P-4): la lista de pedido. `/lista/<algo>` no existe. La pantalla lee la función encendida (`publico.capacidades_tienda_por_dominio`) y,
// apagada, es la 404 de la tienda.
export default function RutaLista() {
  const { host } = useContextoTienda()
  const parametros = useParams()
  if (Object.values(parametros).some((valor) => valor)) return <PaginaNoEncontrada />
  return <PantallaLista host={host} />
}
