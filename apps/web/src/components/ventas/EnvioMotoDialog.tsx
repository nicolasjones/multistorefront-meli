import { type FormEvent, type MutableRefObject, useEffect, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, Switch,
  TextField,
} from '@mui/material'
import {
  type ComprobanteParaEnvio,
  type EnvioMoto,
  type ErroresEnvioMoto,
  type FormularioEnvioMoto,
  FORMULARIO_ENVIO_MOTO_VACIO,
  GUIA_MAXIMO,
  MENSAJERO_MAXIMO,
  actualizarEnvioMoto,
  aFormulario,
  codigoDeError,
  comprobantesParaEnvioMoto,
  esConflicto,
  mensajeDeErrorEnvioMoto,
  registrarEnvioMoto,
  validarEnvioMoto,
} from '../../lib/ventas/enviosMoto'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Sin envío = alta; con envío = edición (carga sus datos y usa su `actualizado_en` como bloqueo).
  envio?: EnvioMoto | null
  // Tienda del filtro de la pantalla (`null` = todas): acota las facturas que se ofrecen.
  empresaId: string | null
  onCerrar: () => void
  onGuardado: (edicion: boolean) => void
  // Ante un conflicto de edición: recargar el listado con los datos de la otra persona.
  onRecargar?: () => void
}

const ESPERA_BUSQUEDA_MS = 300

// Diálogo Registrar / Editar envío en moto (F-VTA-24, FR-004 y FR-005). No está dibujado en el
// prototipo (decisión abierta de detalle 1): usa los componentes del kit. La base es la autoridad;
// acá se valida antes de viajar y se traducen sus errores.
export function EnvioMotoDialog({ open, ...resto }: Props) {
  // Mientras se guarda no se cierra con Escape ni con un clic afuera: el resultado se aplica igual y la persona
  // quedaría sin ver el aviso ni el error.
  const enVuelo = useRef(false)
  return (
    <Dialog open={open} onClose={() => { if (!enVuelo.current) resto.onCerrar() }} fullWidth maxWidth="sm" aria-labelledby="titulo-envio-moto">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario {...resto} enVuelo={enVuelo} />
    </Dialog>
  )
}

