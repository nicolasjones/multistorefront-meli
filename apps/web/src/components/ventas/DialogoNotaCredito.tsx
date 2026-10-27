import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  CONCEPTO_NOTA_MAXIMO,
  EJEMPLO_NOTA_CREDITO,
  ETIQUETA_EMITIR_NOTA_CREDITO,
  ETIQUETA_NOTA_CREDITO,
  TIPOS_NOTA_CREDITO,
  armarLineasNota,
  emitirNotaCredito,
  hayErroresNota,
  mensajeDeNotaCredito,
  validarNota,
  type ErroresNota,
  type LineaAcreditable,
  type TipoNotaCredito,
} from '../../lib/notaCredito'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  factura: { id: string; numero: string }
  lineas: readonly LineaAcreditable[]
  onCerrar: () => void
  onEmitida: (nota: { id: string; numero: string }) => void
}

// Diálogo «Nota de crédito» (F-VTA-11, FR-045). Textos del prototipo: título, «Se emite una nota de crédito asociada a
// …», los tres motivos con su descripción, el ejemplo y Cancelar / Emitir nota de crédito. Los datos mínimos para
// emitir (cantidades por línea, o importe y concepto) no están en el prototipo: se piden con componentes del kit.
export function DialogoNotaCredito({ open, factura, lineas, onCerrar, onEmitida }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-nota-credito">
      {/* El contenido se monta al abrir: cada apertura parte sin datos ni errores previos. */}
      <Contenido factura={factura} lineas={lineas} onCerrar={onCerrar} onEmitida={onEmitida} />
    </Dialog>
  )
}

function Contenido({ factura, lineas, onCerrar, onEmitida }: Omit<Props, 'open'>) {
  const [tipo, setTipo] = useState<TipoNotaCredito>('devolucion_productos')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [importe, setImporte] = useState('')
  const [concepto, setConcepto] = useState('')
  const [errores, setErrores] = useState<ErroresNota>({})
  const [error, setError] = useState<string | null>(null)
  const [emitiendo, setEmitiendo] = useState(false)

  const disponibles = lineas.filter((linea) => linea.disponible > 0)

  const emitir = async () => {
    if (emitiendo) return
    const entrada = { tipo, cantidades, importe, concepto }
    const encontrados = validarNota(entrada, disponibles)
    setErrores(encontrados)
    if (hayErroresNota(encontrados)) return
    setEmitiendo(true)
    setError(null)
    try {
      const nota = await emitirNotaCredito(factura.id, tipo, armarLineasNota(entrada, disponibles), tipo === 'devolucion_productos' ? '' : concepto)
      onEmitida(nota)
    } catch (falla) {
      setError(mensajeDeNotaCredito(falla))
      setEmitiendo(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-nota-credito" onCerrar={emitiendo ? undefined : onCerrar}>
        {ETIQUETA_NOTA_CREDITO}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Se emite una nota de crédito asociada a Factura {factura.numero}. Elegí el motivo:
          </Typography>

          <FormControl>
            <FormLabel id="motivo-nota-credito" sx={{ display: 'none' }}>Motivo de la nota de crédito</FormLabel>
            <RadioGroup
              aria-labelledby="motivo-nota-credito"
              value={tipo}
              onChange={(evento) => {
                setTipo(evento.target.value as TipoNotaCredito)
                setErrores({})
                setError(null)
              }}
            >
              {TIPOS_NOTA_CREDITO.map((definicion) => (
                <FormControlLabel
                  key={definicion.valor}
                  value={definicion.valor}
                  disabled={emitiendo}
                  control={<Radio />}
                  sx={{ alignItems: 'flex-start', border: 1, borderColor: tipo === definicion.valor ? 'primary.main' : 'divider', borderRadius: 1, mb: 1, mx: 0, py: 0.5, pr: 1 }}
                  label={
                    <span>
                      <b>{definicion.etiqueta}</b>
                      <br />
                      <Typography component="span" variant="body2" color="text.secondary">{definicion.descripcion}</Typography>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </FormControl>

          <Typography variant="body2" color="text.secondary">{EJEMPLO_NOTA_CREDITO}</Typography>

          {tipo === 'devolucion_productos' ? (
            <Stack spacing={1} role="group" aria-label="Productos a devolver">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Productos a devolver</Typography>
              {disponibles.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No quedan productos por devolver en esta factura.</Typography>
              ) : (
                disponibles.map((linea) => (
                  <Stack key={linea.linea_id} direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                      {linea.descripcion}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {linea.deposito} · quedan {linea.disponible} de {linea.cantidad}
                      </Typography>
                    </Typography>
                    <TextField
                      label="Cantidad"
                      size="small"
                      sx={{ width: 120 }}
                      value={cantidades[linea.linea_id] ?? ''}
                      onChange={(evento) => setCantidades((previas) => ({ ...previas, [linea.linea_id]: evento.target.value }))}
                      disabled={emitiendo}
                      error={Boolean(errores.cantidadPorLinea?.[linea.linea_id])}
                      helperText={errores.cantidadPorLinea?.[linea.linea_id]}
                      slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Cantidad a devolver de ${linea.descripcion}` } }}
                    />
                  </Stack>
                ))
              )}
              {errores.cantidades ? <Typography variant="caption" color="error" role="alert">{errores.cantidades}</Typography> : null}
            </Stack>
          ) : (
            <Stack spacing={1.5} role="group" aria-label="Importe a acreditar">
              <TextField
                label="Importe sin IVA"
                required
                fullWidth
                value={importe}
                onChange={(evento) => setImporte(evento.target.value)}
                disabled={emitiendo}
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
                disabled={emitiendo}
                error={Boolean(errores.concepto)}
                helperText={errores.concepto ?? `${concepto.trim().length} / ${CONCEPTO_NOTA_MAXIMO}`}
              />
            </Stack>
          )}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={emitiendo}>Cancelar</Button>
        <Button variant="contained" onClick={() => void emitir()} disabled={emitiendo}>
          {emitiendo ? 'Emitiendo…' : ETIQUETA_EMITIR_NOTA_CREDITO}
        </Button>
      </DialogActions>
    </>
  )
}
