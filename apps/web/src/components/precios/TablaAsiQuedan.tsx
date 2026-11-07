import { Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useImagenesProductos } from '../../hooks/useImagenesProductos'
import { type FilaPrevia, formatearPesosPrecio } from '../../lib/precios'
import { MiniaturaProducto } from '../base/MiniaturaProducto'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'

type Props = {
  nombreEmpresa: string
  // «Precios que ve el cliente»: rotula la columna y elige neto o final (F-PRE-12, FR-022).
  mostrarConIva: boolean
  filas: FilaPrevia[] | null
  cargando: boolean
  hayError: boolean
  // Texto cuando no hay filas porque el ajuste es inválido (la tabla espera la corrección).
  ajusteInvalido: boolean
  // La regla en pantalla ajusta el precio (base «Central con ajuste» y un porcentaje distinto de cero): rotula «Ajustado».
  hayAjuste?: boolean
  reintentar: () => void
}

// Texto solo para lectores de pantalla (encabezado de la columna de la marca).
const SOLO_LECTORES = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const SIN_PRECIO = 'Sin precio: falta cargar la cotización'
const SIN_IVA_DEFINIDO = 'Sin precio con IVA: el producto no tiene una alícuota ni una categoría con IVA'

// Marca por fila (F-PRE-09, FR-024): el precio propio manda sobre la regla; si no, «Ajustado» cuando la regla mueve
// el precio y «Central» cuando no. El texto lleva el significado: el tono solo lo refuerza.
type MarcaFila = 'Precio propio' | 'Ajustado' | 'Central'
const marcaDe = (fila: FilaPrevia, hayAjuste: boolean): MarcaFila => (fila.precioPropio ? 'Precio propio' : hayAjuste ? 'Ajustado' : 'Central')
const TONO_MARCA: Record<MarcaFila, { color: 'primary' | 'warning' | 'default'; variant: 'filled' | 'outlined' }> = {
  'Precio propio': { color: 'primary', variant: 'filled' },
  Ajustado: { color: 'warning', variant: 'outlined' },
  Central: { color: 'default', variant: 'outlined' },
}

function Importe({ valor, fuerte, motivo = SIN_PRECIO }: { valor: number | null; fuerte?: boolean; motivo?: string }) {
  if (valor === null) return <span aria-label={motivo} title={motivo}>—</span>
  return <Typography component="span" variant="body2" sx={{ fontWeight: fuerte ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{formatearPesosPrecio(valor)}</Typography>
}

// «Así quedan los precios» (F-PRE-07, FR-013): muestra de productos con el precio central y el
// neto de la empresa (o su final con IVA, F-PRE-12). Todo el cálculo viene del servidor (vista previa), con el ajuste sin guardar.
export function TablaAsiQuedan({ nombreEmpresa, mostrarConIva, filas, cargando, hayError, ajusteInvalido, hayAjuste = false, reintentar }: Props) {
  const imagenes = useImagenesProductos((filas ?? []).map((fila) => fila.productoId))
  let cuerpo
  if (hayError) cuerpo = <EstadoError descripcion="No pudimos calcular la vista previa de precios." reintentar={reintentar} />
  else if (ajusteInvalido) cuerpo = <EstadoVacio titulo="Corregí el ajuste" descripcion="La tabla se actualiza cuando el ajuste es válido." />
  else if (filas === null || (cargando && filas.length === 0)) cuerpo = <EstadoCargaPagina lineas={4} />
  else if (filas.length === 0) cuerpo = <EstadoVacio titulo="Todavía no hay productos" descripcion="Cuando cargues productos vas a ver acá cómo quedan sus precios." />
  else {
    cuerpo = (
      <Box sx={{ overflowX: 'auto' }} aria-busy={cargando}>
        <Table size="small" aria-label="Así quedan los precios">
          <TableHead>
            <TableRow>
              <TableCell>Producto (muestra)</TableCell>
              <TableCell align="right">Central</TableCell>
              <TableCell align="right">{nombreEmpresa} · {mostrarConIva ? 'Con IVA incluido' : 'Sin IVA'}</TableCell>
              <TableCell><Box component="span" sx={SOLO_LECTORES}>Origen del precio</Box></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map((fila) => (
              <TableRow key={fila.productoId}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <MiniaturaProducto alt="" src={imagenes.get(fila.productoId)} />
                    <span>
                      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{fila.nombre}</Typography>
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {fila.sku ? `${fila.sku} · ` : ''}{fila.moneda}
                      </Typography>
                    </span>
                  </Stack>
                </TableCell>
                <TableCell align="right"><Importe valor={fila.centralArs} /></TableCell>
                <TableCell align="right"><Importe
                    valor={mostrarConIva ? fila.finalArs : fila.netoArs}
                    fuerte
                    motivo={mostrarConIva && fila.netoArs !== null ? SIN_IVA_DEFINIDO : SIN_PRECIO}
                  /></TableCell>
                <TableCell>
                  {(() => {
                    const marca = marcaDe(fila, hayAjuste)
                    return <Chip size="small" label={marca} color={TONO_MARCA[marca].color} variant={TONO_MARCA[marca].variant} />
                  })()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    )
  }

  return (
    <Box component="section" aria-labelledby="asi-quedan-titulo" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ p: 2.5, pb: 1.5 }}>
        <Typography id="asi-quedan-titulo" component="h2" variant="h6">Así quedan los precios</Typography>
        <Typography variant="body2" color="text.secondary">Se actualiza con el ajuste</Typography>
      </Box>
      {cuerpo}
    </Box>
  )
}
