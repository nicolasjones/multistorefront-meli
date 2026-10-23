import { type FormEvent, useRef, useState } from 'react'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, FormControlLabel, FormHelperText, InputAdornment, MenuItem,
  Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import {
  type ErroresFormaEnvio,
  type EstadoDespachoInicial,
  type FormaEnvio,
  type FormularioFormaEnvio,
  type TipoFormaEnvio,
  ESTADOS_DESPACHO_INICIAL,
  ETIQUETA_ESTADO_DESPACHO,
  ETIQUETA_TIPO_FORMA_ENVIO,
  NOMBRE_MAXIMO,
  TIPOS_FORMA_ENVIO,
  actualizarFormaEnvio,
  aFormulario,
  crearFormaEnvio,
  esConflicto,
  formularioVacio,
  mensajeDeError,
  validarFormaEnvio,
} from '../../lib/ventas/formasEnvio'
import type { EmpresaOpcion } from './FormaPagoDialog'
import { EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Empresa elegida en la pantalla: en el alta arranca marcada; en la edición es la única.
  empresa: EmpresaOpcion
  // Empresas entre las que puede repartirse el alta («Empresas donde aplica»).
  empresas: EmpresaOpcion[]
  // Sin forma = alta; con forma = edición (usa su updated_at como bloqueo optimista).
  forma?: FormaEnvio | null
  // Próximo `orden` sugerido para el alta (cantidad actual + 1, como el prototipo).
  ordenSugerido: number
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  // Ante un conflicto de edición: recargar el catálogo con los datos de la otra persona.
  onRecargar?: () => void
}

