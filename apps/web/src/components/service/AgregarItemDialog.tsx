import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { formatearARS } from '../../lib/serviceTecnico'
import {
  CANTIDAD_MAXIMA_ITEM,
  agregarItem,
  calcularSubtotal,
  errorDeCampoItem,
  formularioItemVacio,
  mensajeDeErrorItem,
  validarItem,
  type CampoItem,
  type ErroresItem,
  type FormularioItem,
} from '../../lib/reparacionItems'
import type { Reparacion, TipoItemReparacion } from '../../lib/reparaciones'

export type CampoConceptoProps = {
  formulario: FormularioItem
  cambiar: (cambios: Partial<FormularioItem>) => void
  errores: ErroresItem
  deshabilitado: boolean
}

type Props = {
  abierto: boolean
  reparacion: Reparacion
  tipo: TipoItemReparacion
  titulo: string
  onCerrar: () => void
  onAgregada: (reparacion: Reparacion) => void
  // Primer campo del diálogo: el concepto de la mano de obra o el producto del repuesto.
  renderConcepto: (props: CampoConceptoProps) => ReactNode
}

// Cuerpo común de «Agregar mano de obra» y «Agregar repuesto» (F-SVC-06, FR-028): concepto, precio, cantidad y
// subtotal en vivo. Valida cantidad y precio antes de enviar y muestra en el campo lo que la base rechaza.
export function AgregarItemDialog({ abierto, reparacion, tipo, titulo, onCerrar, onAgregada, renderConcepto }: Props) {
  const [formulario, setFormulario] = useState<FormularioItem>(formularioItemVacio)
  const [errores, setErrores] = useState<ErroresItem>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const idTitulo = `titulo-agregar-${tipo}`

  useEffect(() => {
    if (!abierto) return
    setFormulario(formularioItemVacio())
    setErrores({})
    setErrorGeneral(null)
  }, [abierto])

  const cerrar = () => {
    if (!guardando) onCerrar()
  }

  const cambiar = (cambios: Partial<FormularioItem>) => {
    setFormulario((previo) => ({ ...previo, ...cambios }))
    const tocados = Object.keys(cambios).flatMap((campo): CampoItem[] =>
      campo === 'producto' ? ['producto_id', 'descripcion'] : [campo as CampoItem],
    )
    setErrores((previos) => Object.fromEntries(Object.entries(previos).filter(([campo]) => !tocados.includes(campo as CampoItem))))
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando) return
    const encontrados = validarItem(formulario, tipo)
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) {
      const formularioDom = evento.currentTarget as HTMLFormElement
      requestAnimationFrame(() => formularioDom.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setGuardando(true)
    try {
      onAgregada(await agregarItem(reparacion.id, tipo, formulario))
    } catch (error) {
      const deCampo = errorDeCampoItem(error)
      if (deCampo) {
        console.error('La base rechazó un dato del ítem.', error)
        setErrores({ [deCampo.campo]: deCampo.mensaje })
      } else {
        setErrorGeneral(mensajeDeErrorItem(error, 'No pudimos agregar el ítem.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby={idTitulo}>
      <Box component="form" onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id={idTitulo} onCerrar={cerrar}>{titulo}</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            {renderConcepto({ formulario, cambiar, errores, deshabilitado: guardando })}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Precio"
                required
                fullWidth
                value={formulario.precio}
                onChange={(evento) => cambiar({ precio: evento.target.value })}
                disabled={guardando}
                placeholder="0"
                error={Boolean(errores.precio)}
                helperText={errores.precio ?? 'ARS, sin IVA.'}
                slotProps={{
                  input: { endAdornment: <InputAdornment position="end">ARS</InputAdornment> },
                  htmlInput: { inputMode: 'decimal' },
                }}
              />
              <TextField
                label="Cantidad"
                required
                fullWidth
                value={formulario.cantidad}
                onChange={(evento) => cambiar({ cantidad: evento.target.value })}
                disabled={guardando}
                error={Boolean(errores.cantidad)}
                helperText={errores.cantidad}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: String(CANTIDAD_MAXIMA_ITEM).length } }}
              />
            </Stack>
            <Typography variant="subtitle1" aria-live="polite">
              {`Subtotal: ${formatearARS(calcularSubtotal(formulario.cantidad, formulario.precio))}`}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Agregando…' : 'Agregar'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
