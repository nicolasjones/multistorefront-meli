import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useCambioDeAlcance } from '../../hooks/useConfiguracionCotizacion'
import { type AlcanceCotizacion, type PrevisualizacionAlcance } from '../../lib/cotizacion'
import { BloqueQueVaACambiar } from './BloqueQueVaACambiar'

type Props = {
  alcance: AlcanceCotizacion
  onCerrar: () => void
  onCambiado: (alcance: AlcanceCotizacion, preciosAfectados: number) => void
}

const TITULO: Record<AlcanceCotizacion, string> = {
  empresa: 'Pasar a una cotización por empresa',
  sistema: 'Pasar a una cotización para todo el sistema',
}

const EXPLICACION: Record<AlcanceCotizacion, string> = {
  empresa: 'Cada empresa va a cargar su propio valor. Hoy todas arrancan con la cotización vigente, así que los precios no cambian hasta que carguen una nueva.',
  sistema: 'Las empresas vuelven a usar una sola cotización. Las cargas propias de cada empresa se descartan y los precios se recalculan con la general.',
}

// Diálogo de cambio de alcance de la cotización (F-PRE-06, FR-004/FR-005). Al montarse pide la vista previa
// (que solo lee) y la muestra con el bloque «Qué va a cambiar»; recién «Cambiar alcance» lo aplica, en una sola
// transacción de la base. Cancelar o cerrar no cambia nada. El dueño lo MONTA al abrir y lo desmonta al cerrar.
export function DialogoAlcance({ alcance, onCerrar, onCambiado }: Props) {
  const { previsualizar, cambiar, enviando } = useCambioDeAlcance()
  const [previa, setPrevia] = useState<PrevisualizacionAlcance | null>(null)
  const [hayError, setHayError] = useState(false)
  const [intento, setIntento] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setPrevia(null)
    setHayError(false)
    previsualizar(alcance)
      .then((resultado) => { if (vigente) setPrevia(resultado) })
      .catch((falla: unknown) => {
        console.error('No pudimos calcular qué cambia con el nuevo alcance.', falla)
        if (vigente) setHayError(true)
      })
    return () => { vigente = false }
  }, [alcance, previsualizar, intento])

  const confirmar = async () => {
    if (enviando) return
    setError(null)
    const resultado = await cambiar(alcance)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    onCambiado(alcance, resultado.preciosAfectados)
  }

  const cerrar = () => { if (!enviando) onCerrar() }

  return (
    <Dialog open onClose={cerrar} fullWidth maxWidth="md" aria-labelledby="titulo-cambiar-alcance">
      <TituloDialogo id="titulo-cambiar-alcance" onCerrar={cerrar}>{TITULO[alcance]}</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="s">{EXPLICACION[alcance]}</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!previa && !hayError ? <EstadoCargaPagina lineas={2} /> : null}
          {hayError ? <EstadoError descripcion="No pudimos calcular qué va a cambiar." reintentar={() => setIntento((n) => n + 1)} /> : null}
          {previa ? (
            <BloqueQueVaACambiar
              leyendaPrecios="precios que cambian"
              previa={{
                redondeoPesos: previa.redondeoPesos,
                muestra: previa.muestra,
                empresas: previa.empresas.map((e) => ({ empresaId: e.empresaId, nombre: e.nombre, precios: e.preciosQueCambian })),
              }}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" disabled={!previa || enviando} onClick={() => void confirmar()}>
          {enviando ? 'Cambiando…' : 'Cambiar alcance'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
