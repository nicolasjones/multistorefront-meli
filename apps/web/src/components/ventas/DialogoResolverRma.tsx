import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { hayErroresNota, validarNota, type ErroresNota } from '../../lib/notaCredito'
import {
  CONCEPTO_NOTA_RMA_MAXIMO,
  mensajeDeResolucionRma,
  reingresarStockRma,
  vincularNotaCreditoRma,
  type RmaListado,
} from '../../lib/rma'
import { parsearPrecioLinea } from '../../lib/ventasLineas'
import { TituloDialogo } from '../base/TituloDialogo'

export type ModoResolucion = 'nota' | 'stock'

type Props = {
  /** Devolución a resolver; `null` = diálogo cerrado. */
  rma: RmaListado | null
  modo: ModoResolucion
  onCerrar: () => void
  onResuelta: (rma: RmaListado, modo: ModoResolucion) => void
}

// Resolución de una devolución (F-VTA-30, FR-021/FR-022). No está dibujada en el prototipo (Decisiones abiertas 7): se
// arma con componentes del kit. «nota» pide importe sin IVA y concepto y emite la nota de crédito vinculada; «stock» solo
// confirma el reingreso de los ítems a su depósito de origen. La autoridad (permisos, topes, idempotencia) es la base.
export function DialogoResolverRma({ rma, modo, onCerrar, onResuelta }: Props) {
  return (
    <Dialog open={rma !== null} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-resolver-rma">
      {/* El contenido se monta al abrir: cada apertura parte sin datos ni errores previos. */}
      {rma ? <Contenido rma={rma} modo={modo} onCerrar={onCerrar} onResuelta={onResuelta} /> : null}
    </Dialog>
  )
}

function Contenido({ rma, modo, onCerrar, onResuelta }: Omit<Props, 'rma'> & { rma: RmaListado }) {
  const [importe, setImporte] = useState('')
  const [concepto, setConcepto] = useState('')
  const [errores, setErrores] = useState<ErroresNota>({})
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const confirmar = async () => {
    if (enviando) return
    if (modo === 'nota') {
      const encontrados = validarNota({ tipo: 'devolucion_importe', cantidades: {}, importe, concepto }, [])
      setErrores(encontrados)
      if (hayErroresNota(encontrados)) return
    }
    setEnviando(true)
    setError(null)
    try {
      if (modo === 'nota') await vincularNotaCreditoRma(rma.id, parsearPrecioLinea(importe) as number, concepto)
      else await reingresarStockRma(rma.id)
      onResuelta(rma, modo)
    } catch (falla) {
      setError(mensajeDeResolucionRma(falla))
      setEnviando(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-resolver-rma" onCerrar={enviando ? undefined : onCerrar}>
        {modo === 'nota' ? 'Emitir nota de crédito' : 'Reingresar stock'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          {modo === 'nota' ? (
            <>
              <Typography variant="body2" color="text.secondary">
                Se emite una nota de crédito asociada a la factura {rma.comprobante_numero} y se vincula a la devolución {rma.numero}, que queda cerrada.
              </Typography>
              <TextField
                label="Importe sin IVA"
                required
                fullWidth
                value={importe}
                onChange={(evento) => setImporte(evento.target.value)}
                disabled={enviando}
                error={Boolean(errores.importe)}
                helperText={errores.importe ?? 'El IVA se calcula con la proporción de la factura.'}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField
                label="Concepto"
                required
                fullWidth
                value={concepto}
                onChange={(evento) => setConcepto(evento.target.value)}
                disabled={enviando}
                error={Boolean(errores.concepto)}
                helperText={errores.concepto ?? `${concepto.trim().length} / ${CONCEPTO_NOTA_RMA_MAXIMO}`}
              />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Los productos de la devolución {rma.numero} ({rma.producto}) vuelven al stock, en el depósito de donde salieron, con el motivo «Devolución». La devolución queda cerrada.
            </Typography>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enviando}>
          {enviando ? 'Guardando…' : modo === 'nota' ? 'Emitir nota de crédito' : 'Reingresar stock'}
        </Button>
      </DialogActions>
    </>
  )
}
