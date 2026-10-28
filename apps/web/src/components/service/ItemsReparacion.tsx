import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { TituloDialogo } from '../base/TituloDialogo'
import { formatearARS } from '../../lib/serviceTecnico'
import { mensajeDeErrorItem, quitarItem } from '../../lib/reparacionItems'
import type { ItemReparacion, Reparacion } from '../../lib/reparaciones'

type Props = {
  reparacion: Reparacion
  // Agregar y quitar solo con `edicion` y la reparación abierta (ni entregada ni anulada).
  puedeEditar: boolean
  onAgregarManoObra: () => void
  onAgregarRepuesto: () => void
  onActualizada: (reparacion: Reparacion, mensaje: string) => void
}

// La épica manda sobre el prototipo: el descuento ocurre al agregar, no al marcar Entregado (FR-009).
export const AYUDA_REPUESTOS = 'Productos del catálogo. Se descuentan del depósito de mercadería elegido al agregar el repuesto.'

const CELDA_NUMERO = { textAlign: 'right', whiteSpace: 'nowrap' } as const

const SOLO_LECTORES = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

type TablaProps = {
  titulo: string
  columnaConcepto: string
  items: ItemReparacion[]
  vacio: string
  etiquetaSubtotal: string
  subtotal: number
  puedeEditar: boolean
  conSku: boolean
  // Columna «Depósito de mercadería» (solo repuestos, F-SVC-10, FR-008).
  conDeposito?: boolean
  onQuitar: (item: ItemReparacion) => void
}

