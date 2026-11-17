import { Button, Tooltip } from '@mui/material'
import { useNavigate } from 'react-router'
import type { ItemsConsulta } from '../../hooks/useItemsConsulta'
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
  if (nivel !== 'edicion') return null
  const pendiente = items.fase !== 'lista'

  const crear = async () => {
    if (items.fase !== 'lista' || ocupado) return
    onOcupado(true)
    onError(null)
    try {
      const creado = await crearPresupuestoDesdePedido(consulta, items.items)
      onCreado(creado.omitidas > 0
        ? `Presupuesto ${creado.numero} creado · ${creado.omitidas} ${creado.omitidas === 1 ? 'línea' : 'líneas'} del pedido no se pasaron: revisalas`
        : `Presupuesto ${creado.numero} creado desde el pedido de ${consulta.nombre}`)
      navegar(`/ventas/comprobantes/${creado.id}`)
    } catch (error) {
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
