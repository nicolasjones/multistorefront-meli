import { Button, Tooltip } from '@mui/material'
import { useNavigate } from 'react-router'
import type { ItemsConsulta } from '../../hooks/useItemsConsulta'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import type { Consulta } from '../../lib/consultas'
import { ErrorPresupuestoDesdePedido, crearPresupuestoDesdePedido } from '../../lib/presupuestoDesdePedido'

type Props = {
  consulta: Consulta
  items: ItemsConsulta
  /** El diálogo está guardando o respondiendo: no se puede lanzar otra acción. */
  ocupado: boolean
  onOcupado: (ocupado: boolean) => void
  onError: (texto: string | null) => void
  onCreado: (mensaje: string) => void
}

// «Crear presupuesto» desde un pedido de la tienda (MSF-941, D-14). Solo con edición de Ventas (la base valida de nuevo) y con los ítems cargados. Al crear, lleva al
// presupuesto nuevo, donde el operador revisa precios y lo envía como cualquier otro. Vive aparte para que solo los pedidos necesiten el router y los permisos de Ventas.
export function BotonCrearPresupuesto({ consulta, items, ocupado, onOcupado, onError, onCreado }: Props) {
  const navegar = useNavigate()
  const { nivel } = useNivelSeccion('ventas')
  const { contexto } = useContextoPanel()
  if (nivel !== 'edicion') return null
  const pendiente = items.fase !== 'lista'

  const crear = async () => {
    if (items.fase !== 'lista' || ocupado) return
    onOcupado(true)
    onError(null)
    try {
      const creado = await crearPresupuestoDesdePedido(consulta, items.items, contexto?.organizacion_id ?? null)
      if (creado.omitidas > 0) {
        const aviso = `${creado.omitidas} ${creado.omitidas === 1 ? 'línea' : 'líneas'} del pedido no se pasaron porque el producto ya no existe: revisalas.`
        onCreado(`Presupuesto ${creado.numero} creado · ${aviso}`)
        // El aviso viaja en el estado de la ruta: el diálogo y la lista se abandonan al navegar.
        navegar(`/ventas/comprobantes/${creado.id}`, { state: { aviso } })
      } else {
        onCreado(`Presupuesto ${creado.numero} creado desde el pedido de ${consulta.nombre}`)
        navegar(`/ventas/comprobantes/${creado.id}`, { state: { mensaje: `Presupuesto ${creado.numero} creado desde el pedido de ${consulta.nombre}` } })
      }
    } catch (error) {
      if (error instanceof ErrorPresupuestoDesdePedido && error.presupuesto) {
        // Existe pero vacío: se lleva a la persona a completarlo, no a reintentar.
        navegar(`/ventas/comprobantes/${error.presupuesto.id}`, { state: { aviso: error.message } })
        return
      }
      onError(error instanceof ErrorPresupuestoDesdePedido ? error.message : 'No pudimos crear el presupuesto. Intentá de nuevo; si sigue fallando, revisá tus permisos de Ventas.')
    } finally {
      onOcupado(false)
    }
  }

  return (
    <Tooltip title={pendiente ? 'Esperá a que carguen los productos del pedido' : 'Genera un presupuesto con los productos de la lista'}>
      <span>
        <Button type="button" variant="outlined" onClick={() => void crear()} disabled={ocupado || pendiente}>Crear presupuesto</Button>
      </span>
    </Tooltip>
  )
}
