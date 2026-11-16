import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import { Box, Button, Link, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta, useNavigate } from 'react-router'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useListaPedido } from '../../../hooks/useListaPedido'
import { LISTA_DE_PEDIDO_DISPONIBLE } from '../../../lib/tiendaCapacidades'
import { MAX_LINEAS_LISTA, MAX_UNIDADES_LINEA } from '../../../lib/listaPedido'
import { AvisoTienda } from '../cuenta/AvisoTienda'
import { crearAviso, type AvisoCuenta } from '../cuenta/aviso'
import { useCelular } from '../useAnchoCelular'

export const TEXTO_TOPE_UNIDADES = `Llegaste al máximo de ${MAX_UNIDADES_LINEA.toLocaleString('es-AR')} unidades de este producto`
export const TEXTO_TOPE_LINEAS = `Tu lista ya tiene ${MAX_LINEAS_LISTA} productos. Enviala o quitá alguno para sumar otro`
export const TEXTO_SIN_STOCK = 'Sin stock hoy: lo confirmamos al responder'

// ¿La lista de pedido está encendida para esta tienda? Solo con la función encendida (`publico.capacidades_tienda_por_dominio`); mientras se resuelve no se dibuja
// nada ni ocupa lugar. Sin host (vista previa del panel) no hay lista.
function useListaEncendida(host: string): boolean {
  const capacidades = useCapacidadesTienda(host, host !== '')
  return LISTA_DE_PEDIDO_DISPONIBLE && capacidades.fase === 'lista' && capacidades.pedidos
}

// «Agregar a la lista» de la ficha (MSF-176, B1, FR-020/FR-024, P-2). Cada clic suma 1 unidad (el mismo producto suma cantidad, tope 9.999); el resultado se
// anuncia en un `Snackbar` con «Ver lista». El botón no se deshabilita en los topes: el aviso explica el motivo. El producto sin stock también se puede agregar.
export function BotonAgregarALista({ host, productoId, nombre }: { host: string; productoId: string; nombre: string }) {
  const encendida = useListaEncendida(host)
  const lista = useListaPedido(host)
  const navigate = useNavigate()
  const anchoCompleto = useCelular()
  const [aviso, setAviso] = useState<AvisoCuenta | null>(null)

  if (!encendida) return null

  const agregar = () => {
    const resultado = lista.agregar(productoId)
    if (resultado.estado === 'ok') {
      setAviso(crearAviso(`Agregamos «${nombre}» a tu lista`, false, { etiqueta: 'Ver lista', alElegir: () => navigate('/lista') }))
    } else if (resultado.estado === 'tope_unidades') {
      setAviso(crearAviso(TEXTO_TOPE_UNIDADES, true))
    } else {
      setAviso(crearAviso(TEXTO_TOPE_LINEAS, true))
    }
  }

  return (
    <>
      <Button
        variant="outlined"
        onClick={agregar}
        startIcon={<ShoppingBagOutlinedIcon aria-hidden />}
        // Mismo borde de 2 px y `primary.main` que «Ver más productos» (el botón relleno es uno solo: WhatsApp).
        sx={{ fontSize: 16, px: '24px', py: '12px', border: '2px solid', borderColor: 'primary.main', width: anchoCompleto ? '100%' : 'auto', '&:hover': { border: '2px solid', borderColor: 'primary.main' } /* estilos-sueltos: ok */ }}
      >
        Agregar a la lista
      </Button>
      <AvisoTienda aviso={aviso} alCerrar={() => setAviso(null)} />
    </>
  )
}

// Línea secundaria bajo los botones de la ficha: «Sin stock hoy…» (FR-024) y «Ya tenés {n} en tu lista · Ver lista» (n = unidades de ESTE producto, solo si n ≥ 1).
export function LineaListaFicha({ host, productoId, disponible }: { host: string; productoId: string; disponible: boolean }) {
  const encendida = useListaEncendida(host)
  const lista = useListaPedido(host)
  if (!encendida) return null
  const enLista = lista.cantidadDe(productoId)
  if (disponible && enLista < 1) return null
  return (
    <Box data-testid="linea-lista-ficha" sx={{ mt: '8px' /* estilos-sueltos: ok */ }}>
      {!disponible ? <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{TEXTO_SIN_STOCK}</Typography> : null}
      {enLista >= 1 ? (
        <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>
          Ya tenés {enLista.toLocaleString('es-AR')} en tu lista · <Link component={EnlaceRuta} to="/lista" color="inherit" sx={{ fontWeight: 600 }}>Ver lista</Link>
        </Typography>
      ) : null}
    </Box>
  )
}