function Formulario({ envio = null, empresaId, onCerrar, onGuardado, onRecargar, enVuelo }: Omit<Props, 'open'> & { enVuelo: MutableRefObject<boolean> }) {
  const edicion = envio !== null
  const [formulario, setFormulario] = useState<FormularioEnvioMoto>(envio ? aFormulario(envio) : FORMULARIO_ENVIO_MOTO_VACIO)
  const [errores, setErrores] = useState<ErroresEnvioMoto>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Selector de facturas elegibles (solo alta), con espera al tipear.
  const [busqueda, setBusqueda] = useState('')
  const [opciones, setOpciones] = useState<ComprobanteParaEnvio[]>([])
  const [cargandoOpciones, setCargandoOpciones] = useState(!edicion)
  const [errorOpciones, setErrorOpciones] = useState(false)
  // Se incrementa para volver a pedir las facturas tras un error.
  const [reintento, setReintento] = useState(0)
  const [comprobante, setComprobante] = useState<ComprobanteParaEnvio | null>(null)

  useEffect(() => {
    if (edicion) return
    let vigente = true
    setCargandoOpciones(true)
    const espera = setTimeout(() => {
      void (async () => {
        try {
          const lista = await comprobantesParaEnvioMoto({ empresaId, busqueda })
          if (!vigente) return
          setOpciones(lista)
          setErrorOpciones(false)
        } catch (falla) {
          if (!vigente) return
          console.error('No pudimos cargar las facturas para el envío.', codigoDeError(falla))
          setOpciones([])
          setErrorOpciones(true)
        }
        if (vigente) setCargandoOpciones(false)
      })()
    }, busqueda === '' ? 0 : ESPERA_BUSQUEDA_MS)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [busqueda, empresaId, edicion, reintento])

  const cambiar = (campo: 'mensajero' | 'guia' | 'costo_envio' | 'abono') => (valor: string) => {
    setFormulario((actual) => ({ ...actual, [campo]: valor }))
    if (campo !== 'guia' && errores[campo]) setErrores((actual) => ({ ...actual, [campo]: undefined }))
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos = validarEnvioMoto(formulario, { requerido: !edicion, elegido: comprobante !== null })
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    try {
      if (envio) await actualizarEnvioMoto(envio, formulario)
      else if (comprobante) await registrarEnvioMoto(comprobante.id, formulario)
      onGuardado(edicion)
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeErrorEnvioMoto(error, edicion
          ? 'No pudimos guardar el envío. Intentá de nuevo.'
          : 'No pudimos registrar el envío. Intentá de nuevo.'),
        conflicto: esConflicto(error),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-envio-moto" onCerrar={guardando ? undefined : onCerrar}>
        {edicion ? 'Editar envío en moto' : 'Registrar envío en moto'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <Alert
              severity="error"
              action={errorServidor.conflicto && onRecargar ? <Button color="inherit" onClick={onRecargar}>Recargar</Button> : undefined}
            >
              {errorServidor.texto}
            </Alert>
          ) : null}
          {edicion && envio ? (
            <TextField
              label="Comprobante"
              value={`${envio.comprobante_numero} · ${envio.cliente ?? 'Sin cliente'}`}
              disabled
              fullWidth
            />
          ) : (
            <Autocomplete
              options={opciones}
              value={comprobante}
              loading={cargandoOpciones}
              disabled={guardando}
              onChange={(_, elegido) => {
                setComprobante(elegido)
                setErrores((actual) => ({ ...actual, comprobante: undefined }))
              }}
              inputValue={busqueda}
              onInputChange={(_, texto, motivo) => { if (motivo === 'input' || motivo === 'clear') setBusqueda(texto) }}
              filterOptions={(todas) => todas}
              getOptionLabel={(c) => `${c.numero} · ${c.cliente ?? 'Sin cliente'}`}
              getOptionKey={(c) => c.id}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText={errorOpciones ? 'No pudimos cargar las facturas' : 'No hay facturas con envío en moto sin registrar'}
              loadingText="Buscando facturas…"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Comprobante"
                  required
                  placeholder="Buscá por número o cliente"
                  error={Boolean(errores.comprobante) || errorOpciones}
                  helperText={errores.comprobante ?? (errorOpciones ? 'No pudimos cargar las facturas. Tocá «Reintentar» para volver a pedirlas.' : 'Solo facturas con forma de envío «Moto» que todavía no tienen envío.')}
                />
              )}
            />
          )}
          {errorOpciones && !edicion ? (
            <Button size="small" onClick={() => setReintento((n) => n + 1)} sx={{ alignSelf: 'flex-start' }}>Reintentar</Button>
          ) : null}
          <TextField
            label="Mensajero"
            value={formulario.mensajero}
            onChange={(e) => cambiar('mensajero')(e.target.value)}
            error={Boolean(errores.mensajero)}
            helperText={errores.mensajero}
            required
            autoComplete="off"
            disabled={guardando}
            slotProps={{ htmlInput: { maxLength: MENSAJERO_MAXIMO + 20 } }}
            fullWidth
          />
          <TextField
            label="Guía"
            value={formulario.guia}
            onChange={(e) => cambiar('guia')(e.target.value)}
            helperText="Opcional."
            autoComplete="off"
            disabled={guardando}
            slotProps={{ htmlInput: { maxLength: GUIA_MAXIMO } }}
            fullWidth
          />
          <TextField
            label="Costo de envío"
            value={formulario.costo_envio}
            onChange={(e) => cambiar('costo_envio')(e.target.value)}
            error={Boolean(errores.costo_envio)}
            helperText={errores.costo_envio}
            required
            autoComplete="off"
            disabled={guardando}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            fullWidth
          />
          <TextField
            label="Abona al recibir"
            value={formulario.abono}
            onChange={(e) => cambiar('abono')(e.target.value)}
            error={Boolean(errores.abono)}
            helperText={errores.abono ?? 'Lo que el cliente paga en efectivo al recibir.'}
            required
            autoComplete="off"
            disabled={guardando}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={formulario.enviado}
                disabled={guardando}
                onChange={(e) => setFormulario((actual) => ({ ...actual, enviado: e.target.checked }))}
              />
            }
            label="Enviado"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando}>
          {guardando ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Registrar envío'}
        </Button>
      </DialogActions>
    </Box>
  )
}
