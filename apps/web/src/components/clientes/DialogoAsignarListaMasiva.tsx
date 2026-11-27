import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, TextField, Typography,
} from '@mui/material'
import { useBanderaListasPrecios } from '../../hooks/useBanderaListasPrecios'
import { useListasPreciosActivas } from '../../hooks/useListasPreciosActivas'
import {
  type FiltroAsignacionMasiva,
  type ResultadoAsignacionMasiva,
  MOTIVO_LISTAS_APAGADAS,
  TOPE_ASIGNACION_MASIVA,
  asignarListaMasiva,
  formatearAjuste,
  mensajeErrorLista,
} from '../../lib/listasPrecios'
import { supabaseClient } from '../../lib/supabase'
import { TituloDialogo } from '../base/TituloDialogo'

type Alcance = 'seleccion' | 'filtro'

type Props = {
  open: boolean
  // Clientes marcados en el listado.
  seleccion: readonly string[]
  // Criterios del listado y cuántos clientes coinciden: permiten asignar a todos los que se ven filtrados, no solo a los marcados.
  filtro: FiltroAsignacionMasiva
  totalFiltro: number
  // El listado muestra archivados: el filtro no los alcanza (no admiten lista), así que esa opción no se ofrece.
  mostrandoArchivados: boolean
  onCerrar: () => void
  onAsignado: (resultado: ResultadoAsignacionMasiva, listaNombre: string | null) => void
}

const QUITAR = '__quitar__'

// Diálogo «Asignar lista de precios» (acción masiva del listado de Clientes, solo administrador, MSF-973): elige una lista y a quién:
// los clientes marcados o todos los que coinciden con la búsqueda y los filtros. «Quitar la lista» sigue disponible con la bandera
// apagada. La selección es de la empresa activa del listado: el padre cierra el diálogo y la descarta al cambiar de empresa.
export function DialogoAsignarListaMasiva({ open, seleccion, filtro, totalFiltro, mostrandoArchivados, onCerrar, onAsignado }: Props) {
  const { listas, cargando, hayError } = useListasPreciosActivas()
  const bandera = useBanderaListasPrecios()
  const [alcance, setAlcance] = useState<Alcance>('seleccion')
  const [eleccion, setEleccion] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enVuelo = useRef(false)

  useEffect(() => {
    if (open) return
    setAlcance('seleccion')
    setEleccion('')
    setError(null)
  }, [open])

  // Sin marcados se ofrece el filtro; con archivados a la vista solo los marcados (el filtro no los alcanza).
  const alcanceEfectivo: Alcance = mostrandoArchivados || (seleccion.length > 0 && alcance === 'seleccion') ? 'seleccion' : 'filtro'
  const cantidad = alcanceEfectivo === 'seleccion' ? seleccion.length : totalFiltro
  const quita = eleccion === QUITAR
  const sinLista = eleccion === ''
  const excedeTope = cantidad > TOPE_ASIGNACION_MASIVA
  // Con la bandera apagada (o sin poder leerla) solo se puede quitar la lista; la base lo exige igual.
  const puedeAsignar = bandera.activa && !bandera.cargando

  const confirmar = async () => {
    if (enVuelo.current || sinLista || cantidad === 0 || excedeTope) return
    enVuelo.current = true
    setEnviando(true)
    setError(null)
    try {
      const listaId = quita ? null : eleccion
      const resultado = await asignarListaMasiva(
        supabaseClient, listaId, alcanceEfectivo === 'seleccion' ? { clientes: seleccion } : { filtro },
      )
      onAsignado(resultado, quita ? null : listas.find((lista) => lista.id === eleccion)?.nombre ?? '')
    } catch (excepcion) {
      setError(mensajeErrorLista(excepcion, 'No pudimos asignar la lista. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onClose={enviando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-asignar-lista-masiva">
      <TituloDialogo id="titulo-asignar-lista-masiva" onCerrar={enviando ? undefined : onCerrar}>Asignar lista de precios</TituloDialogo>
      <DialogContent>
        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {!puedeAsignar && !bandera.cargando ? (
          <Alert severity={bandera.hayError ? 'warning' : 'info'} sx={{ mb: 2 }}>
            {bandera.hayError ? 'No pudimos verificar si las listas de precios están activas. Por ahora solo podés quitar la lista.' : `${MOTIVO_LISTAS_APAGADAS} Por ahora solo podés quitar la lista.`}
          </Alert>
        ) : null}
        <FormControl sx={{ mb: 2 }} disabled={enviando}>
          <FormLabel id="grupo-alcance-lista-masiva">¿A quiénes?</FormLabel>
          <RadioGroup aria-labelledby="grupo-alcance-lista-masiva" value={alcanceEfectivo} onChange={(evento) => setAlcance(evento.target.value as Alcance)}>
            <FormControlLabel
              value="seleccion" control={<Radio />} disabled={seleccion.length === 0}
              label={`Los clientes marcados (${seleccion.length})`}
            />
            <FormControlLabel
              value="filtro" control={<Radio />} disabled={mostrandoArchivados}
              label={`Todos los que coinciden con la búsqueda y los filtros (${totalFiltro})`}
            />
          </RadioGroup>
        </FormControl>
        {mostrandoArchivados ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Los clientes archivados no admiten lista de precios: solo se puede quitar la lista a los marcados.
          </Typography>
        ) : null}
        <TextField
          select fullWidth label="Lista de precios" value={eleccion} disabled={enviando || cargando}
          onChange={(evento) => setEleccion(evento.target.value)}
          error={hayError}
          helperText={hayError ? 'No pudimos cargar las listas.' : 'Reemplaza la lista que ya tengan. El Consumidor final y los archivados se omiten.'}
        >
          {puedeAsignar ? listas.map((lista) => (
            <MenuItem key={lista.id} value={lista.id}>{lista.nombre} ({formatearAjuste(lista.ajustePct)})</MenuItem>
          )) : null}
          <MenuItem value={QUITAR}>Quitar la lista de precios</MenuItem>
        </TextField>
        {excedeTope ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Son más de {TOPE_ASIGNACION_MASIVA} clientes: afiná la búsqueda o la selección.
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void confirmar()} disabled={enviando || sinLista || cantidad === 0 || excedeTope}>
          {enviando ? 'Asignando…' : quita ? `Quitar a ${cantidad}` : `Asignar a ${cantidad}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
