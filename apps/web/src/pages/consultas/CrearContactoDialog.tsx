import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormHelperText, Link, Stack, TextField,
} from '@mui/material'
import { AVISO_CAMBIO_EMPRESA, useEmpresaActivaCambio } from '../../hooks/useContactos'
import { TEXTO_CONSENTIMIENTO } from '../../lib/consentimientoContacto'
import {
  contactoExistenteDe,
  crearContacto,
  digitos,
  leerContacto,
  mensajeDeError,
  vincularConsulta,
  type DatosContacto,
  type FichaContacto,
} from '../../lib/contactos'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Props = {
  /** Empresa del contacto: la de la consulta, o la activa si se crea a mano desde la libreta. */
  empresaId: string
  empresaNombre: string
  /** Datos precargados (de la consulta). */
  inicial: DatosContacto
  /** Si viene, el contacto nuevo (o el existente elegido) queda vinculado a esta consulta. */
  consultaId?: string
  /** Cierra el diálogo; `aviso` explica por qué se cerró sin guardar. */
  onCerrar: (aviso?: string) => void
  onCreado: (contactoId: string) => void
  onVinculado?: (contactoId: string) => void
}

type Errores = Partial<Record<'nombre' | 'contacto' | 'correo' | 'telefono' | 'consentimiento', string>>

function validar(datos: DatosContacto, consentimiento: boolean): Errores {
  const errores: Errores = {}
  if (datos.nombre.trim() === '') errores.nombre = 'Escribí el nombre.'
  if (datos.correo.trim() === '' && datos.telefono.trim() === '') errores.contacto = 'Indicá al menos un correo o un teléfono.'
  if (datos.correo.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo.trim())) errores.correo = 'El correo no es válido.'
  if (datos.telefono.trim() !== '' && (digitos(datos.telefono) < 7 || digitos(datos.telefono) > 15)) {
    errores.telefono = 'El teléfono debe tener entre 7 y 15 dígitos.'
  }
  if (!consentimiento) errores.consentimiento = 'Confirmá el consentimiento para guardar el contacto.'
  return errores
}

// Formulario «Crear contacto» (F-CON-05, FR-002…FR-004): nombre, correo, teléfono y casilla de
// consentimiento. Un duplicado no se crea: se muestra el contacto existente y, desde una consulta, se
// ofrece vincularla a él. Si cambia la empresa activa de la barra superior el diálogo se cierra con
// aviso (Principio VIII): jamás guarda lo cargado bajo la empresa nueva.
export function CrearContactoDialog({ empresaId, empresaNombre, inicial, consultaId, onCerrar, onCreado, onVinculado }: Props) {
  const [datos, setDatos] = useState<DatosContacto>(inicial)
  const [consentimiento, setConsentimiento] = useState(false)
  const [errores, setErrores] = useState<Errores>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [existente, setExistente] = useState<{ id: string; ficha: FichaContacto | null } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)
  const cambioEmpresa = useEmpresaActivaCambio()

  useEffect(() => {
    if (cambioEmpresa) onCerrar(AVISO_CAMBIO_EMPRESA)
  }, [cambioEmpresa, onCerrar])

  const cambiar = (campo: keyof DatosContacto) => (evento: { target: { value: string } }) => {
    setDatos((actual) => ({ ...actual, [campo]: evento.target.value }))
    setExistente(null)
  }

  const enviar = async (evento: FormEvent) => {
    // El diálogo vive dentro del detalle de la consulta (otro <form>): el envío no debe subir hasta él.
    evento.preventDefault()
    evento.stopPropagation()
    if (enVuelo.current) return
    const encontrados = validar(datos, consentimiento)
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    setErrorServidor(null)
    setExistente(null)
    try {
      const id = await crearContacto({
        ...datos, empresaId, consentimiento, consentimientoTexto: TEXTO_CONSENTIMIENTO, consultaId,
      })
      onCreado(id)
    } catch (error) {
      const existenteId = contactoExistenteDe(error)
      if (existenteId) {
        const ficha = await leerContacto(existenteId).catch(() => null)
        setExistente({ id: existenteId, ficha })
      } else {
        setErrorServidor(mensajeDeError(error, 'No pudimos guardar el contacto. Intentá de nuevo.'))
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const vincularAlExistente = async () => {
    if (!existente || !consultaId || enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setErrorServidor(null)
    try {
      await vincularConsulta(consultaId, existente.id)
      onVinculado?.(existente.id)
    } catch (error) {
      setErrorServidor(mensajeDeError(error, 'No pudimos vincular la consulta. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : () => onCerrar()} fullWidth maxWidth="sm" aria-labelledby="titulo-crear-contacto">
      <form onSubmit={(evento) => void enviar(evento)} noValidate>
        <TituloDialogo id="titulo-crear-contacto" onCerrar={guardando ? undefined : () => onCerrar()}>
          Crear contacto · {empresaNombre}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorServidor ? <Alert severity="error">{errorServidor}</Alert> : null}
            {existente ? (
              <Alert
                severity="warning"
                action={consultaId ? (
                  <Button color="inherit" size="small" onClick={() => void vincularAlExistente()} disabled={guardando}>
                    Vincular la consulta al existente
                  </Button>
                ) : undefined}
              >
                Ya existe un contacto con ese correo o teléfono en {empresaNombre}:{' '}
                <Link component={RouterLink} to={`/contactos/${existente.id}`}>
                  {existente.ficha?.nombre ?? 'ver el contacto existente'}
                </Link>
                .
              </Alert>
            ) : null}
            <TextField
              label="Nombre"
              size="small"
              required
              value={datos.nombre}
              onChange={cambiar('nombre')}
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
              disabled={guardando}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              label="Correo"
              type="email"
              size="small"
              value={datos.correo}
              onChange={cambiar('correo')}
              error={Boolean(errores.correo || errores.contacto)}
              helperText={errores.correo ?? errores.contacto ?? 'Correo o teléfono: al menos uno.'}
              disabled={guardando}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              label="Teléfono"
              type="tel"
              size="small"
              value={datos.telefono}
              onChange={cambiar('telefono')}
              error={Boolean(errores.telefono)}
              helperText={errores.telefono}
              disabled={guardando}
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
            <FormControl error={Boolean(errores.consentimiento)}>
              <FormControlLabel
                control={<Checkbox checked={consentimiento} onChange={(evento) => setConsentimiento(evento.target.checked)} disabled={guardando} />}
                label="Confirmo el consentimiento de la persona"
              />
              <FormHelperText>{errores.consentimiento ?? TEXTO_CONSENTIMIENTO}</FormHelperText>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={() => onCerrar()} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar contacto'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
