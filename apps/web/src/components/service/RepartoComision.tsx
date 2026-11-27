import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, CardHeader, CircularProgress, Dialog, DialogActions, DialogContent,
  IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { TituloDialogo } from '../base/TituloDialogo'
import type { Tecnico } from '../../lib/reparaciones'
import {
  MAX_TECNICOS_REPARTO, aEnvioDeReparto, errorDeReparto, formatearPorcentaje, guardarRepartoComision,
  mensajeDeErrorComisiones, obtenerRepartoComision, sumaDeReparto, type BorradorLinea, type RepartoComision as Reparto,
} from '../../lib/comisiones'

type Props = {
  reparacionId: string
  tecnicos: Tecnico[]
}

// Sección «Comisión de técnicos» del detalle de la reparación (MSF-953). Muestra cómo se reparte la comisión entre los
// técnicos (por defecto, 100 % al asignado) SIN importes ni costos. Se edita con «Repartir»: antes de la entrega alcanza con
// edición; después de la entrega el reparto está congelado y cambiarlo exige el permiso «Ver comisiones» y un motivo (la base
// lo decide: `puede_editar`). Se monta con `key` = reparación + tienda activa, así nunca muestra el reparto de otra.
export function RepartoComision({ reparacionId, tecnicos }: Props) {
  const [reparto, setReparto] = useState<Reparto | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const idPedido = useRef(0)

  const cargar = useCallback(async () => {
    const pedido = ++idPedido.current
    setCargando(true)
    setErrorCarga(null)
    try {
      const dato = await obtenerRepartoComision(reparacionId)
      if (pedido === idPedido.current) setReparto(dato)
    } catch (error) {
      if (pedido === idPedido.current) setErrorCarga(mensajeDeErrorComisiones(error, 'No pudimos cargar el reparto de la comisión.'))
    } finally {
      if (pedido === idPedido.current) setCargando(false)
    }
  }, [reparacionId])

  useEffect(() => {
    void cargar()
    return () => { idPedido.current += 1 }
  }, [cargar])

  return (
    <Card component="section" aria-labelledby="titulo-reparto-comision">
      <CardHeader title={<Typography id="titulo-reparto-comision" component="h2" variant="t3">Comisión de técnicos</Typography>} />
      <CardContent>
        <Stack spacing={1.5}>
          {cargando && reparto === null ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status" aria-live="polite">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Cargando el reparto…</Typography>
            </Stack>
          ) : errorCarga ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>
              {errorCarga}
            </Alert>
          ) : reparto ? (
            <>
              {reparto.reparto.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Sin técnico asignado: la reparación no genera comisión. Asigná un técnico o repartila entre varios.
                </Typography>
              ) : (
                <Box component="ul" aria-label="Reparto de la comisión" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {reparto.reparto.map((linea, indice) => (
                    <Box component="li" key={linea.tecnico_id ?? `baja-${indice}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
                      <Typography variant="body2">{linea.nombre}</Typography>
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatearPorcentaje(linea.porcentaje)}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                {reparto.congelado
                  ? 'La reparación ya se entregó: el reparto está congelado. Cambiarlo exige el permiso «Ver comisiones» y queda registrado.'
                  : reparto.por_defecto
                    ? 'Reparto por defecto: 100 % al técnico asignado. Se congela al entregar la reparación.'
                    : 'Reparto personalizado. Se congela al entregar la reparación.'}
              </Typography>
              {reparto.puede_editar ? (
                <Box>
                  <Button variant="outlined" size="small" onClick={() => setAbierto(true)}>Repartir comisión</Button>
                </Box>
              ) : null}
              {abierto ? (
                <RepartoDialog
                  reparacionId={reparacionId}
                  reparto={reparto}
                  tecnicos={tecnicos}
                  onCerrar={() => setAbierto(false)}
                  onGuardado={(nuevo) => { setReparto(nuevo); setAbierto(false) }}
                />
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

type DialogProps = {
  reparacionId: string
  reparto: Reparto
  tecnicos: Tecnico[]
  onCerrar: () => void
  onGuardado: (nuevo: Reparto) => void
}

function RepartoDialog({ reparacionId, reparto, tecnicos, onCerrar, onGuardado }: DialogProps) {
  const [lineas, setLineas] = useState<BorradorLinea[]>(() => {
    const inicial = reparto.reparto.filter((l) => l.tecnico_id !== null)
    return inicial.length > 0
      ? inicial.map((l) => ({ tecnico_id: l.tecnico_id as string, porcentaje: String(l.porcentaje).replace('.', ',') }))
      : [{ tecnico_id: '', porcentaje: '100' }]
  })
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  // Los técnicos del reparto actual que ya no están en la lista (p. ej. dados de baja) se conservan como opción.
  const opciones = [
    ...tecnicos,
    ...reparto.reparto
      .filter((l) => l.tecnico_id !== null && !tecnicos.some((t) => t.user_id === l.tecnico_id))
      .map((l) => ({ user_id: l.tecnico_id as string, nombre: l.nombre })),
  ]
  const suma = sumaDeReparto(lineas)
  const errorLocal = errorDeReparto(lineas)
  const motivoObligatorio = reparto.congelado
  const motivoFalta = motivoObligatorio && motivo.trim().length < 3

  const cambiar = (indice: number, cambio: Partial<BorradorLinea>) =>
    setLineas((previas) => previas.map((l, i) => (i === indice ? { ...l, ...cambio } : l)))

  const enviar = async (lineasAEnviar: BorradorLinea[]) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setError(null)
    try {
      const nuevo = await guardarRepartoComision(reparacionId, aEnvioDeReparto(lineasAEnviar), motivoObligatorio ? motivo.trim() : null)
      onGuardado(nuevo)
    } catch (e) {
      setError(mensajeDeErrorComisiones(e, 'No pudimos guardar el reparto. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const alEnviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (errorLocal || motivoFalta) return
    void enviar(lineas)
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-repartir-comision">
      <TituloDialogo id="titulo-repartir-comision" onCerrar={onCerrar}>Repartir la comisión</TituloDialogo>
      <Box component="form" onSubmit={alEnviar} noValidate>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Los porcentajes tienen que sumar 100 %. Cada técnico cobra su parte con su propia regla de comisión.
            </Typography>
            {lineas.map((linea, indice) => (
              <Stack key={indice} direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  select
                  size="small"
                  label={`Técnico ${indice + 1}`}
                  value={linea.tecnico_id}
                  onChange={(e) => cambiar(indice, { tecnico_id: e.target.value })}
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {opciones.map((t) => <MenuItem key={t.user_id} value={t.user_id}>{t.nombre}</MenuItem>)}
                </TextField>
                <TextField
                  size="small"
                  label={`Porcentaje ${indice + 1}`}
                  value={linea.porcentaje}
                  onChange={(e) => cambiar(indice, { porcentaje: e.target.value })}
                  slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `Porcentaje del técnico ${indice + 1}` } }}
                  sx={{ width: 110 }}
                />
                <IconButton
                  aria-label={`Quitar al técnico ${indice + 1}`}
                  onClick={() => setLineas((previas) => previas.filter((_, i) => i !== indice))}
                  disabled={lineas.length === 1}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button
                size="small"
                onClick={() => setLineas((previas) => [...previas, { tecnico_id: '', porcentaje: '' }])}
                disabled={lineas.length >= MAX_TECNICOS_REPARTO}
              >
                Agregar técnico
              </Button>
            </Box>
            <Typography variant="body2" role="status" aria-live="polite" color={suma === 100 ? 'text.secondary' : 'error'}>
              Suma: {formatearPorcentaje(suma)}
            </Typography>
            {motivoObligatorio ? (
              <TextField
                size="small"
                label="Motivo del cambio"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required
                multiline
                minRows={2}
                helperText="La reparación ya se entregó: el cambio queda registrado con este motivo."
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            ) : null}
            {errorLocal ? <Alert severity="warning">{errorLocal}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {!reparto.congelado && !reparto.por_defecto ? (
            <Button onClick={() => void enviar([])} disabled={guardando} sx={{ mr: 'auto' }}>Volver al reparto por defecto</Button>
          ) : null}
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando || errorLocal !== null || motivoFalta}>Guardar reparto</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
