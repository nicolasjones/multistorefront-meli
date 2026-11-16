import { type FormEvent, useRef, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, FormControlLabel, FormHelperText, MenuItem, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import {
  type ErroresFormaPago,
  type EstadoInicialComprobante,
  type FormaPago,
  type FormularioFormaPago,
  type TipoFormaPago,
  ESTADOS_INICIALES,
  ETIQUETA_ESTADO_INICIAL,
  ETIQUETA_TIPO_FORMA_PAGO,
  NOMBRE_MAXIMO,
  TIPOS_FORMA_PAGO,
  actualizarFormaPago,
  aFormulario,
  crearFormaPago,
  esConflicto,
  formularioVacio,
  mensajeDeError,
  validarFormaPago,
} from '../../lib/ventas/formasPago'
import { EstadoError } from '../estados/EstadosPagina'
import { SelectorEmpresas } from '../base/SelectorEmpresas'
import { TituloDialogo } from '../base/TituloDialogo'

export type EmpresaOpcion = { id: string; nombre: string }

type Props = {
  open: boolean
  // Empresa elegida en la pantalla: en el alta arranca marcada; en la edición es la única.
  empresa: EmpresaOpcion
  // Empresas entre las que puede repartirse el alta («Empresas donde aplica»).
  empresas: EmpresaOpcion[]
  // Sin forma = alta; con forma = edición (usa su updated_at como bloqueo optimista).
  forma?: FormaPago | null
  // Próximo `orden` sugerido para el alta (cantidad actual + 1, como el prototipo).
  ordenSugerido: number
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  // Ante un conflicto de edición: recargar el catálogo con los datos de la otra persona.
  onRecargar?: () => void
}

// Diálogo Nueva / Editar forma de pago (F-VTA-01, FR-005). Campos del prototipo
// `VentasConfiguracion.dc.html`. La autoridad es la base (valores permitidos, nombre único por
// empresa, bloqueo optimista): acá se valida antes de viajar y se traducen sus errores.
export function FormaPagoDialog(props: Props) {
  return (
    <Dialog open={props.open} onClose={props.onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-forma-pago">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario {...props} />
    </Dialog>
  )
}

function Formulario({ empresa, empresas, forma = null, ordenSugerido, onCerrar, onGuardado, onRecargar }: Props) {
  const edicion = forma !== null
  const [formulario, setFormulario] = useState<FormularioFormaPago>(
    forma ? aFormulario(forma) : formularioVacio(empresa.id, ordenSugerido),
  )
  const [errores, setErrores] = useState<ErroresFormaPago>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refNombre = useRef<HTMLInputElement | null>(null)
  const refOrden = useRef<HTMLInputElement | null>(null)

  const cambiar = <K extends keyof FormularioFormaPago>(campo: K, valor: FormularioFormaPago[K]) => {
    setFormulario((actual) => ({ ...actual, [campo]: valor }))
    if (campo in errores) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    const nuevos = validarFormaPago(formulario, { alta: !edicion })
    setErrores(nuevos)
    if (nuevos.nombre) {
      refNombre.current?.focus()
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
        await actualizarFormaPago(formulario, { id: forma.id, actualizadoEn: forma.updated_at })
        onGuardado(`Cambios guardados · ${nombre}`)
      } else {
        await crearFormaPago(formulario)
        onGuardado(`Creado · ${nombre}`)
      }
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeError(error, 'No pudimos guardar la forma de pago. Intentá de nuevo.'),
        conflicto: esConflicto(error),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-forma-pago" onCerrar={guardando ? undefined : onCerrar}>
        {edicion ? 'Editar forma de pago' : 'Nueva forma de pago'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto ? 'La forma de pago cambió.' : 'No se guardó la forma de pago.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto && onRecargar ? onRecargar : undefined}
              etiquetaReintentar="Recargar"
            />
          ) : null}

          <TextField
            label="Nombre"
            placeholder="Ej.: Transferencia o depósito bancario"
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
            label="Tipo de forma de pago"
            value={formulario.tipo}
            onChange={(evento) => cambiar('tipo', evento.target.value as TipoFormaPago)}
            fullWidth
          >
            {TIPOS_FORMA_PAGO.map((tipo) => <MenuItem key={tipo} value={tipo}>{ETIQUETA_TIPO_FORMA_PAGO[tipo]}</MenuItem>)}
          </TextField>

          <CampoSiNo
            etiqueta="Exige cuenta de cobro"
            valor={formulario.exigeCuentaCobro}
            onCambio={(valor) => cambiar('exigeCuentaCobro', valor)}
          />
          <CampoSiNo
            etiqueta="Genera deuda"
            valor={formulario.generaDeuda}
            onCambio={(valor) => cambiar('generaDeuda', valor)}
          />

          <Box>
            <Typography id="etiqueta-estado-inicial" variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Estado inicial del comprobante
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-labelledby="etiqueta-estado-inicial"
              aria-describedby="ayuda-estado-inicial"
              value={formulario.estadoInicial}
              onChange={(_, valor: EstadoInicialComprobante | null) => { if (valor !== null) cambiar('estadoInicial', valor) }}
            >
              {ESTADOS_INICIALES.map((estado) => (
                <ToggleButton key={estado} value={estado}>{ETIQUETA_ESTADO_INICIAL[estado]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <FormHelperText id="ayuda-estado-inicial">
              Con este estado se crea el comprobante al elegir esta forma de pago.
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

          <SelectorEmpresas
            empresas={empresas}
            seleccion={formulario.empresaIds}
            onCambiar={(empresaIds) => cambiar('empresaIds', empresaIds)}
            etiqueta="Empresas donde aplica"
            error={errores.empresaIds}
            ayuda={edicion ? `Los cambios aplican solo a ${empresa.nombre}.` : undefined}
            deshabilitado={edicion}
          />
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