function TablaItems({ titulo, columnaConcepto, items, vacio, etiquetaSubtotal, subtotal, puedeEditar, conSku, conDeposito = false, onQuitar }: TablaProps) {
  const columnas = 4 + (conDeposito ? 1 : 0) + (puedeEditar ? 1 : 0)
  return (
    <TableContainer>
      <Table size="small" aria-label={titulo}>
        <TableHead>
          <TableRow>
            <TableCell>{columnaConcepto}</TableCell>
            {conDeposito ? <TableCell>Depósito de mercadería</TableCell> : null}
            <TableCell sx={CELDA_NUMERO}>Cant.</TableCell>
            <TableCell sx={CELDA_NUMERO}>Precio</TableCell>
            <TableCell sx={CELDA_NUMERO}>Subtotal</TableCell>
            {puedeEditar ? <TableCell sx={{ width: 48 }}><Box component="span" sx={SOLO_LECTORES}>Acciones</Box></TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnas}>
                <Typography variant="body2" color="text.secondary">{vacio}</Typography>
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id}>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>
                  {item.descripcion}
                  {conSku && item.sku ? (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {`SKU ${item.sku}`}
                    </Typography>
                  ) : null}
                </TableCell>
                {conDeposito ? <TableCell>{item.deposito_nombre ?? '—'}</TableCell> : null}
                <TableCell sx={CELDA_NUMERO}>{item.cantidad}</TableCell>
                <TableCell sx={CELDA_NUMERO}>{formatearARS(item.precio_unitario)}</TableCell>
                <TableCell sx={CELDA_NUMERO}>{formatearARS(item.subtotal)}</TableCell>
                {puedeEditar ? (
                  <TableCell sx={{ width: 48, p: 0.5 }}>
                    <IconButton size="small" aria-label={`Quitar ${item.descripcion}`} onClick={() => onQuitar(item)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
          <TableRow>
            <TableCell colSpan={conDeposito ? 4 : 3} sx={{ fontWeight: 600 }}>{etiquetaSubtotal}</TableCell>
            <TableCell sx={{ ...CELDA_NUMERO, fontWeight: 600 }}>{formatearARS(subtotal)}</TableCell>
            {puedeEditar ? <TableCell /> : null}
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function FilaResumen({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant={fuerte ? 'subtitle1' : 'body2'} sx={{ fontWeight: fuerte ? 700 : undefined }}>{etiqueta}</Typography>
      {/* Importe en texto plano y seleccionable de un clic: el cobro se carga a mano en Ventas (FR-027). */}
      <Typography
        component="span"
        variant={fuerte ? 'subtitle1' : 'body2'}
        sx={{ fontWeight: fuerte ? 700 : undefined, userSelect: 'all', whiteSpace: 'nowrap' }}
      >
        {valor}
      </Typography>
    </Stack>
  )
}

// Sección «Mano de obra y repuestos» del detalle (F-SVC-06, FR-027): dos tablas con subtotales y el resumen con el
// Total al cliente (copiable). La Ganancia estimada, solo con `ver_costos`, va junto a la tarjeta «Costo interno».
export function ItemsReparacion({ reparacion, puedeEditar, onAgregarManoObra, onAgregarRepuesto, onActualizada }: Props) {
  const [aQuitar, setAQuitar] = useState<ItemReparacion | null>(null)
  const [quitando, setQuitando] = useState(false)
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null)

  const items = reparacion.items ?? []
  const manoDeObra = items.filter((item) => item.tipo === 'mano_obra')
  const repuestos = items.filter((item) => item.tipo === 'repuesto')

  const cerrarConfirmacion = () => {
    if (quitando) return
    setAQuitar(null)
    setErrorQuitar(null)
  }

  const confirmarQuitar = async () => {
    if (!aQuitar || quitando) return
    setQuitando(true)
    setErrorQuitar(null)
    try {
      const actualizada = await quitarItem(aQuitar)
      setAQuitar(null)
      onActualizada(actualizada, `Se quitó «${aQuitar.descripcion}»`)
    } catch (error) {
      setErrorQuitar(mensajeDeErrorItem(error, 'No pudimos quitar el ítem.'))
    } finally {
      setQuitando(false)
    }
  }

  return (
    <Card>
      <CardHeader title={<Typography component="h2" variant="t3">Mano de obra y repuestos</Typography>} />
      <CardContent>
        <Stack spacing={3}>
          {!puedeEditar ? <Alert severity="info">Los ítems son de solo lectura.</Alert> : null}
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap">
              <Typography component="h3" variant="subtitle1">Mano de obra</Typography>
              {puedeEditar ? <Button variant="outlined" size="small" onClick={onAgregarManoObra}>Agregar mano de obra</Button> : null}
            </Stack>
            <TablaItems
              titulo="Mano de obra"
              columnaConcepto="Concepto"
              items={manoDeObra}
              vacio="Todavía no cargaste mano de obra."
              etiquetaSubtotal="Subtotal mano de obra"
              subtotal={reparacion.total_mano_obra}
              puedeEditar={puedeEditar}
              conSku={false}
              onQuitar={setAQuitar}
            />
          </Stack>

          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap">
              <Box>
                <Typography component="h3" variant="subtitle1">Repuestos</Typography>
                <Typography variant="caption" color="text.secondary">{AYUDA_REPUESTOS}</Typography>
              </Box>
              {puedeEditar ? <Button variant="outlined" size="small" onClick={onAgregarRepuesto}>Agregar repuesto</Button> : null}
            </Stack>
            <TablaItems
              titulo="Repuestos"
              columnaConcepto="Producto"
              items={repuestos}
              vacio="Todavía no cargaste repuestos."
              etiquetaSubtotal="Subtotal repuestos"
              subtotal={reparacion.total_repuestos}
              puedeEditar={puedeEditar}
              conSku
              conDeposito
              onQuitar={setAQuitar}
            />
          </Stack>

          <Stack spacing={0.5} sx={{ maxWidth: 360, ml: { sm: 'auto' } }} role="group" aria-label="Resumen de importes">
            <FilaResumen etiqueta="Mano de obra" valor={formatearARS(reparacion.total_mano_obra)} />
            <FilaResumen etiqueta="Repuestos" valor={formatearARS(reparacion.total_repuestos)} />
            <FilaResumen etiqueta="Total al cliente" valor={formatearARS(reparacion.total_cliente)} fuerte />
            <Typography variant="caption" color="text.secondary">Importes en pesos, sin IVA.</Typography>
          </Stack>
        </Stack>
      </CardContent>

      <Dialog open={aQuitar !== null} onClose={cerrarConfirmacion} fullWidth maxWidth="xs" aria-labelledby="titulo-quitar-item">
        <TituloDialogo id="titulo-quitar-item" onCerrar={cerrarConfirmacion}>Quitar ítem</TituloDialogo>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {aQuitar ? `¿Quitar «${aQuitar.descripcion}» de la reparación? Los totales se recalculan.` : ''}
            </DialogContentText>
            {errorQuitar ? <Alert severity="error">{errorQuitar}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrarConfirmacion} disabled={quitando}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={() => void confirmarQuitar()} disabled={quitando}>
            {quitando ? 'Quitando…' : 'Quitar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
