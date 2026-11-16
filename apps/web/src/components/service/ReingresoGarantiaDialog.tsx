import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { hoyEnArgentina, type Reparacion, type Tecnico } from '../../lib/reparaciones'
import {
  LARGO_MAXIMO_FALLA_GARANTIA,
  errorDeCampoGarantia,
  formularioGarantiaVacio,
  mensajeDeErrorGarantia,
  reingresarPorGarantia,
  validarGarantia,
  type ErroresGarantia,
  type FormularioGarantia,
} from '../../lib/reparacionGarantia'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  tecnicos: Tecnico[]
  /** Empresa activa de la barra superior: si cambia con el diálogo abierto, se avisa para cerrarlo (Principio VIII). */
  empresaActivaId: string | null
  onCerrar: () => void
  onCambioEmpresa: () => void
  onReingresada: (nueva: Reparacion) => void
}

// Reingreso por garantía (FR-022): resumen del equipo en solo lectura, falla obligatoria y técnico/entrega prevista
// opcionales. La base repite las validaciones y sus errores se muestran en el campo.
export function ReingresoGarantiaDialog({
  abierto,
  reparacion,
  tecnicos,
  empresaActivaId,
  onCerrar,
  onCambioEmpresa,
  onReingresada,
}: Props) {
  const [formulario, setFormulario] = useState<FormularioGarantia>(formularioGarantiaVacio)
  const [errores, setErrores] = useState<ErroresGarantia>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!abierto) {
      empresaAlAbrir.current = undefined
      return
    }
    setFormulario(formularioGarantiaVacio())
    setErrores({})
    setErrorGeneral(null)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    onCambioEmpresa()
  }, [abierto, empresaActivaId, onCambioEmpresa])

  const cerrar = () => {
    if (!guardando) onCerrar()
  }

  const cambiar = (campo: keyof FormularioGarantia, valor: string) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined }))
  }

  const reingresar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    const encontrados = validarGarantia(formulario, hoyEnArgentina())
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) {
      const formularioDom = evento.currentTarget as HTMLFormElement
      requestAnimationFrame(() => formularioDom.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      onReingresada(await reingresarPorGarantia(reparacion.id, formulario))
    } catch (error) {
      const deCampo = errorDeCampoGarantia(error)
      if (deCampo) {
        console.error('La base rechazó un dato del reingreso.', error)
        setErrores({ [deCampo.campo]: deCampo.mensaje })
      } else {
        setErrorGeneral(mensajeDeErrorGarantia(error, 'No pudimos reingresar la reparación.'))
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const resumen = [
    { etiqueta: 'Reparación', valor: reparacion.codigo },
    { etiqueta: 'Cliente', valor: reparacion.cliente },
    { etiqueta: 'Equipo', valor: `${reparacion.equipo} ${reparacion.modelo}` },
    { etiqueta: 'N.º de serie', valor: reparacion.numero_serie ?? '—' },
    { etiqueta: 'Accesorios', valor: reparacion.accesorios || '—' },
  ]

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-reingreso-garantia">
      <Box component="form" onSubmit={(evento) => void reingresar(evento)} noValidate>
        <TituloDialogo id="titulo-reingreso-garantia" onCerrar={guardando ? undefined : cerrar}>
          {`Reingresar por garantía · ${reparacion.codigo}`}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <Box component="dl" aria-label="Resumen del equipo" sx={{ m: 0, bgcolor: 'action.hover', borderRadius: (tema) => tema.shape.borderRadius, p: 2 }}>
              {resumen.map((fila) => (
                <Stack key={fila.etiqueta} direction="row" spacing={2} justifyContent="space-between">
                  <Typography component="dt" variant="body2" color="text.secondary">{fila.etiqueta}</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, textAlign: 'right' }}>{fila.valor}</Typography>
                </Stack>
              ))}
            </Box>
            <TextField
              label="Falla del reingreso"
              required
              multiline
              minRows={3}
              autoFocus
              value={formulario.falla}
              onChange={(evento) => cambiar('falla', evento.target.value)}
              error={Boolean(errores.falla)}
              helperText={errores.falla}
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_FALLA_GARANTIA } }}
            />
            <TextField
              select
              label="Técnico"
              value={formulario.tecnico}
              onChange={(evento) => cambiar('tecnico', evento.target.value)}
              error={Boolean(errores.tecnico)}
              helperText={errores.tecnico}
            >
              <MenuItem value="">Sin asignar</MenuItem>
              {tecnicos.map((tecnico) => <MenuItem key={tecnico.user_id} value={tecnico.user_id}>{tecnico.nombre}</MenuItem>)}
            </TextField>
            <TextField
              label="Entrega prevista"
              type="date"
              value={formulario.entrega_prevista}
              onChange={(evento) => cambiar('entrega_prevista', evento.target.value)}
              error={Boolean(errores.entrega_prevista)}
              helperText={errores.entrega_prevista}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: hoyEnArgentina() } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Reingresando…' : 'Reingresar'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
