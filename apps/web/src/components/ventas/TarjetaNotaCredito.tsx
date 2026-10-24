import { Alert, Card, CardHeader, Stack, Typography } from '@mui/material'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { formatearPesosPrecio } from '../../lib/precios'
import { definicionTipoNota, filasDeNota, textoStockNota, type FilaNota, type NotaCredito } from '../../lib/notaCredito'

const negativo = { color: 'error.main', fontWeight: 700, whiteSpace: 'nowrap' } as const

const columnas: ColumnaAdaptable<FilaNota>[] = [
  { clave: 'producto', encabezado: 'Producto', render: (fila) => fila.descripcion },
  { clave: 'cantidad', encabezado: 'Cantidad', alineacion: 'right', render: (fila) => <Typography component="span" variant="body2" sx={negativo}>{fila.cantidad}</Typography> },
  { clave: 'precio', encabezado: 'Precio', alineacion: 'right', render: (fila) => formatearPesosPrecio(fila.precio) },
  { clave: 'importe', encabezado: 'Importe', alineacion: 'right', render: (fila) => <Typography component="span" variant="body2" sx={negativo}>{formatearPesosPrecio(fila.importe)}</Typography> },
]

// Tarjeta de una nota de crédito en el detalle de la factura (F-VTA-11, FR-046): «Nota de crédito {número}» con la
// etiqueta «Asociada a esta factura», tipo y descripción, la tabla con cantidades e importes NEGATIVOS y el aviso
// sobre las cantidades negativas y el efecto en stock (texto del prototipo).
export function TarjetaNotaCredito({ nota }: { nota: NotaCredito }) {
  const definicion = definicionTipoNota(nota.nc_tipo)
  const titulo = `Nota de crédito ${nota.numero}`
  return (
    <Card variant="outlined" component="section" aria-labelledby={`titulo-nota-${nota.id}`}>
      <CardHeader
        title={
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography id={`titulo-nota-${nota.id}`} component="h2" variant="t3">{titulo}</Typography>
            <EtiquetaEstado texto="Asociada a esta factura" variante="error" />
          </Stack>
        }
        subheader={`${definicion.etiqueta} · ${definicion.descripcion}`}
      />
      <ContenidoAdaptable items={filasDeNota(nota)} columnas={columnas} obtenerClave={(fila) => fila.clave} etiquetaTabla={titulo} />
      <Alert severity="info" sx={{ m: 2 }}>
        Las <b>cantidades negativas</b> y los importes negativos indican que se devuelve al cliente: restan de lo facturado y de la cuenta
        corriente. {textoStockNota(nota)}
      </Alert>
    </Card>
  )
}