// Diálogo Nueva / Editar forma de envío (F-VTA-02, FR-009). Campos del prototipo
// `VentasConfiguracion.dc.html`. La autoridad es la base (valores permitidos, nombre único por
// empresa, bloqueo optimista): acá se valida antes de viajar y se traducen sus errores.
export function FormaEnvioDialog(props: Props) {
  return (
    <Dialog open={props.open} onClose={props.onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-forma-envio">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario {...props} />
    </Dialog>
  )
}

function Formulario({ empresa, empresas, forma = null, ordenSugerido, onCerrar, onGuardado, onRecargar }: Props) {
  const edicion = forma !== null
  const [formulario, setFormulario] = useState<FormularioFormaEnvio>(
    forma ? aFormulario(forma) : formularioVacio(empresa.id, ordenSugerido),
  )
  const [errores, setErrores] = useState<ErroresFormaEnvio>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refNombre = useRef<HTMLInputElement | null>(null)
  const refCosto = useRef<HTMLInputElement | null>(null)
  const refOrden = useRef<HTMLInputElement | null>(null)

  const cambiar = <K extends keyof FormularioFormaEnvio>(campo: K, valor: FormularioFormaEnvio[K]) => {
    setFormulario((actual) => ({ ...actual, [campo]: valor }))
    if (campo in errores) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  const alternarEmpresa = (id: string) => {
    const marcadas = formulario.empresaIds
    cambiar('empresaIds', marcadas.includes(id) ? marcadas.filter((otra) => otra !== id) : [...marcadas, id])
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    const nuevos = validarFormaEnvio(formulario, { alta: !edicion })
    setErrores(nuevos)
    if (nuevos.nombre) {
      refNombre.current?.focus()
      return
    }
    if (nuevos.costoDefecto) {
      refCosto.current?.focus()
      return
    }
    if (nuevos.orden) {
      refOrden.current?.focus()
      return
    }
    if (nuevos.empresaIds) {
      return
    }
    enVuelo.current = true
    setGuardando(true)
    const nombre = formulario.nombre.trim()
    try {
      if (forma) {
        await actualizarFormaEnvio(formulario, { id: forma.id, actualizadoEn: forma.updated_at })
        onGuardado(`Cambios guardados · ${nombre}`)
      } else {
        await crearFormaEnvio(formulario)
        onGuardado(`Creado · ${nombre}`)
      }
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeError(error, 'No pudimos guardar la forma de envío. Intentá de nuevo.'),
        conflicto: esConflicto(error),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-forma-envio" onCerrar={guardando ? undefined : onCerrar}>
        {edicion ? 'Editar forma de envío' : 'Nueva forma de envío'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto ? 'La forma de envío cambió.' : 'No se guardó la forma de envío.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto && onRecargar ? onRecargar : undefined}
              etiquetaReintentar="Recargar"
            />
          ) : null}

          <TextField
            label="Nombre"
            placeholder="Ej.: Expreso a domicilio"
            value={formulario.nombre}
            onChange={(evento) => cambiar('nombre', evento.target.value)}
            error={Boolean(errores.nombre)}
            helperText={errores.nombre}
            required
            autoComplete="off"
            autoFocus
            inputRef={refNombre}
            slotProps={{ htmlInput: { maxLength: NOMBRE_MAXIMO } }}
            fullWidth
          />

          <TextField
            select
            label="Tipo de forma de envío"
            value={formulario.tipo}
            onChange={(evento) => cambiar('tipo', evento.target.value as TipoFormaEnvio)}
            fullWidth
          >
            {TIPOS_FORMA_ENVIO.map((tipo) => <MenuItem key={tipo} value={tipo}>{ETIQUETA_TIPO_FORMA_ENVIO[tipo]}</MenuItem>)}
          </TextField>

          <CampoSiNo
            etiqueta="Exige transporte y guía"
            valor={formulario.exigeTransporteGuia}
            onCambio={(valor) => cambiar('exigeTransporteGuia', valor)}
          />

          <TextField
            label="Costo por defecto"
            placeholder="0"
            value={formulario.costoDefecto}
            onChange={(evento) => cambiar('costoDefecto', evento.target.value)}
            error={Boolean(errores.costoDefecto)}
            helperText={errores.costoDefecto ?? 'Opcional. Vacío = sin costo por defecto.'}
            inputRef={refCosto}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">ARS</InputAdornment> },
              htmlInput: { inputMode: 'decimal' },
            }}
            sx={{ maxWidth: 240 }}
          />

          <Box>
            <Typography id="etiqueta-estado-despacho" variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Estado de despacho inicial
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-labelledby="etiqueta-estado-despacho"
              aria-describedby="ayuda-estado-despacho"
              value={formulario.estadoDespachoInicial}
              onChange={(_, valor: EstadoDespachoInicial | null) => { if (valor !== null) cambiar('estadoDespachoInicial', valor) }}
            >
              {ESTADOS_DESPACHO_INICIAL.map((estado) => (
                <ToggleButton key={estado} value={estado}>{ETIQUETA_ESTADO_DESPACHO[estado]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <FormHelperText id="ayuda-estado-despacho">
              Con este estado entra el pedido al tablero de despacho al elegir esta forma de envío.
            </FormHelperText>
          </Box>

          <TextField
            label="Orden"
            placeholder="1"
            value={formulario.orden}
            onChange={(evento) => cambiar('orden', evento.target.value)}
            error={Boolean(errores.orden)}
            helperText={errores.orden}
            inputRef={refOrden}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            sx={{ maxWidth: 160 }}
          />

          <FormControlLabel
            control={<Switch checked={formulario.activo} onChange={(evento) => cambiar('activo', evento.target.checked)} />}
            label="Activo"
          />

          <Box>
            <Typography id="etiqueta-empresas" variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Empresas donde aplica
            </Typography>
            <Stack role="group" aria-labelledby="etiqueta-empresas" direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {empresas.map((opcion) => {
                const marcada = formulario.empresaIds.includes(opcion.id)
                return (
                  <Chip
                    key={opcion.id}
                    label={opcion.nombre}
                    color={marcada ? 'primary' : 'default'}
                    variant={marcada ? 'filled' : 'outlined'}
                    aria-pressed={marcada}
                    // La edición aplica solo a la empresa elegida: no se reparte.
                    disabled={edicion}
                    onClick={edicion ? undefined : () => alternarEmpresa(opcion.id)}
                  />
                )
              })}
            </Stack>
            {errores.empresaIds ? <FormHelperText error>{errores.empresaIds}</FormHelperText> : null}
            {edicion ? <FormHelperText>Los cambios aplican solo a {empresa.nombre}.</FormHelperText> : null}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando}>{edicion ? 'Guardar cambios' : 'Crear'}</Button>
      </DialogActions>
    </Box>
  )
}

function CampoSiNo({ etiqueta, valor, onCambio }: { etiqueta: string; valor: boolean; onCambio: (valor: boolean) => void }) {
  const id = `etiqueta-${etiqueta.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <Box>
      <Typography id={id} variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>{etiqueta}</Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-labelledby={id}
        value={valor ? 'si' : 'no'}
        onChange={(_, nuevo: 'si' | 'no' | null) => { if (nuevo !== null) onCambio(nuevo === 'si') }}
      >
        <ToggleButton value="si">Sí</ToggleButton>
        <ToggleButton value="no">No</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}
