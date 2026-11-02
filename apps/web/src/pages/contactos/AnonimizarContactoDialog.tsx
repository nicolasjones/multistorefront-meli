import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { AVISO_CAMBIO_EMPRESA, useEmpresaActivaCambio } from '../../hooks/useContactos'
import { anonimizarContacto, esConflicto, mensajeDeError } from '../../lib/contactos'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Props = {
  contactoId: string
  actualizadoEn: string
  onCerrar: (aviso?: string) => void
  onAnonimizado: () => void
  /** Ante un conflicto de edición: releer el contacto con el sello vigente. */
  onRecargar: () => void
}

// Confirmación de «Anonimizar» (F-CON-05, FR-010): explica qué se borra, qué se conserva y que no se
// deshace. Si cambia la empresa activa se cierra con aviso (Principio VIII).
export function AnonimizarContactoDialog({ contactoId, actualizadoEn, onCerrar, onAnonimizado, onRecargar }: Props) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const enVuelo = useRef(false)
  const cambioEmpresa = useEmpresaActivaCambio()

  useEffect(() => {
    if (cambioEmpresa) onCerrar(AVISO_CAMBIO_EMPRESA)
  }, [cambioEmpresa, onCerrar])

  const confirmar = async () => {
    if (enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setError(null)
    try {
      await anonimizarContacto(contactoId, actualizadoEn)
      onAnonimizado()
    } catch (e) {
      setError({ texto: mensajeDeError(e, 'No pudimos anonimizar el contacto. Intentá de nuevo.'), conflicto: esConflicto(e) })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : () => onCerrar()} fullWidth maxWidth="sm" aria-labelledby="titulo-anonimizar">
      <TituloDialogo id="titulo-anonimizar" onCerrar={guardando ? undefined : () => onCerrar()}>Anonimizar contacto</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? (
            <Alert
              severity="error"
              action={error.conflicto ? <Button color="inherit" size="small" onClick={onRecargar}>Recargar</Button> : undefined}
            >
              {error.texto}
            </Alert>
          ) : null}
          <Alert severity="warning">Esta acción no se puede deshacer.</Alert>
          <Typography>
            Se reemplazan por un texto neutro el nombre, el correo y el teléfono del contacto, y el nombre, el contacto y el mensaje de las consultas vinculadas.
          </Typography>
          <Typography>
            Se conservan las consultas y las compras, con su estado, fechas, producto, empresa y totales. Los datos originales solo se recuperan desde una copia de seguridad.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onCerrar()} disabled={guardando}>Cancelar</Button>
        <Button color="error" variant="contained" onClick={() => void confirmar()} disabled={guardando}>
          {guardando ? 'Anonimizando…' : 'Anonimizar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
