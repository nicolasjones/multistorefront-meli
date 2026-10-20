import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, FormControlLabel, LinearProgress, MenuItem, Stack, Switch,
  TextField, Typography,
} from '@mui/material'
import { useEmpresas } from '../../hooks/useEmpresas'
import { formatearCuit } from '../../lib/cuit'
import {
  type CampoTransporte,
  type ErroresTransporte,
  type FormularioTransporte,
  type TipoTransporte,
  type Transporte,
  FORMULARIO_TRANSPORTE_VACIO,
  TIPOS_TRANSPORTE,
  actualizarTransporte,
  aFormulario,
  crearTransporte,
  esConflicto,
  esNombreRepetido,
  mensajeDeError,
  MENSAJE_NOMBRE_REPETIDO,
  validarTransporte,
} from '../../lib/ventas/transportes'
import { EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Sin transporte = alta; con transporte = edición (carga sus datos y usa su updated_at como bloqueo).
  transporte?: Transporte | null
  onCerrar: () => void
  onGuardado: (transporte: Transporte) => void
  // Ante un conflicto de edición: recargar el listado con los datos de la otra persona.
  onRecargar?: () => void
}

type CampoTexto = Exclude<CampoTransporte, 'tipo' | 'cobra_contrarreembolso' | 'activa' | 'empresaIds'>

type DefCampo = { campo: CampoTexto; etiqueta: string; type?: string; placeholder?: string; requerido?: boolean; ayuda?: string }

// Campos del prototipo (Ventas · Transportes y contrarreembolsos, diálogo «transp»), en su orden.
const CAMPO_NOMBRE: DefCampo = { campo: 'nombre', etiqueta: 'Empresa de transporte', placeholder: 'Ej.: Expreso Ejemplo del Sur', requerido: true }
const CAMPOS_DESPUES_DEL_TIPO: ReadonlyArray<DefCampo> = [
  { campo: 'cuit', etiqueta: 'CUIT', ayuda: 'Opcional: la moto propia no tiene.' },
  { campo: 'terminal_retiro', etiqueta: 'Terminal de retiro', placeholder: 'Terminal, calle y localidad' },
  { campo: 'localidad', etiqueta: 'Localidad' },
  { campo: 'telefono', etiqueta: 'Teléfono', type: 'tel', placeholder: '0341 000-0000' },
  { campo: 'correo', etiqueta: 'Correo', type: 'email', placeholder: 'cobranzas@empresa.example' },
  { campo: 'persona_contacto', etiqueta: 'Persona de contacto' },
  { campo: 'direccion', etiqueta: 'Dirección de la oficina' },
]
const CAMPOS_DE_COBRO: ReadonlyArray<DefCampo> = [
  { campo: 'comision', etiqueta: 'Comisión (%)', placeholder: '2,5' },
  { campo: 'plazo_rendicion_dias', etiqueta: 'Plazo de rendición (días)', placeholder: '7' },
  { campo: 'orden', etiqueta: 'Orden', placeholder: '0', ayuda: 'Define el orden en que se listan.' },
]
const CAMPOS_NUMERICOS: ReadonlyArray<CampoTexto> = ['comision', 'plazo_rendicion_dias', 'orden']
const ORDEN_FOCO: ReadonlyArray<CampoTexto> = [
  'nombre', 'cuit', 'terminal_retiro', 'localidad', 'telefono', 'correo', 'persona_contacto', 'direccion',
  'comision', 'plazo_rendicion_dias', 'orden',
]

// Diálogo Nueva / Editar empresa de transporte (F-VTA-04, FR-019). Campos del prototipo; la autoridad es
// la base (CUIT, rangos, unicidad, bloqueo optimista): acá se valida antes de viajar y se traducen sus errores.
export function TransporteDialog({ open, transporte = null, onCerrar, onGuardado, onRecargar }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-transporte-form">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario transporte={transporte} onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} />
    </Dialog>
  )
}

type PropsFormulario = Omit<Props, 'open'>

