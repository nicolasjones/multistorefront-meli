import { type MutableRefObject, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { formatearImporteHistorial } from '../../lib/formatoHistorial'
import type { EnvioMoto } from '../../lib/ventas/enviosMoto'
import {
  type ResultadoRendicion,
  mensajeDeErrorRendicion,
  mensajerosDeSeleccion,
  rendirEnviosMoto,
  totalesDeSeleccion,
} from '../../lib/ventas/enviosMotoRendicion'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Envíos elegidos (todos enviados y sin rendir): de ellos salen los totales que se muestran.
  envios: ReadonlyArray<EnvioMoto>
  onCerrar: () => void
  onRendido: (resultado: ResultadoRendicion) => void
}

// Diálogo de confirmación de «Rendir seleccionados» (F-VTA-25, FR-021 y FR-022). No está dibujado
// en el prototipo (decisión abierta de detalle 1). El total a rendir es el efectivo cobrado: el
// costo se muestra aparte y el neto es informativo. Con mensajeros mezclados la confirmación se
// bloquea; la base responde igual `22023` y no rinde ninguno.
export function RendicionMotosDialog({ open, ...resto }: Props) {
  // Mientras se rinde no se cierra con Escape ni con un clic afuera (ver EnvioMotoDialog).
  const enVuelo = useRef(false)
  return (
    <Dialog open={open} onClose={() => { if (!enVuelo.current) resto.onCerrar() }} fullWidth maxWidth="xs" aria-labelledby="titulo-rendicion-motos">
      <Contenido {...resto} enVuelo={enVuelo} />
    </Dialog>
  )
}

function Fila({ etiqueta, valor, enfasis = false }: { etiqueta: string; valor: string; enfasis?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography component="dt" variant="body2" color="text.secondary">{etiqueta}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, fontVariantNumeric: 'tabular-nums', fontWeight: enfasis ? 700 : undefined }}>{valor}</Typography>
    </Stack>
  )
}

function Contenido({ envios, onCerrar, onRendido, enVuelo }: Omit<Props, 'open'> & { enVuelo: MutableRefObject<boolean> }) {
  const [rindiendo, setRindiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const totales = totalesDeSeleccion(envios)
  const mensajeros = mensajerosDeSeleccion(envios)
  const mezcla = mensajeros.length > 1

  const confirmar = async () => {
    if (enVuelo.current || mezcla || envios.length === 0) return
    enVuelo.current = true
    setRindiendo(true)
    setError(null)
    try {
      onRendido(await rendirEnviosMoto(envios.map((e) => e.id)))
    } catch (falla) {
      setError(mensajeDeErrorRendicion(falla, 'No pudimos rendir las entregas. Intentá de nuevo.'))
      setRindiendo(false)
    } finally {
      enVuelo.current = false
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-rendicion-motos" onCerrar={rindiendo ? undefined : onCerrar}>
        Rendir entregas
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          {mezcla ? (
            <Alert severity="warning">
              {`La selección mezcla mensajeros (${mensajeros.join(', ')}). Elegí entregas de un solo mensajero para rendirlas juntas.`}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack component="dl" spacing={1} sx={{ m: 0 }}>
            {mezcla ? null : <Fila etiqueta="Mensajero" valor={mensajeros[0] ?? '—'} />}
            <Fila etiqueta="Entregas" valor={String(totales.cantidad)} />
            <Fila etiqueta="Efectivo cobrado" valor={formatearImporteHistorial(totales.efectivoCobrado)} />
            <Fila etiqueta="Costo de envíos" valor={formatearImporteHistorial(totales.costoEnvios)} />
            <Fila etiqueta="Total a rendir" valor={formatearImporteHistorial(totales.totalARendir)} enfasis />
            <Fila etiqueta="Neto" valor={formatearImporteHistorial(totales.neto)} />
          </Stack>
          <Typography variant="xs" color="text.secondary">
            Rendir cierra la cuenta del mensajero y registra el cobro en cada factura, hasta lo que le falta cobrar: no se puede revertir. El total es el efectivo cobrado; el costo de los envíos y el neto son informativos.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={rindiendo}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={rindiendo || mezcla || envios.length === 0}>
          {rindiendo ? 'Rindiendo…' : 'Confirmar rendición'}
        </Button>
      </DialogActions>
    </>
  )
}
