import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import { Badge, Button, IconButton } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useListaPedido } from '../../../hooks/useListaPedido'
import { nombreAccesibleLista } from '../../../lib/listaPedido'
import { LISTA_DE_PEDIDO_DISPONIBLE } from '../../../lib/tiendaCapacidades'
import { useCelular } from '../useAnchoCelular'

// «Mi lista (n)» del encabezado (MSF-176, B1, FR-021, P-1): a la izquierda de «Ingresar»/«Mi cuenta». n = productos DISTINTOS, no unidades. Escritorio: `Button` de texto con
// el ícono de bolsa y «Mi lista (n)» (sin « (n)» con la lista vacía); celular y tableta (bajo `md`): `IconButton` con `Badge`. El mismo nombre accesible en los dos
// («Mi lista, 3 productos»). Lleva a `/lista`. Lo ve todo visitante (con o sin sesión) mientras la función esté encendida; mientras se resuelve no ocupa lugar.
export function IndicadorLista({ host }: { host: string }) {
  const capacidades = useCapacidadesTienda(host, host !== '')
  const lista = useListaPedido(host)
  const celular = useCelular()
  if (!LISTA_DE_PEDIDO_DISPONIBLE || capacidades.fase !== 'lista' || !capacidades.pedidos) return null
  const nombre = nombreAccesibleLista(lista.productos)
  if (celular) {
    return (
      <IconButton component={EnlaceRuta} to="/lista" aria-label={nombre} data-testid="indicador-lista" sx={{ width: (tema) => tema.spacing(5.5), height: (tema) => tema.spacing(5.5) }}>
        <Badge badgeContent={lista.productos} color="primary" max={99} showZero={false}>
          <ShoppingBagOutlinedIcon />
        </Badge>
      </IconButton>
    )
  }
  return (
    <Button component={EnlaceRuta} to="/lista" variant="text" aria-label={nombre} data-testid="indicador-lista" startIcon={<ShoppingBagOutlinedIcon aria-hidden />} sx={{ color: 'text.primary' }}>
      {lista.productos >= 1 ? `Mi lista (${lista.productos})` : 'Mi lista'}
    </Button>
  )
}