function Formulario({ transporte, onCerrar, onGuardado, onRecargar }: PropsFormulario) {
  const edicion = Boolean(transporte)
  const inicial: FormularioTransporte = transporte
    ? { ...aFormulario(transporte), cuit: transporte.cuit ? formatearCuit(transporte.cuit) : '' }
    : FORMULARIO_TRANSPORTE_VACIO
  const [formulario, setFormulario] = useState<FormularioTransporte>(inicial)
  const [errores, setErrores] = useState<ErroresTransporte>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const { empresas: tiendas, isLoading: cargandoTiendas, isError: errorTiendas } = useEmpresas()
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refs = useRef<Partial<Record<CampoTexto, HTMLInputElement | HTMLTextAreaElement | null>>>({})

  const cambiar = (campo: CampoTexto) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  // El CUIT se muestra con guiones apenas se completa; si no es de 11 dígitos queda como se escribió.
  const formatearAlSalir = () => setFormulario((actual) => ({ ...actual, cuit: actual.cuit.trim() === '' ? '' : formatearCuit(actual.cuit) }))

  const enfocarPrimerError = (nuevos: ErroresTransporte) => {
    const primero = ORDEN_FOCO.find((campo) => nuevos[campo])
    if (primero) {
      refs.current[primero]?.focus()
    }
  }

  const alternarEmpresa = (id: string) => setFormulario((actual) => ({
    ...actual,
    empresaIds: actual.empresaIds.includes(id) ? actual.empresaIds.filter((x) => x !== id) : [...actual.empresaIds, id],
  }))

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    const nuevos = validarTransporte(formulario)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) {
      enfocarPrimerError(nuevos)
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      const guardado = transporte
        ? await actualizarTransporte(formulario, { id: transporte.id, actualizadoEn: transporte.updated_at })
        : await crearTransporte(formulario)
      onGuardado(guardado)
    } catch (error) {
      if (esNombreRepetido(error)) {
        console.error('Nombre repetido al guardar el transporte.', error)
        const repetido = { nombre: MENSAJE_NOMBRE_REPETIDO }
        setErrores(repetido)
        enfocarPrimerError(repetido)
      } else {
        setErrorServidor({
          texto: mensajeDeError(error, 'No pudimos guardar la empresa de transporte. Intentá de nuevo.'),
          conflicto: esConflicto(error),
        })
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const campoTexto = ({ campo, etiqueta, type, placeholder, requerido, ayuda }: DefCampo, autoFocus = false) => (
    <TextField
      key={campo}
      label={etiqueta}
      type={type}
      value={formulario[campo]}
      onChange={cambiar(campo)}
      onBlur={campo === 'cuit' ? formatearAlSalir : undefined}
      error={Boolean(errores[campo])}
      helperText={errores[campo] ?? ayuda}
      placeholder={placeholder}
      required={requerido}
      autoComplete="off"
      autoFocus={autoFocus}
      inputRef={(el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[campo] = el }}
      slotProps={{ htmlInput: { inputMode: CAMPOS_NUMERICOS.includes(campo) ? 'decimal' : undefined } }}
      fullWidth
    />
  )

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-transporte-form" onCerrar={guardando ? undefined : onCerrar}>
        {edicion ? 'Editar empresa de transporte' : 'Nueva empresa de transporte'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto ? 'La empresa cambió.' : 'No se guardó la empresa de transporte.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto && onRecargar ? onRecargar : undefined}
              etiquetaReintentar="Recargar"
            />
          ) : null}
          {campoTexto(CAMPO_NOMBRE, true)}
          <TextField
            select
            label="Tipo"
            value={formulario.tipo}
            onChange={(event) => setFormulario((actual) => ({ ...actual, tipo: event.target.value as TipoTransporte }))}
            fullWidth
          >
            {TIPOS_TRANSPORTE.map(({ valor, etiqueta }) => <MenuItem key={valor} value={valor}>{etiqueta}</MenuItem>)}
          </TextField>
          {CAMPOS_DESPUES_DEL_TIPO.map((def) => campoTexto(def))}
          <FormControlLabel
            control={
              <Switch
                checked={formulario.cobra_contrarreembolso}
                onChange={(event) => setFormulario((actual) => ({ ...actual, cobra_contrarreembolso: event.target.checked }))}
              />
            }
            label={`Cobra contrarreembolso: ${formulario.cobra_contrarreembolso ? 'Sí' : 'No'}`}
          />
          {CAMPOS_DE_COBRO.map((def) => campoTexto(def))}
          <FormControlLabel
            control={
              <Switch
                checked={formulario.activa}
                onChange={(event) => setFormulario((actual) => ({ ...actual, activa: event.target.checked }))}
              />
            }
            label="Activa"
          />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Empresas donde se usa</Typography>
            {cargandoTiendas ? (
              <LinearProgress aria-label="Cargando empresas" />
            ) : errorTiendas ? (
              <Typography variant="body2" color="error">No pudimos cargar las empresas.</Typography>
            ) : tiendas.length === 0 ? (
              <Typography variant="body2" color="text.secondary">La organización todavía no tiene empresas cargadas.</Typography>
            ) : (
              <Stack role="group" aria-label="Empresas donde se usa" direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {tiendas.map((tienda) => {
                  const marcada = formulario.empresaIds.includes(tienda.id)
                  return (
                    <Chip
                      key={tienda.id}
                      label={tienda.nombre}
                      color={marcada ? 'primary' : 'default'}
                      variant={marcada ? 'filled' : 'outlined'}
                      aria-pressed={marcada}
                      disabled={guardando}
                      onClick={() => alternarEmpresa(tienda.id)}
                    />
                  )
                })}
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Sin ninguna empresa marcada, el transporte no se ofrece en ningún comprobante.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando || cargandoTiendas}>
          {guardando ? 'Guardando…' : 'Guardar empresa'}
        </Button>
      </DialogActions>
    </Box>
  )
}
