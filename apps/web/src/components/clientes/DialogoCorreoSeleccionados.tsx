import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { CamposRedaccionCorreo } from './CamposRedaccionCorreo'
import { nuevaClaveCampana, redaccionValida, validarRedaccion, type ErroresRedaccion } from '../../lib/correoMasivo'
import { useCorreoMasivo } from '../../hooks/useCorreoMasivo'

type Props = {
  open: boolean
  /** Clientes marcados en el listado. */
  clientes: string[]
  /** Empresa activa con la que se marcaron; null = todas. Principio VIII. */
  empresaId: string | null
  onCerrar: () => void
  /** La campaña se creó: recibe cuántos clientes se marcaron. */
  onEnviado: (marcados: number) => void
}

// Diálogo «Enviar correo a seleccionados» del listado de Clientes (F-CLI-12, FR-011): textos literales del
// prototipo, ampliado con «y aceptan el correo masivo». Crea una campaña solo con los marcados; quienes no son
// elegibles quedan afuera igual que en la pantalla de destinatarios. El padre lo cierra al cambiar de empresa.
export function DialogoCorreoSeleccionados({ open, clientes, empresaId, onCerrar, onEnviado }: Props) {
  const [asunto, setAsunto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [errores, setErrores] = useState<ErroresRedaccion | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const { crearCampana, enviando } = useCorreoMasivo()
  // Una clave por apertura: el doble clic y el reintento tras un error de red no crean dos campañas.
  const clave = useRef(nuevaClaveCampana())

  useEffect(() => {
    if (open) {
      clave.current = nuevaClaveCampana()
      setAsunto('')
      setMensaje('')
      setErrores(null)
      setErrorEnvio(null)
    }
  }, [open])

  const enviar = async () => {
    const encontrados = validarRedaccion(asunto, mensaje)
    setErrores(encontrados)
    if (!redaccionValida(encontrados) || enviando) return
    setErrorEnvio(null)
    const resultado = await crearCampana({ clave: clave.current, asunto, mensaje, empresaId, texto: '', tipo: null, conCuentaWeb: false, clientes })
    if (resultado.ok) onEnviado(clientes.length)
    else setErrorEnvio(resultado.error)
  }

  return (
    <Dialog open={open} onClose={enviando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="dialogo-correo-titulo">
      <DialogTitle id="dialogo-correo-titulo">Enviar correo a seleccionados</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Se envía a los {clientes.length} clientes marcados en el listado. Solo reciben el correo quienes tienen un mail cargado y aceptan el correo masivo.
        </DialogContentText>
        {errorEnvio ? <Alert severity="error" sx={{ mb: 2 }}>{errorEnvio}</Alert> : null}
        <CamposRedaccionCorreo
          idBase="dialogo-correo"
          asunto={asunto}
          mensaje={mensaje}
          onAsunto={setAsunto}
          onMensaje={setMensaje}
          errores={errores}
          disabled={enviando}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void enviar()} disabled={enviando}>Enviar correo</Button>
      </DialogActions>
    </Dialog>
  )
}
